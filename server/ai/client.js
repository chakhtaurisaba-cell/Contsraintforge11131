// AI client for a local Ollama server (no API key — the model runs on this machine).
// Every structured call is constrained to a JSON schema and validated with zod on the
// server before anything reaches the UI or the database.
//
// Availability is tracked honestly: "configured" means AI is not switched off;
// "available" additionally means the startup probe did not prove it unusable (model not
// installed). Specific causes go to the server log and /api/health for the maintainer.
import http from 'node:http';
import https from 'node:https';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { config } from '../config.js';
import { webSearch, fetchPage, searchAvailable, searchStatus } from './search.js';
import { extractJSON, conformToSchema, schemaPrompt, prefillFor } from './json.js';

// Ollama Cloud without a key can't work; say so instead of failing on every request.
const missingKey = config.ai.cloud && !config.ai.apiKey;
const status = { state: !config.ai.enabled ? 'unconfigured' : missingKey ? 'missing_key' : 'unchecked', checkedAt: null, detail: null, capabilities: null };

export const aiConfigured = () => config.ai.enabled && !missingKey;
/** True when AI calls can be attempted (configured and the model is known to exist). */
export const aiEnabled = () => aiConfigured() && status.state !== 'model_unavailable';

const MAINTAINER_HINTS = {
  unconfigured: 'AI is switched off (AI_ENABLED=false in constraintforge/.env). Remove that line and restart the server.',
  unreachable: () => `Ollama is not reachable at ${config.ai.baseUrl}. Start the Ollama app (or run "ollama serve"); set OLLAMA_HOST in .env if it runs elsewhere.`,
  model_unavailable: () => `Model "${config.ai.model}" is not installed in Ollama. Run "ollama pull ${config.ai.model}", or set OLLAMA_MODEL in .env to a model you have.`,
  no_vision: () => `Model "${config.ai.model}" cannot read images, so photo scanning will not work. Use a vision model such as qwen3-vl:4b (set OLLAMA_MODEL).`,
  out_of_memory: () => `Model "${config.ai.model}" needs more memory than is free. Close other apps, lower OLLAMA_NUM_CTX, or use a smaller model.`,
  error: () => status.detail,
  missing_key: 'Ollama Cloud needs an API key: set OLLAMA_API_KEY on the server (Vercel → Project → Settings → Environment Variables), then redeploy.',
  unauthorized: 'Ollama Cloud rejected the API key. Check OLLAMA_API_KEY (create one at https://ollama.com/settings/keys), then redeploy.',
  rate_limited: 'Ollama Cloud is rate-limiting this account (usage limit reached). Wait, or upgrade the Ollama plan.',
};
// Cloud wording for hints that mention installing models locally.
const CLOUD_HINTS = {
  unreachable: () => `Ollama Cloud (${config.ai.baseUrl}) is not reachable from the server. Check the deployment's network access, then try again.`,
  model_unavailable: () => `Model "${config.ai.model}" is not available on Ollama Cloud. Set OLLAMA_MODEL to a model listed at https://ollama.com/api/tags that supports images (default: gemma4:31b).`,
  no_vision: () => `Model "${config.ai.model}" cannot read images, so photo scanning will not work. Use an Ollama Cloud model with vision, such as gemma4:31b.`,
};

export function aiStatus() {
  const hint = (config.ai.cloud && CLOUD_HINTS[status.state]) || MAINTAINER_HINTS[status.state];
  const search = searchStatus();
  return {
    configured: aiConfigured(),
    available: aiEnabled(),
    state: status.state,
    provider: config.ai.provider,
    host: config.ai.baseUrl,
    model: config.ai.model,
    // Names where the credential comes from — never the key itself.
    credentialSource: !aiConfigured() ? null : config.ai.cloud ? 'OLLAMA_API_KEY (server-side)' : 'Local Ollama (no API key)',
    capabilities: status.capabilities,
    search,
    checkedAt: status.checkedAt,
    maintainerHint: (typeof hint === 'function' ? hint() : hint) || (!search.available ? `Web research is off: ${search.missing ? `set ${search.missing} in .env` : 'SEARCH_PROVIDER=off'}.` : null),
  };
}

