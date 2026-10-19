// AI client for Google Gemini (official @google/genai SDK, model gemini-3.8-flash).
//
// Every structured call uses Gemini's JSON mode with a JSON schema (responseJsonSchema) and is
// validated with zod on the server before anything reaches the UI or the database. Invalid
// output is retried once; if it is still unusable the caller gets an honest error — never a
// made-up result.
//
// The API key comes only from GEMINI_API_KEY on the server. It is never sent to the browser,
// never included in API responses and never logged.
import { AsyncLocalStorage } from 'node:async_hooks';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { config } from '../config.js';
import { webSearch, fetchPage, searchAvailable, searchStatus } from './search.js';
import { extractJSON, conformToSchema, toGeminiSchema } from './json.js';

const missingKey = !config.ai.apiKey;
const status = { state: !config.ai.enabled ? 'unconfigured' : missingKey ? 'missing_key' : 'unchecked', checkedAt: null, detail: null, lastRejection: null, invalidArgument: null, requestAdjustments: [], lastTimeout: null };

export const aiConfigured = () => config.ai.enabled && !missingKey;
/** True when AI calls can be attempted (configured, and the key/model weren't rejected). */
export const aiEnabled = () => aiConfigured() && !['model_unavailable', 'unauthorized'].includes(status.state);

const MAINTAINER_HINTS = {
  unconfigured: 'AI is switched off (AI_ENABLED=false). Remove that setting and restart the server.',
  missing_key: 'Gemini needs an API key: set GEMINI_API_KEY on the server (locally in .env; on Vercel in Project → Settings → Environment Variables, then redeploy).',
  unauthorized: 'Gemini rejected the API key. Check GEMINI_API_KEY (create one at https://aistudio.google.com/apikey), then restart or redeploy.',
  rate_limited: 'Gemini is rate-limiting this API key (quota reached). Wait a little, or raise the quota in Google AI Studio.',
  model_unavailable: () => `Model "${config.ai.model}" is not available for this API key.`,
  unreachable: 'Gemini could not be reached from the server. Check the network connection.',
  error: () => status.detail,
};

export function aiStatus() {
  const hint = MAINTAINER_HINTS[status.state];
  const search = searchStatus();
  return {
    configured: aiConfigured(),
    available: aiEnabled(),
    state: status.state,
    provider: 'gemini',
    model: config.ai.model,
    // Names where the credential comes from — never the key itself.
    credentialSource: aiConfigured() ? 'GEMINI_API_KEY (server-side)' : null,
    search,
    checkedAt: status.checkedAt,
    // Google's message for the last request it rejected (400) — never contains the key.
    lastRejection: status.lastRejection,
    // Found by removing request features one at a time after a 400 (see generate()).
    invalidArgument: status.invalidArgument,
    requestAdjustments: status.requestAdjustments,
    // The last Gemini call that ran out of time: which stage, after how long.
    lastTimeout: status.lastTimeout,
    // While rate-limited: when Gemini may be called again.
    retryAt: status.state === 'rate_limited' && status.retryAt > Date.now() ? new Date(status.retryAt).toISOString() : null,
    maintainerHint: (typeof hint === 'function' ? hint() : hint) || (!search.available ? `Web research is off: ${search.missing ? `set ${search.missing}` : 'SEARCH_PROVIDER=off'}.` : null),
  };
}

function setState(state, detail = null) {
  if (state !== 'rate_limited') status.retryAt = 0;
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
  if (!aiEnabled()) throw new AIError(`${what} is unavailable right now. Please try again later.`, 503, 'ai_unavailable');
  // After a 429, wait as long as Google asked (or a minute) before sending anything again —
  // retrying straight away only extends the rate limit.
  const waitMs = (status.retryAt || 0) - Date.now();
  if (status.state === 'rate_limited' && waitMs > 0) {
    console.warn(`[ai] not calling Gemini: rate-limited for ${Math.ceil(waitMs / 1000)} more s`);
    throw busyError(Math.ceil(waitMs / 1000));
  }
}

/** Throws the "busy" error while Gemini's rate-limit wait is in force (call before doing any work). */
export function checkRateLimit() {
  const waitMs = (status.retryAt || 0) - Date.now();
  if (status.state === 'rate_limited' && waitMs > 0) throw busyError(Math.ceil(waitMs / 1000));
}

