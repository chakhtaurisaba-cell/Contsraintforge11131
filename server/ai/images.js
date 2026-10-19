// Card pictures from Google's image model (default gemini-nano-banana-2.1, via the Interactions
// API of the official @google/genai SDK — the text model itself does not generate images).
//
// - One picture per idea, generated only when its card is on screen, never blocking the ideas.
// - Cached by a hash of the idea (model, name, kind, summary, materials), in memory and in the
//   database, so an identical idea is never paid for twice.
// - Capped per day (AI_IMAGE_DAILY_LIMIT) and at most 3 at a time per server instance.
// - The image models have NO free tier: on a key without billing they refuse, and the cards keep
//   their drawn concept illustration. A failed picture never fails anything else.
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { get, run, now } from '../db.js';
import { aiConfigured, gemini } from './client.js';
import { materialClass } from '../../shared/productKind.js';

const TIMEOUT_MS = 60000;
const MAX_PARALLEL = 3;
const memory = new Map(); // key → { src, model }

const status = { state: 'unchecked', reason: null, until: 0 };
const REASONS = {
  needs_billing: 'Image generation needs a paid Gemini API plan — Google’s image models have no free tier. Enable billing for this API key in Google AI Studio, or set AI_IMAGES=off.',
  model_unavailable: () => `Image model "${config.ai.images.model}" is not available for this API key (set GEMINI_IMAGE_MODEL to another image model).`,
  rate_limited: 'Image generation is rate-limited right now; pictures will be tried again in a minute.',
  daily_limit: () => `Today’s limit of ${config.ai.images.dailyLimit} generated pictures is reached (AI_IMAGE_DAILY_LIMIT).`,
  off: 'Image generation is switched off (AI_IMAGES=off).',
};
const reasonText = (code) => (typeof REASONS[code] === 'function' ? REASONS[code]() : REASONS[code]);