function setState(state, detail = null) {
  if (status.state !== state) console.log(`[ai] status: ${state}${detail ? ` — ${detail}` : ''}`);
  status.state = state;
  status.detail = detail;
  status.checkedAt = new Date().toISOString();
}

export class AIError extends Error {
  constructor(message, status = 502, code = 'ai_error', retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function notConfigured() {
  return new AIError('AI analysis is not set up on this installation.', 503, 'ai_not_configured');
}

function ensureEnabled(what) {
  if (!aiConfigured()) throw notConfigured();
  if (!aiEnabled()) throw new AIError(`${what} is unavailable: the AI model isn’t installed on this computer yet.`, 503, 'ai_unavailable');
}

const timeoutError = () => new AIError('The AI took too long to answer. Try again, or make the request smaller.', 504, 'ai_timeout', true);

/**
 * Reads Ollama's NDJSON chat stream into one message. Streaming matters: a non-streamed
 * reply sends no headers until generation ends, and long local generations would hit
 * fetch's header timeout. Here only silence (no token for `idleMs`) counts as a stall.
 */
async function readChatStream(res, controller, idleMs, onToken) {
  const decoder = new TextDecoder();
  const out = { message: { role: 'assistant', content: '', thinking: '', tool_calls: [] }, done_reason: null, stats: null };
  let buf = '';
  let tokens = 0;
  let idle = setTimeout(() => controller.abort(new Error('idle')), idleMs);
  const handle = (line) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw Object.assign(new Error(chunk.error), { midStream: true });
    const m = chunk.message || {};
    out.message.content += m.content || '';
    out.message.thinking += m.thinking || '';
    if (m.tool_calls?.length) out.message.tool_calls.push(...m.tool_calls);
    if (m.content) onToken?.(out.message.content, ++tokens);
    if (chunk.done) {
      out.done_reason = chunk.done_reason || 'stop';
      out.stats = chunk;
    }
  };
  try {
    for await (const part of res.body) {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(new Error('idle')), idleMs);
      buf += decoder.decode(part, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handle);
    }
    handle(buf);
  } finally {
    clearTimeout(idle);
  }
  return out;
}

/**
 * Per-request scope set by server/index.js: when the browser disconnects, its signal aborts
 * the Ollama generation so abandoned requests don't keep the model busy.
 */
export const requestScope = new AsyncLocalStorage();

/**
 * Minimal fetch-like call over node:http. Unlike fetch it has no 300 s header timeout,
 * which a queued or slow local generation can easily exceed.
 */
function httpRequest(url, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers, signal }, (res) => {
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: res, text: () => new Promise((ok, fail) => { let s = ''; res.setEncoding('utf8'); res.on('data', (c) => (s += c)).on('end', () => ok(s)).on('error', fail); }) });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Set when forcing all layers onto the GPU (OLLAMA_NUM_GPU) failed; Ollama then picks the split.
let gpuFallback = false;

/**
 * Options shared by EVERY generation. num_ctx and num_gpu must stay identical between calls:
 * Ollama reloads the model whenever they change, which costs 5–10 s on a laptop.
 */
function modelOptions(extra = {}) {
  return { num_ctx: config.ai.numCtx, ...(config.ai.numGpu != null && !gpuFallback ? { num_gpu: config.ai.numGpu } : {}), ...extra };
}

const sec = (ns) => (Number(ns || 0) / 1e9).toFixed(1);
/** One line per generation: where the time went (model load, reading the prompt, writing the answer). */
function logTiming(label, d) {
  const s = d?.stats;
  if (!s) return;
  const rate = s.eval_duration ? (s.eval_count / (s.eval_duration / 1e9)).toFixed(0) : '–';
  console.log(`[ai] ${label}: load ${sec(s.load_duration)}s · prompt ${s.prompt_eval_count ?? 0} tok ${sec(s.prompt_eval_duration)}s · output ${s.eval_count ?? 0} tok ${sec(s.eval_duration)}s (${rate} tok/s) · ${d.done_reason}`);
}