/** Ends a rate-limit wait early (tests; or a maintainer who raised the quota). */
export function clearRateLimit() {
  status.retryAt = 0;
}

/** The one clean rate-limit answer: how long to wait, retryable. */
function busyError(seconds) {
  const wait = seconds >= 90 ? `about ${Math.round(seconds / 60)} minutes` : `about ${Math.max(5, seconds)} seconds`;
  return Object.assign(new AIError(`The AI service is busy right now (Gemini rate limit). Please wait ${wait} and try again.`, 503, 'ai_rate_limited', true), { retryAfter: Math.max(1, seconds) });
}

/**
 * How long Google wants us to wait after a 429: the Retry-After header, else the RetryInfo
 * "retryDelay" in the error body, else 60 s.
 */
function retryAfterSeconds(msg) {
  const header = lastRetryAfter;
  lastRetryAfter = null;
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  const delay = String(msg).match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (delay) return Math.max(1, Math.ceil(Number(delay[1])));
  return 60;
}

/**
 * Per-request scope set by server/app.js: when the browser disconnects, its signal aborts the
 * Gemini request so abandoned work stops.
 */
export const requestScope = new AsyncLocalStorage();

/* ------------------------------ Gemini calls ------------------------------ */

let client = null;
let lastRetryAfter = null;
const GENERATION_URL = /:(generateContent|streamGenerateContent)\b|\/interactions\b/;
/**
 * The SDK's HTTP requests go through here: every generation request is counted on the current
 * API request (requestScope → geminiCalls), and a 429's Retry-After header is kept for mapError.
 * The SDK itself does not retry (no retryOptions are set).
 */
async function countingFetch(url, init) {
  const store = requestScope.getStore();
  if (store && GENERATION_URL.test(String(url))) store.geminiCalls = (store.geminiCalls || 0) + 1;
  const res = await fetch(url, init);
  if (res.status === 429) lastRetryAfter = res.headers.get('retry-after');
  return res;
}

export function gemini() {
  client ||= new GoogleGenAI({ apiKey: config.ai.apiKey, httpOptions: { ...(config.ai.baseUrl ? { baseUrl: config.ai.baseUrl } : {}), fetch: countingFetch } });
  return client;
}

// Thinking level for quick calls (LOW is valid for gemini-3.8-flash; MINIMAL is not).
const thinkingFor = (effort) => (effort === 'low' ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {});

/*
 * Optional request features, in the order they are removed when Gemini answers 400
 * INVALID_ARGUMENT. Removing them one at a time until Gemini accepts the request identifies the
 * invalid argument with the real API (logged, and shown in /api/health). What was found stays
 * off for later calls on this server instance; replies are still validated with zod.
 */
const OPTIONAL_FEATURES = ['thinkingConfig', 'responseJsonSchema', 'maxOutputTokens', 'systemInstruction', 'responseMimeType'];
const rejected = new Set();

const hasFeature = (cfg, f) => cfg[f] !== undefined;

/** The request without the features in `off`; their content is kept where it matters. */
function withoutFeatures(contents, cfg, off) {
  const out = { ...cfg };
  let sys = cfg.systemInstruction || '';
  if (off.has('thinkingConfig')) delete out.thinkingConfig;
  if (off.has('maxOutputTokens')) delete out.maxOutputTokens;
  if (off.has('responseJsonSchema') && cfg.responseJsonSchema) {
    delete out.responseJsonSchema;
    sys += `\n\nReply with ONE JSON object that follows this JSON Schema exactly:\n${JSON.stringify(cfg.responseJsonSchema)}`;
  }
  if (off.has('responseMimeType') && cfg.responseMimeType) {
    delete out.responseMimeType;
    sys += '\n\nReply with the JSON only — no prose, no code fences.';
  }
  let turns = contents;
  delete out.systemInstruction;
  if (sys && off.has('systemInstruction')) {
    // Instructions as a text part at the start of the first user turn.
    const i = turns.findIndex((c) => c.role === 'user');
    turns = turns.map((c, j) => (j === i ? { ...c, parts: [{ text: `Instructions:\n${sys}` }, ...(c.parts || [])] } : c));
  } else if (sys) {
    // The REST form ({parts:[…]}, no role); a plain string would be sent with role "user".
    out.systemInstruction = { parts: [{ text: sys }] };
  }
  return { contents: turns, cfg: out };
}