export class ImageError extends Error {
  constructor(code, message = reasonText(code)) {
    super(message || 'The picture could not be generated.');
    this.code = code;
    this.status = 503;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const usedToday = () => get('SELECT COUNT(*) AS n FROM idea_images WHERE created_at >= ?', today())?.n || 0;

export function imageStatus() {
  const enabled = config.ai.images.enabled && aiConfigured();
  const paused = status.until > Date.now();
  return {
    enabled,
    model: config.ai.images.model,
    state: !config.ai.images.enabled ? 'off' : !enabled ? 'unconfigured' : paused ? status.state : status.state === 'ready' ? 'ready' : 'unchecked',
    reason: paused ? reasonText(status.state) : null,
    usedToday: usedToday(),
    dailyLimit: config.ai.images.dailyLimit,
  };
}

/** Cache key: the same idea (what it is, what it's made of, how it's built) gets the same picture. */
export function imageKey(idea) {
  const materials = [...(idea.usesExisting || []).map((u) => u.inventoryName), ...(idea.missing || []).map((m) => m.name)].map((s) => String(s).toLowerCase().trim()).sort();
  const basis = JSON.stringify([config.ai.images.model, String(idea.name || '').toLowerCase().trim(), idea.kind || idea.visualKind || '', String(idea.summary || '').toLowerCase().trim(), String(idea.look || '').toLowerCase().trim(), (idea.steps || []).join('|').toLowerCase(), materials]);
  return createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

// What each material class looks like, to forbid the ones the design doesn't use.
const VISIBLE = {
  wood: 'wood', fastener: 'screws, nails, bolts or brackets', metal: 'metal parts', thread: 'rope, cord, string or laces',
  textile: 'fabric', electronics: 'wires, LEDs or electronics', glass: 'glass', plastic_bottle: 'plastic bottles',
  plastic: 'other plastic parts', cardboard: 'cardboard', paper: 'paper', finish: 'paint or varnish', ceramic: 'ceramic', concrete: 'concrete',
  wax: 'wax', wick: 'wicks',
};

/**
 * The compact visual specification the picture is drawn from — built only from the card itself
 * (its materials, quantities, look and steps), so the picture shows the same object as the card
 * and its build guide.
 */
export function visualSpec(idea) {
  const parts = [
    ...(idea.usesExisting || []).map((u) => ({ name: u.inventoryName, qty: u.quantityUsed, unit: u.unit, use: u.use })),
    ...(idea.missing || []).map((m) => ({ name: m.name, qty: m.quantity, unit: m.unit, use: m.why })),
  ];
  const classes = new Set(parts.map((p) => materialClass({ name: p.name })));
  const names = parts.map((p) => p.name.toLowerCase()).join(' ');
  const forbidden = Object.entries(VISIBLE).filter(([cls]) => !classes.has(cls)).map(([, label]) => label);
  // Adhesives: only the one the design uses may show.
  if (!/\btape\b/.test(names)) forbidden.push('tape');
  if (!/\bglue\b/.test(names)) forbidden.push('glue blobs');
  const steps = (idea.steps || []).map((s) => String(s).replace(/\s*\(use your [^)]*\)/, '')).slice(0, 6);
  const s = idea.size || {};
  const details = [
    s.length > 0 && `about ${[s.length, s.width, s.height].filter((v) => v > 0).map((v) => Math.round(v / 10)).join(' × ')} cm`,
    steps.some((x) => /\bcut/i.test(x)) && 'believable hand-cut edges',
    /\btape\b/.test(names) && 'tape visibly applied by hand, slightly uneven',
    classes.has('thread') && 'real knots and wraps where the cord is tied',
    'small handmade imperfections',
  ].filter(Boolean);
  return {
    projectName: idea.name,
    visibleMaterials: parts.map((p) => `${p.qty ? `${p.qty} ${p.unit || ''} `.replace(/\s+/g, ' ') : ''}${p.name}${p.use ? ` (${p.use})` : ''}`.trim()),
    finalShape: idea.look || idea.summary || '',
    constructionMethod: steps.join(' ').slice(0, 600),
    importantVisualDetails: details,
    forbiddenMaterials: forbidden,
  };
}

/** The prompt: one photorealistic, clearly handmade object, made of exactly the listed materials. */
export function imagePrompt(idea) {
  const v = visualSpec(idea);
  return [
    `Create a photorealistic image of the finished DIY object "${v.projectName}".`,
    v.finalShape && `What it looks like: ${v.finalShape}`,
    `It is realistically handmade from exactly these materials, and nothing else: ${v.visibleMaterials.join('; ') || 'the listed materials'}.`,
    v.constructionMethod && `How it was built (the picture must match this construction): ${v.constructionMethod}`,
    `Visible details: ${v.importantVisualDetails.join('; ')}.`,
    v.forbiddenMaterials.length && `Do not show any ${v.forbiddenMaterials.join(', ')} — none of these are part of it.`,
    'Do not introduce additional visible construction materials. Do not make it look factory manufactured, store-bought, acrylic, ceramic or professionally finished. Use believable imperfections and realistic DIY assembly.',
    'Show one clear finished object, whole and in focus, on a neutral realistic tabletop or workbench with soft natural light.',
    'No text, logos, captions, diagrams, labels, people or hands.',
  ].filter(Boolean).join('\n');
}

let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function classify(err) {
  const code = Number(err?.status) || 0;
  const msg = String(err?.message || '');
  if (code === 429 || /RESOURCE_EXHAUSTED|rate/i.test(msg)) return 'rate_limited';
  if (code === 404) return 'model_unavailable';
  if (/billing|free tier|paid|FAILED_PRECONDITION|not available in the free|PERMISSION_DENIED/i.test(msg) || code === 403) return 'needs_billing';
  return 'error';
}

/** Returns { src: 'data:image/jpeg;base64,…', model, cached } or throws ImageError. */
export async function ideaImage(idea) {
  if (!config.ai.images.enabled) throw new ImageError('off');
  if (!aiConfigured()) throw new ImageError('unconfigured', 'AI is not set up on this server.');
  const key = imageKey(idea);
  if (memory.has(key)) return { ...memory.get(key), cached: true };
  const row = get('SELECT mime, data, model FROM idea_images WHERE key = ?', key);
  if (row) {
    const hit = { src: `data:${row.mime};base64,${row.data}`, model: row.model };
    memory.set(key, hit);
    return { ...hit, cached: true };
  }
  if (status.until > Date.now()) throw new ImageError(status.state);
  if (usedToday() >= config.ai.images.dailyLimit) throw new ImageError('daily_limit');

  return slot(async () => {
    // One retry for a transient failure (timeout, empty answer); never for billing, rate limits or a missing model.
    try {
      return await generateOnce(idea, key);
    } catch (err) {
      if (!['timeout', 'error'].includes(err.code)) throw err;
      console.warn(`[ai] picture for "${idea.name}": retrying once`);
      return generateOnce(idea, key);
    }
  });
}

async function generateOnce(idea, key) {
  {
    const t0 = Date.now();
    try {
      const res = await gemini().interactions.create(
        { model: config.ai.images.model, input: imagePrompt(idea), response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '4:3', image_size: '1K' } },
        { timeout_ms: TIMEOUT_MS, fetch_options: { signal: AbortSignal.timeout(TIMEOUT_MS) } }
      );
      const img = res?.output_image;
      if (!img?.data) throw Object.assign(new Error('the model returned no image'), { status: 0 });
      const mime = img.mime_type || 'image/jpeg';
      run('INSERT OR REPLACE INTO idea_images (key, mime, data, model, created_at) VALUES (?,?,?,?,?)', key, mime, img.data, config.ai.images.model, now());
      const out = { src: `data:${mime};base64,${img.data}`, model: config.ai.images.model };
      memory.set(key, out);
      if (memory.size > 100) memory.delete(memory.keys().next().value);
      status.state = 'ready';
      status.until = 0;
      console.log(`[ai] picture for "${idea.name}": ${((Date.now() - t0) / 1000).toFixed(1)}s · ${Math.round((img.data.length * 3) / 4 / 1024)} KB · ${config.ai.images.model}`);
      return { ...out, cached: false };
    } catch (err) {
      const kind = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : classify(err);
      // Only Google's status and message are logged — never the key.
      console.error(`[ai] picture for "${idea.name}" failed (${kind}): ${err?.status || ''} ${String(err?.message || '').slice(0, 400)}`);
      if (['needs_billing', 'model_unavailable'].includes(kind)) Object.assign(status, { state: kind, until: Date.now() + 30 * 60 * 1000 });
      if (kind === 'rate_limited') Object.assign(status, { state: kind, until: Date.now() + 60 * 1000 });
      throw new ImageError(kind, reasonText(kind) || (kind === 'timeout' ? 'The picture took too long to generate.' : 'The picture could not be generated.'));
    }
  }
}