/** One request to the Ollama HTTP API, with errors mapped to user-safe messages. */
async function ollama(path, body, { method = 'POST', timeoutMs = config.ai.timeoutMs, onToken, label } = {}) {
  const streaming = path === '/api/chat';
  const controller = new AbortController();
  const clientGone = requestScope.getStore()?.signal;
  const onGone = () => controller.abort(new Error('client_gone'));
  clientGone?.addEventListener('abort', onGone, { once: true });
  // Whole-request cap (waiting in Ollama's queue counts); streamed chats also abort after a long silence.
  const cap = setTimeout(() => controller.abort(new Error('timeout')), streaming ? config.ai.maxRequestMs : timeoutMs);
  const cleanup = () => {
    clearTimeout(cap);
    clientGone?.removeEventListener('abort', onGone);
  };
  let res;
  try {
    res = await httpRequest(`${config.ai.baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        // Ollama Cloud: the server-side key. Never logged, never sent anywhere but ollama.com.
        ...(config.ai.apiKey ? { authorization: `Bearer ${config.ai.apiKey}` } : {}),
      },
      body: body ? JSON.stringify(streaming ? { ...body, stream: true } : body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    if (clientGone?.aborted) throw new AIError('The request was cancelled.', 499, 'cancelled');
    if (controller.signal.aborted) throw timeoutError();
    setState('unreachable', err?.code || err?.message);
    throw new AIError(config.ai.cloud ? 'The AI service could not be reached. Please try again in a moment.' : 'The AI service could not be reached. Make sure Ollama is running, then try again.', 503, 'ai_unreachable', true);
  }
  let data = null;
  let raw = '';
  try {
    if (res.ok && streaming) data = await readChatStream(res, controller, timeoutMs, onToken);
    else {
      raw = await res.text();
      try {
        data = JSON.parse(raw);
      } catch {
        /* non-JSON error body */
      }
    }
  } catch (err) {
    if (clientGone?.aborted) throw new AIError('The request was cancelled.', 499, 'cancelled');
    if (controller.signal.aborted) throw timeoutError();
    if (err.midStream) {
      res = { ok: false, status: 500 };
      raw = err.message;
    } else throw new AIError('The connection to the AI service broke off. Please try again.', 503, 'ai_unavailable_temp', true);
  } finally {
    cleanup();
  }
  if (!res.ok) {
    const msg = String(data?.error || raw).slice(0, 300);
    console.error(`[ai] ollama ${path} → ${res.status}: ${msg}`);
    if (body?.options?.num_gpu != null && /memory|CUDA|terminated|allocate/i.test(msg)) {
      // The GPU could not hold every layer (other apps using VRAM?). Let Ollama choose the split from now on.
      gpuFallback = true;
      console.warn('[ai] full GPU offload failed — falling back to Ollama’s automatic GPU/CPU split (slower).');
      throw Object.assign(new AIError('The AI model could not load on the GPU.', 503, 'ai_unavailable_temp', true), { gpuRetry: true });
    }
    if (/llama-server process has terminated|CUDA error/i.test(msg)) throw new AIError('The AI model crashed while loading. Please try again.', 503, 'ai_unavailable_temp', true);
    if (res.status === 401 || res.status === 403) {
      setState('unauthorized', msg);
      throw new AIError('The AI service isn’t available right now (it could not be authorised). Please try again later.', 503, 'ai_unauthorized');
    }
    if (res.status === 429) {
      setState('rate_limited', msg);
      throw new AIError('The AI service is busy right now. Please wait a minute and try again.', 503, 'ai_rate_limited', true);
    }
    if (res.status === 404 && /model|not found/i.test(msg)) {
      setState('model_unavailable', msg);
      throw new AIError(config.ai.cloud ? 'AI analysis is unavailable: the configured AI model isn’t available.' : 'AI analysis is unavailable: the AI model isn’t installed on this computer yet.', 503, 'ai_unavailable');
    }
    if (/does not support (images|vision)|missing data required for image|image input/i.test(msg)) {
      throw new AIError('The installed AI model can’t read photos. You can still add items by hand.', 422, 'ai_no_vision');
    }
    if (/does not support tools/i.test(msg)) throw new AIError(msg, 400, 'ai_no_tools');
    if (/memory/i.test(msg)) {
      setState('out_of_memory', msg);
      throw new AIError('The AI model ran out of memory on this computer. Close other apps and try again.', 503, 'ai_out_of_memory', true);
    }
    if (res.status >= 500) throw new AIError('The AI service is temporarily unavailable. Please try again.', 503, 'ai_unavailable_temp', true);
    throw new AIError('The AI service could not process this request.', 422, 'ai_bad_request');
  }
  if (path === '/api/chat' && !['ready', 'no_vision'].includes(status.state)) setState('ready');
  if (streaming) logTiming(label || 'chat', data);
  return data;
}

/** Chat request; retries once without forced GPU offload if the GPU could not hold the model. */
async function chat(body, opts) {
  try {
    return await ollama('/api/chat', body, opts);
  } catch (err) {
    if (!err.gpuRetry) throw err;
    const { num_gpu, ...options } = body.options || {};
    return ollama('/api/chat', { ...body, options }, opts);
  }
}

/**
 * Loads the model with the same options every request uses, so the first real request
 * doesn't pay the load time (and the model isn't reloaded because options differ).
 */
export async function warmModel() {
  // Cloud models are always loaded; there is nothing to warm.
  if (!aiEnabled() || config.ai.cloud) return;
  const t = Date.now();
  const load = (options) => ollama('/api/generate', { model: config.ai.model, keep_alive: config.ai.keepAlive, options }, { timeoutMs: 120000 });
  try {
    try {
      await load(modelOptions());
    } catch (err) {
      if (!err.gpuRetry) throw err;
      await load(modelOptions());
    }
    console.log(`[ai] model loaded and kept warm for ${config.ai.keepAlive} (${((Date.now() - t) / 1000).toFixed(1)}s; num_ctx ${config.ai.numCtx}${config.ai.numGpu != null && !gpuFallback ? `, num_gpu ${config.ai.numGpu}` : ', automatic GPU split'})`);
  } catch (err) {
    console.warn(`[ai] warm-up failed: ${err.message}`);
  }
}

/** Checks that Ollama is running and the model is installed (no generation). */
export async function probeAI() {
  if (!aiConfigured()) {
    setState(missingKey && config.ai.enabled ? 'missing_key' : 'unconfigured');
    return aiStatus();
  }
  try {
    await ollama('/api/version', null, { method: 'GET', timeoutMs: 5000 });
    const show = await ollama('/api/show', { model: config.ai.model }, { timeoutMs: 20000 });
    status.capabilities = Array.isArray(show?.capabilities) ? show.capabilities : null;
    // /api/show works without a valid cloud key, so it can't clear a rejected key or a rate
    // limit — only a successful AI request does that.
    if (!['unauthorized', 'rate_limited'].includes(status.state)) setState(status.capabilities && !status.capabilities.includes('vision') ? 'no_vision' : 'ready');
  } catch (err) {
    if (!(err instanceof AIError) || status.state === 'unchecked') setState('error', err?.message);
  }
  return aiStatus();
}

/* ------------------------------ helpers ------------------------------ */

// Small local models can fall into a repetition loop inside one string or list and keep
// generating until the token limit (observed: one field repeating for 7 000+ tokens).
// Ollama enforces maxLength/maxItems in its JSON grammar, so every string and list sent as
// `format` gets a sane bound unless the schema sets its own. Zod validation is unchanged.
const FORMAT_LIMITS = { string: 500, stringList: 12, objectList: 40 };
function bounded(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.forEach(bounded), node;
  const types = [].concat(node.type || []);
  if (types.includes('string') && !node.enum && node.maxLength == null) node.maxLength = FORMAT_LIMITS.string;
  if (types.includes('array') && node.maxItems == null) node.maxItems = node.items?.type === 'object' ? FORMAT_LIMITS.objectList : FORMAT_LIMITS.stringList;
  Object.values(node).forEach(bounded);
  return node;
}

const schemaCache = new WeakMap();
function jsonSchemaFor(schema) {
  if (!schemaCache.has(schema)) {
    const js = bounded(z.toJSONSchema(schema));
    delete js.$schema;
    schemaCache.set(schema, js);
  }
  return schemaCache.get(schema);
}

/** Accepts a string or Anthropic-style content blocks ({type:'text'|'image'}). */
function userMessage(content) {
  if (typeof content === 'string') return { role: 'user', content };
  const texts = [];
  const images = [];
  for (const b of content || []) {
    if (b.type === 'text') texts.push(b.text);
    else if (b.type === 'image' && b.source?.data) images.push(b.source.data);
  }
  return images.length ? { role: 'user', content: texts.join('\n'), images } : { role: 'user', content: texts.join('\n') };
}

/** Thinking is opt-in (OLLAMA_THINK=true): it is slow on small local GPUs. */
/**
 * Ollama Cloud runs as short-lived serverless instances that may never call /api/health, so the
 * model's capabilities are fetched once per instance on first use. Knowing them lets the client
 * switch thinking off explicitly (a thinking model otherwise reasons first and may put its
 * answer in the reasoning instead of the reply).
 */
let capsPromise = null;
async function ensureCapabilities() {
  if (status.capabilities || !config.ai.cloud) return;
  capsPromise ||= ollama('/api/show', { model: config.ai.model }, { timeoutMs: 15000 })
    .then((show) => { if (Array.isArray(show?.capabilities)) status.capabilities = show.capabilities; })
    .catch(() => { capsPromise = null; });
  await capsPromise;
}

const thinkParam = (effort) => (status.capabilities?.includes('thinking') ? { think: config.ai.think && effort !== 'low' } : {});
const stripThink = (s = '') => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

// keep_alive only matters for a local server (cloud models stay loaded).
const baseRequest = () => ({ model: config.ai.model, stream: false, ...(config.ai.cloud ? {} : { keep_alive: config.ai.keepAlive }) });

// Measured on qwen3-vl: a photo of up to ~1024 px costs ~1 050 prompt tokens, a 1600 px photo ~1 900.
const IMAGE_TOKENS = 1100;
/** Rough prompt size (≈3.2 characters per token for mixed text/JSON), used only to size the context. */
function estimatePromptTokens(system, user) {
  return Math.ceil(((system || '').length + (user.content || '').length) / 3.2) + (user.images?.length || 0) * IMAGE_TOKENS + 32;
}
/**
 * The configured context whenever the request fits, so the loaded model is reused. Only a
 * request that genuinely does not fit (e.g. many photos) gets a larger context for that call,
 * which costs a one-off model reload.
 */
function contextFor(promptTokens, numPredict) {
  const need = promptTokens + numPredict + 64;
  if (need <= config.ai.numCtx) return config.ai.numCtx;
  const ctx = Math.ceil(need / 1024) * 1024;
  console.log(`[ai] request needs ~${need} tokens; using num_ctx ${ctx} for this call (model reload)`);
  return ctx;
}

/* ------------------------------ public API ------------------------------ */

/**
 * Structured call: returns data validated against `schema` (zod). The schema is also
 * sent to Ollama as `format`, which constrains generation to valid JSON. Retries once
 * when the output is cut off or does not validate, then fails with a clear error.
 */
export async function structured({ system, content, schema, effort = 'medium', maxTokens = 2000, label = 'structured', onProgress }) {
  ensureEnabled('AI analysis');
  const user = userMessage(content);
  if (user.images?.length && status.capabilities && !status.capabilities.includes('vision')) {
    throw new AIError('The installed AI model can’t read photos. You can still add items by hand.', 422, 'ai_no_vision');
  }
  await ensureCapabilities();
  const js = jsonSchemaFor(schema);
  // Prompt mode: the JSON shape is described in the instructions instead of sent as `format`.
  const promptMode = config.ai.jsonMode === 'prompt';
  const sys = promptMode ? `${system}\n\n${schemaPrompt(js)}` : system;
  const prefill = promptMode ? prefillFor(js) : '';
  const promptTokens = estimatePromptTokens(sys, user);
  let numPredict = maxTokens;
  let correction = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const data = await chat({
      ...baseRequest(),
      ...(promptMode ? {} : { format: js }),
      messages: [{ role: 'system', content: sys }, user, ...(correction ? [correction] : []), ...(prefill ? [{ role: 'assistant', content: prefill }] : [])],
      options: modelOptions({ num_ctx: contextFor(promptTokens, numPredict), num_predict: numPredict, temperature: 0.3 }),
      ...thinkParam(effort),
    }, { label, onToken: onProgress });
    if (data?.done_reason === 'length') {
      console.warn(`[ai] ${label}: output hit the ${numPredict}-token limit`);
      if (attempt === 1) {
        // One retry with more room — still bounded, so a looping model can't run for hours.
        numPredict = Math.round(numPredict * 1.5);
        continue;
      }
      throw new AIError('The AI response was cut off. Try fewer photos or a smaller request.', 502, 'ai_truncated', true);
    }
    const content = stripThink(data?.message?.content || '');
    // AI_DEBUG=1 logs raw replies (to diagnose a model's output format, e.g. in Vercel logs).
    if (process.env.AI_DEBUG === '1') console.log(`[ai] ${label} raw reply (${content.length} chars): ${content.slice(0, 1500)}`);
    // With a prefill the reply normally continues it; a server or model that ignores the prefill
    // starts its own object instead. A thinking model may leave the answer in its reasoning.
    const continued = prefill && !content.trimStart().startsWith('{') ? extractJSON(prefill + content) : null;
    const value = continued ?? extractJSON(content) ?? extractJSON(data?.message?.thinking || '');
    const check = value == null ? null : schema.safeParse(conformToSchema(value, js));
    if (check?.success) return check.data;
    const why = !content.trim() ? 'empty reply' : value == null ? 'no JSON found' : check.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    console.warn(`[ai] ${label}: unusable output (attempt ${attempt}, ${why}): ${content.slice(0, 160).replace(/\s+/g, ' ')}`);
    // Retry once with a short, explicit correction.
    correction = { role: 'user', content: `Your previous reply could not be used (${why}). Reply again with ONLY the JSON object described in the instructions — no other text, no code fences.` };
  }
  throw new AIError('The AI returned an unusable result. Please try again.', 502, 'ai_invalid_output', true);
}

/** Free-text call. */
export async function text({ system, messages, effort = 'low', maxTokens = 1000, label = 'text' }) {
  ensureEnabled('AI');
  const msgs = messages.map((m) => (m.role === 'user' ? userMessage(m.content) : { role: m.role, content: String(m.content) }));
  const promptTokens = msgs.reduce((n, m) => n + estimatePromptTokens('', m), estimatePromptTokens(system, { content: '' }));
  const data = await chat({
    ...baseRequest(),
    messages: [{ role: 'system', content: system }, ...msgs],
    options: modelOptions({ num_ctx: contextFor(promptTokens, maxTokens), num_predict: maxTokens, temperature: 0.4 }),
    ...thinkParam(effort),
  }, { label });
  return stripThink(data?.message?.content || '');
}

const QueryPlan = z.object({ queries: z.array(z.string()).describe('short, specific web search queries, most useful first') });
const SYSTEM_QUERIES = 'You plan web searches for a research task. Write short, specific search queries (3–8 words each) in plain language that would find the information the task needs: build guides, tutorials, specifications, listings or official pages. No quotes or operators. Do not answer the task.';
const SKIP_FETCH = /(youtube\.com|youtu\.be|pinterest\.|instagram\.com|facebook\.com|tiktok\.com|amazon\.|ebay\.|x\.com|twitter\.com|reddit\.com\/media)/i;

function evidenceBlock(results, pages) {
  const lines = ['Web search results (the ONLY sources you may cite — use these exact URLs):'];
  results.forEach((r, i) => lines.push(`[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet || '(no snippet)'}`));
  if (pages.length) {
    lines.push('', 'Pages read in full (excerpts):');
    pages.forEach((p) => lines.push(`--- ${p.title || p.url} | ${p.url}\n${p.text.slice(0, 2500)}`));
  }
  return lines.join('\n');
}

/**
 * Web research. The application runs real searches (and optional page reads), then the
 * model writes its answer from those results only. Returns { text, sources, searches,
 * fetches } where `sources` maps normalised URL → {url,title} for every URL the searches
 * actually returned; callers must drop anything cited outside it.
 */
export async function webResearch({ system, prompt, maxUses = 6, fetch = false, maxFetches = 2, schema = null }) {
  // Evidence stays small so the prompt fits the normal context (a larger one forces a model reload).
  maxFetches = Math.min(maxFetches, 2);
  ensureEnabled('Web research');
  if (!searchAvailable()) throw new AIError('Web research isn’t set up on this installation.', 503, 'search_not_configured');

  const plan = await structured({ system: SYSTEM_QUERIES, content: `Research task:\n${prompt}\n\nWrite up to ${maxUses} search queries.`, schema: QueryPlan, effort: 'low', maxTokens: 600 });
  const queries = [...new Set(plan.queries.map((q) => q.trim()).filter(Boolean))].slice(0, maxUses);
  if (!queries.length) queries.push(prompt.split('\n')[0].slice(0, 120));

  const sources = new Map();
  const results = [];
  const firstPerQuery = [];
  let searches = 0;
  let lastErr = null;
  for (const q of queries) {
    try {
      const found = await webSearch(q, { max: 5 });
      searches += 1;
      found.forEach((r, i) => {
        const key = normalizeUrl(r.url);
        if (sources.has(key)) return;
        sources.set(key, { url: r.url, title: r.title });
        results.push(r);
        if (i === 0) firstPerQuery.push(r);
      });
    } catch (err) {
      lastErr = err;
      console.warn(`[search] "${q}" failed: ${err.message}`);
      if (err.code === 'search_rate_limited' || err.code === 'search_not_configured') break;
    }
  }
  if (!searches) throw new AIError(lastErr?.code === 'search_rate_limited' ? lastErr.message : 'Web search is unavailable right now. Please try again.', 503, 'search_unavailable', true);

  const pages = [];
  if (fetch) {
    const candidates = [...firstPerQuery, ...results].filter((r, i, a) => a.indexOf(r) === i && !SKIP_FETCH.test(r.url));
    for (const r of candidates) {
      if (pages.length >= maxFetches) break;
      try {
        const p = await fetchPage(r.url);
        if (p.text.length < 300) continue;
        pages.push(p);
        if (p.url !== r.url) sources.set(normalizeUrl(p.url), { url: p.url, title: p.title || r.title });
      } catch (err) {
        console.warn(`[search] could not read ${r.url}: ${err.message}`);
      }
    }
  }

  const content = `${prompt}\n\n${evidenceBlock(results.slice(0, 15), pages)}\n\nUse only the sources above and cite them by their exact URL. If none are relevant, say so instead of guessing.`;
  const sys = `${system}\n\nThe application has already run the web searches for you; the results are in the user message. You cannot search further.`;
  const out = schema
    ? JSON.stringify(await structured({ system: sys, content, schema, effort: 'medium', maxTokens: 2500, label: 'research summary' }))
    : await text({ system: sys, messages: [{ role: 'user', content }], effort: 'medium', maxTokens: 1200, label: 'research summary' });
  return { text: out, sources, searches, fetches: pages.length, queries };
}

const ASSISTANT_TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Search the web. Use for tutorials, build guides, current prices, fees or anything not in the app data.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'short search query' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'Read a page returned by web_search to get its details.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
];

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const trimUrl = (u) => u.replace(/[.,;:!?]+$/, '');

/** Keep only links that came from a real search (or the app's own data); remove the rest. */
function verifyLinks(reply, allowed) {
  const cited = new Map();
  const ok = (u) => allowed.get(normalizeUrl(trimUrl(u)));
  let out = reply.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, title, url) => {
    const hit = ok(url);
    if (!hit) return title;
    cited.set(hit.url, { url: hit.url, title: hit.title || title });
    return m;
  });
  out = out.replace(URL_RE, (u) => {
    if (out.includes(`](${u}`)) return u;
    const hit = ok(u);
    if (!hit) return '(link removed — not from a search result)';
    cited.set(hit.url, { url: hit.url, title: hit.title || hit.url });
    return u;
  });
  return { text: out, sources: [...cited.values()] };
}

/**
 * Assistant turn. When the model supports tool calls and search is set up, it may call
 * web_search / web_fetch, which the app executes for real. Returns the reply text plus the
 * sources it linked (only URLs that searches really returned or that the app data holds).
 */
export async function chatWithResearch({ system, messages, effort = 'low' }) {
  if (!aiConfigured()) throw notConfigured();
  ensureEnabled('The assistant');
  let useTools = searchAvailable() && (!status.capabilities || status.capabilities.includes('tools'));
  const allowed = new Map();
  for (const m of messages) if (m.role === 'user') for (const u of String(m.content).match(URL_RE) || []) allowed.set(normalizeUrl(trimUrl(u)), { url: trimUrl(u), title: '' });
  const note = useTools ? '\nYou can call web_search and web_fetch. Only give links that those tools returned.' : '\nWeb search is not available right now: do not give links, and say so if the user asks for online sources.';
  const convo = [{ role: 'system', content: system + note }, ...messages.map((m) => ({ role: m.role, content: String(m.content) }))];
  let searched = false;
  let reply = '';
  for (let round = 0; round < 5; round++) {
    const offerTools = useTools && round < 4;
    let data;
    try {
      data = await chat({ ...baseRequest(), messages: convo, ...(offerTools ? { tools: ASSISTANT_TOOLS } : {}), options: modelOptions({ num_predict: 700, temperature: 0.4 }), ...thinkParam(effort) }, { label: 'assistant' });
    } catch (err) {
      if (err.code === 'ai_no_tools' && useTools) {
        useTools = false;
        convo[0] = { role: 'system', content: system + '\nWeb search is not available with this model: do not give links.' };
        continue;
      }
      throw err;
    }
    const msg = data?.message || {};
    if (offerTools && msg.tool_calls?.length) {
      convo.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        const name = call.function?.name;
        const args = typeof call.function?.arguments === 'string' ? extractJSON(call.function.arguments) || {} : call.function?.arguments || {};
        let result;
        try {
          if (name === 'web_search') {
            searched = true;
            const found = await webSearch(String(args.query || ''), { max: 5 });
            found.forEach((r) => allowed.set(normalizeUrl(r.url), { url: r.url, title: r.title }));
            result = found.length ? found.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n') : 'No results.';
          } else if (name === 'web_fetch') {
            const known = allowed.get(normalizeUrl(String(args.url || '')));
            if (!known) result = 'Only pages returned by web_search can be read.';
            else {
              const p = await fetchPage(known.url);
              result = `${p.title}\n${p.text}`;
            }
          } else result = `Unknown tool ${name}.`;
        } catch (err) {
          result = `Tool error: ${err.message}`;
        }
        convo.push({ role: 'tool', tool_name: name, content: result });
      }
      continue;
    }
    reply = stripThink(msg.content || '');
    break;
  }
  const v = verifyLinks(reply, allowed);
  return { text: v.text, sources: v.sources, searched };
}

// The robust parser lives in ./json.js; re-exported here for existing callers.
export { extractJSON };

/**
 * Comparison key for URLs: host + path + meaningful query. The query matters
 * (youtube.com/watch?v=A and ?v=B are different pages); tracking parameters don't.
 */
export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    const params = [...url.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid$|gclid$|ref$|ref_src$|si$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    return `${url.hostname.replace(/^www\.|^m\./, '').toLowerCase()}${url.pathname.replace(/\/$/, '').toLowerCase()}${query}`;
  } catch {
    return String(u).toLowerCase();
  }
}