/** What was sent, for the logs — never content, keys or secrets. */
function describeRequest(contents, cfg, stream) {
  const parts = contents.flatMap((c) => c.parts || []);
  return [
    `model=${config.ai.model}`,
    `method=${stream ? 'generateContentStream' : 'generateContent'}`,
    `config keys=[${Object.keys(cfg).join(', ')}]`,
    `structured output=${cfg.responseJsonSchema ? 'yes' : 'no'}`,
    `responseMimeType=${cfg.responseMimeType || 'none'}`,
    `schema=${cfg.responseJsonSchema ? `${JSON.stringify(cfg.responseJsonSchema).length} B` : 'none'}`,
    `tools=${cfg.tools ? cfg.tools.flatMap((t) => (t.functionDeclarations || []).map((d) => d.name)).join('/') || 'yes' : 'none'}`,
    `thinking=${cfg.thinkingConfig?.thinkingLevel || 'default'}`,
    `maxOutputTokens=${cfg.maxOutputTokens ?? 'default'}`,
    `systemInstruction=${cfg.systemInstruction ? 'yes' : 'no'}`,
    `turns=${contents.map((c) => c.role).join('/')}`,
    `text parts=${parts.filter((p) => p.text != null).length}`,
    `images=${parts.filter((p) => p.inlineData).length}${parts.some((p) => p.inlineData) ? ` (${[...new Set(parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType))].join(', ')})` : ''}`,
    `function parts=${parts.filter((p) => p.functionCall || p.functionResponse).length}`,
  ].join(', ');
}

/** Turns an SDK/network error into a user-safe AIError and records the cause for maintainers. */
function mapError(err, { timedOut, cancelled }) {
  if (cancelled) return new AIError('The request was cancelled.', 499, 'cancelled');
  if (timedOut) return new AIError('The AI took too long to answer. Please try again.', 504, 'ai_timeout', true);
  const code = Number(err?.status) || 0;
  // Google's message names the rejected field (e.g. "Invalid value at 'generation_config…'").
  // The SDK's messages don't contain the key; log the status and message only.
  const msg = String(err?.message || '').slice(0, 2000);
  console.error(`[ai] gemini error ${code || ''}: ${msg}`);
  if (code === 401 || code === 403 || /api key not valid|API_KEY_INVALID|permission denied/i.test(msg)) {
    setState('unauthorized', msg);
    return new AIError('The AI service isn’t available right now (it could not be authorised).', 503, 'ai_unauthorized');
  }
  if (code === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    const seconds = retryAfterSeconds(msg);
    setState('rate_limited', msg);
    status.retryAt = Date.now() + seconds * 1000;
    console.error(`[ai] Gemini 429 rate limit — no further Gemini requests for ${seconds} s`);
    return busyError(seconds);
  }
  if (code === 404) {
    setState('model_unavailable', msg);
    return new AIError('AI analysis is unavailable: the configured AI model isn’t available.', 503, 'ai_unavailable');
  }
  if (code >= 500) return new AIError('The AI service is temporarily unavailable. Please try again.', 503, 'ai_unavailable_temp', true);
  if (code === 400) {
    status.lastRejection = { at: new Date().toISOString(), message: msg.slice(0, 500) };
    return Object.assign(new AIError('The AI service could not process this request.', 422, 'ai_bad_request'), { detail: msg });
  }
  setState('unreachable', msg);
  return new AIError('The AI service could not be reached. Please try again in a moment.', 503, 'ai_unreachable', true);
}


// What the user is told when a stage runs out of time.
const STAGE_TEXT = [
  [/parse/i, 'while reading your materials'],
  [/idea/i, 'while designing products'],
  [/plan/i, 'while writing the build guide'],
  [/scan|photo/i, 'while looking at the photos'],
];
const stageText = (label) => STAGE_TEXT.find(([re]) => re.test(label))?.[1] || '';

/** Time left before `deadline` (ms since epoch), capped at AI_TIMEOUT_MS. */
const limitFor = (deadline) => Math.max(1000, Math.min(config.ai.timeoutMs, deadline ? deadline - Date.now() : Infinity));

/** One request with a timeout and browser-disconnect cancellation. */
async function generateOnce({ contents, cfg, label, onText, deadline }) {
  const controller = new AbortController();
  const clientGone = requestScope.getStore()?.signal;
  let timedOut = false;
  const onGone = () => controller.abort();
  clientGone?.addEventListener('abort', onGone, { once: true });
  const limitMs = limitFor(deadline);
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
  const t0 = Date.now();
  try {
    const request = { model: config.ai.model, contents, config: { ...cfg, abortSignal: controller.signal } };
    let out;
    if (onText) {
      let text = '';
      let last = null;
      for await (const chunk of await gemini().models.generateContentStream(request)) {
        const piece = chunk.text || '';
        if (piece) onText((text += piece));
        last = chunk;
      }
      out = { text, functionCalls: last?.functionCalls || [], content: last?.candidates?.[0]?.content, finishReason: last?.candidates?.[0]?.finishReason, usage: last?.usageMetadata };
    } else {
      const res = await gemini().models.generateContent(request);
      out = { text: res.text || '', functionCalls: res.functionCalls || [], content: res.candidates?.[0]?.content, finishReason: res.candidates?.[0]?.finishReason, usage: res.usageMetadata, blocked: res.promptFeedback?.blockReason };
    }
    if (!['ready'].includes(status.state)) setState('ready');
    const u = out.usage || {};
    console.log(`[ai] ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s · prompt ${u.promptTokenCount ?? '?'} tok · output ${u.candidatesTokenCount ?? '?'} tok${u.thoughtsTokenCount ? ` · thinking ${u.thoughtsTokenCount} tok` : ''} · ${out.finishReason || 'STOP'}`);
    return out;
  } catch (err) {
    const mapped = mapError(err, { timedOut, cancelled: !timedOut && clientGone?.aborted });
    if (mapped.code === 'ai_bad_request') console.error(`[ai] ${label}: Gemini rejected the request (400). Sent: ${describeRequest(contents, cfg, Boolean(onText))}`);
    if (mapped.code === 'ai_timeout') {
      const afterMs = Date.now() - t0;
      // Which stage ran out of time, after how long, and with what request — never content or keys.
      console.error(`[perf] TIMEOUT in "${label}" after ${afterMs} ms (limit ${limitMs} ms) · ${describeRequest(contents, cfg, Boolean(onText))}`);
      status.lastTimeout = { stage: label, afterMs, limitMs, at: new Date().toISOString() };
      mapped.stage = label;
      mapped.message = `The AI took too long to answer${stageText(label) ? ` ${stageText(label)}` : ''}. Please try again.`;
    }
    throw mapped;
  } finally {
    clearTimeout(timer);
    clientGone?.removeEventListener('abort', onGone);
  }
}

/**
 * A generateContent call. With `onText` the reply is streamed and onText(textSoFar) is called as
 * it arrives (real progress). Returns { text, functionCalls, content, finishReason, usage }.
 * On 400 INVALID_ARGUMENT, optional features are removed one at a time until Gemini accepts the
 * request; the last one removed is reported as the invalid argument.
 */
async function generate({ contents, cfg, label, onText, deadline }) {
  const off = new Set([...rejected].filter((f) => hasFeature(cfg, f)));
  const tried = [];
  for (;;) {
    const req = withoutFeatures(contents, cfg, off);
    try {
      const out = await generateOnce({ ...req, label: tried.length ? `${label} (without ${[...off].join(', ')})` : label, onText, deadline });
      if (tried.length) {
        const culprit = tried.at(-1);
        rejected.add(culprit);
        status.requestAdjustments = [...rejected];
        status.invalidArgument = { feature: culprit, call: label, at: new Date().toISOString(), message: status.lastRejection?.message || null };
        console.warn(`[ai] ${label}: Gemini accepted the request once "${culprit}" was removed — "${culprit}" is the invalid argument. It stays off for later calls${tried.length > 1 ? ` (${tried.slice(0, -1).join(', ')} only had to be removed on the way)` : ''}.`);
      }
      return out;
    } catch (err) {
      if (err.code !== 'ai_bad_request') throw err;
      const next = OPTIONAL_FEATURES.find((f) => !off.has(f) && hasFeature(cfg, f));
      if (!next) {
        console.error(`[ai] ${label}: still rejected with every optional feature removed${tried.length ? ` (${tried.join(', ')})` : ''} — the invalid argument is in the core request (model, contents or tools).`);
        throw err;
      }
      off.add(next);
      tried.push(next);
      console.warn(`[ai] ${label}: retrying without ${next}`);
    }
  }
}

/** Checks the key and the model with a metadata call (no generation, no tokens used). */
export async function probeAI() {
  if (!aiConfigured()) {
    setState(missingKey && config.ai.enabled ? 'missing_key' : 'unconfigured');
    return aiStatus();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    await gemini().models.get({ model: config.ai.model, config: { abortSignal: controller.signal } });
    // A rate limit is only cleared by a successful generation.
    if (status.state !== 'rate_limited') setState('ready');
  } catch (err) {
    mapError(err, { timedOut: controller.signal.aborted });
  } finally {
    clearTimeout(timer);
  }
  return aiStatus();
}

/* ------------------------------ helpers ------------------------------ */

const schemaCache = new WeakMap();
/** { raw, gemini }: the zod schema as JSON Schema (for repair) and in Gemini's accepted subset. */
function schemasFor(schema) {
  if (!schemaCache.has(schema)) {
    const raw = z.toJSONSchema(schema);
    delete raw.$schema;
    schemaCache.set(schema, { raw, gemini: toGeminiSchema(raw) });
  }
  return schemaCache.get(schema);
}

/** User content (a string, or Anthropic-style blocks {type:'text'|'image'}) as Gemini parts. */
function toParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  const parts = [];
  for (const b of content || []) {
    if (b.type === 'text') parts.push({ text: b.text });
    else if (b.type === 'image' && b.source?.data) parts.push({ inlineData: { mimeType: b.source.media_type || 'image/jpeg', data: b.source.data } });
  }
  return parts;
}

/* ------------------------------ public API ------------------------------ */

/**
 * Structured call: returns data validated against `schema` (zod). Gemini is asked for JSON that
 * follows the schema; the reply is still parsed defensively, repaired for small slips and
 * validated. One retry with a correction when it doesn't validate (or was cut off).
 */
export async function structured({ system, content, schema, effort = 'medium', maxTokens = 2000, label = 'structured', onProgress, deadline }) {
  ensureEnabled('AI analysis');
  const { raw, gemini: responseJsonSchema } = schemasFor(schema);
  const contents = [{ role: 'user', parts: toParts(content) }];
  let outputTokens = Math.max(1024, maxTokens * 2); // thinking models need headroom beyond the answer itself
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await generate({
      contents,
      cfg: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema, maxOutputTokens: outputTokens, ...thinkingFor(effort) },
      label,
      onText: onProgress,
      deadline,
    });
    if (res.blocked || res.finishReason === 'SAFETY' || res.finishReason === 'PROHIBITED_CONTENT') {
      throw new AIError('The AI declined this request. Try describing your materials differently.', 422, 'ai_blocked');
    }
    if (process.env.AI_DEBUG === '1') console.log(`[ai] ${label} raw reply (${res.text.length} chars): ${res.text.slice(0, 1500)}`);
    const value = extractJSON(res.text);
    const check = value == null ? null : schema.safeParse(conformToSchema(value, raw));
    if (check?.success) return check.data;
    const why = res.finishReason === 'MAX_TOKENS' ? 'the answer was cut off' : !res.text.trim() ? 'empty reply' : value == null ? 'no JSON found' : check.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    console.warn(`[ai] ${label}: unusable output (attempt ${attempt}, ${why})`);
    if (res.finishReason === 'MAX_TOKENS') outputTokens = Math.round(outputTokens * 1.6);
    // Retry once with an explicit correction — unless the request's time is nearly used up, in
    // which case a second attempt would only end in a timeout.
    if (attempt === 1 && deadline && deadline - Date.now() < 15000) {
      console.warn(`[perf] ${label}: no time left for a retry (${Math.max(0, deadline - Date.now())} ms)`);
      break;
    }
    if (attempt === 1) contents.push({ role: 'user', parts: [{ text: `Your previous reply could not be used (${why}). Reply again with the complete JSON object that follows the response schema.` }] });
  }
  throw new AIError('The AI returned an unusable result. Please try again.', 502, 'ai_invalid_output', true);
}

/** Free-text call. `messages` alternate {role:'user'|'assistant', content}. */
export async function text({ system, messages, effort = 'low', maxTokens = 1000, label = 'text' }) {
  ensureEnabled('AI');
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: m.role === 'user' ? toParts(m.content) : [{ text: String(m.content) }] }));
  const res = await generate({ contents, cfg: { systemInstruction: system, maxOutputTokens: Math.max(1024, maxTokens * 2), ...thinkingFor(effort) }, label });
  return (res.text || '').trim();
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
  ensureEnabled('Web research');
  if (!searchAvailable()) throw new AIError('Web research isn’t set up on this installation.', 503, 'search_not_configured');

  const plan = await structured({ system: SYSTEM_QUERIES, content: `Research task:\n${prompt}\n\nWrite up to ${maxUses} search queries.`, schema: QueryPlan, effort: 'low', maxTokens: 600, label: 'research queries' });
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

const ASSISTANT_TOOLS = [{
  functionDeclarations: [
    { name: 'web_search', description: 'Search the web. Use for tutorials, build guides, current prices, fees or anything not in the app data.', parametersJsonSchema: { type: 'object', properties: { query: { type: 'string', description: 'short search query' } }, required: ['query'] } },
    { name: 'web_fetch', description: 'Read a page returned by web_search to get its details.', parametersJsonSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  ],
}];

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
 * Assistant turn. When search is set up, Gemini may call web_search / web_fetch (function
 * calling), which the app executes for real. Returns the reply text plus the sources it linked
 * (only URLs that searches really returned or that the app data holds).
 */
export async function chatWithResearch({ system, messages, effort = 'low' }) {
  ensureEnabled('The assistant');
  const useTools = searchAvailable();
  const allowed = new Map();
  for (const m of messages) if (m.role === 'user') for (const u of String(m.content).match(URL_RE) || []) allowed.set(normalizeUrl(trimUrl(u)), { url: trimUrl(u), title: '' });
  const note = useTools ? '\nYou can call web_search and web_fetch. Only give links that those tools returned.' : '\nWeb search is not available right now: do not give links, and say so if the user asks for online sources.';
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
  let searched = false;
  let reply = '';
  for (let round = 0; round < 5; round++) {
    const offerTools = useTools && round < 4;
    const res = await generate({ contents, cfg: { systemInstruction: system + note, maxOutputTokens: 2048, ...(offerTools ? { tools: ASSISTANT_TOOLS } : {}), ...thinkingFor(effort) }, label: 'assistant' });
    if (offerTools && res.functionCalls.length) {
      // The model's own turn goes back unchanged (Gemini 3 needs its thought signatures).
      contents.push(res.content || { role: 'model', parts: res.functionCalls.map((fc) => ({ functionCall: fc })) });
      const responses = [];
      for (const call of res.functionCalls) {
        const args = call.args || {};
        let result;
        try {
          if (call.name === 'web_search') {
            searched = true;
            const found = await webSearch(String(args.query || ''), { max: 5 });
            found.forEach((r) => allowed.set(normalizeUrl(r.url), { url: r.url, title: r.title }));
            result = found.length ? found.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n') : 'No results.';
          } else if (call.name === 'web_fetch') {
            const known = allowed.get(normalizeUrl(String(args.url || '')));
            if (!known) result = 'Only pages returned by web_search can be read.';
            else {
              const p = await fetchPage(known.url);
              result = `${p.title}\n${p.text}`;
            }
          } else result = `Unknown tool ${call.name}.`;
        } catch (err) {
          result = `Tool error: ${err.message}`;
        }
        responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
      continue;
    }
    reply = (res.text || '').trim();
    break;
  }
  const v = verifyLinks(reply, allowed);
  return { text: v.text, sources: v.sources, searched };
}

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
