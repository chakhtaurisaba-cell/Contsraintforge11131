// JSON helpers for the AI layer.
//
// - toGeminiSchema():  adapts the app's zod/JSON schemas to Gemini's structured-output subset.
// - extractJSON():     finds the JSON value in a reply (prose, code fences, trailing commas…) — a
//                      safety net behind Gemini's JSON mode and for the research/text helpers.
// - conformToSchema(): repairs small deviations (numbers as strings, missing fields, enum case,
//                      a bare array instead of {ideas:[…]}) before zod validates. Never invents content.

/* ------------------------------ Gemini schema ------------------------------ */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const typesOf = (s) => [].concat(s?.type || (s?.anyOf ? s.anyOf.map((x) => x.type) : [])).filter(Boolean);

// The JSON Schema keywords Gemini's structured output documents (plus anyOf/$ref it accepts).
const KEEP = new Set(['type', 'title', 'description', 'properties', 'required', 'additionalProperties', 'enum', 'format', 'minimum', 'maximum', 'items', 'prefixItems', 'minItems', 'maxItems', 'anyOf', '$ref', '$defs']);

/**
 * A zod-generated JSON schema in the subset Gemini accepts for responseJsonSchema: nullable
 * values become {"type": [X, "null"]}, constants become one-value enums, and keywords Gemini
 * doesn't document (maxLength, pattern, default…) are dropped. Limits that matter are still
 * enforced afterwards by zod.
 */
export function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!isObj(node)) return node;
  let n = node;
  // anyOf [X, {type:null}] → X with "null" added to its type.
  if (Array.isArray(n.anyOf) && n.anyOf.length === 2 && n.anyOf.some((x) => x?.type === 'null')) {
    const other = n.anyOf.find((x) => x?.type !== 'null');
    if (other && typeof other.type === 'string') n = { ...other, ...(n.description ? { description: n.description } : {}), type: [other.type, 'null'] };
  }
  if ('const' in n) n = { ...n, enum: [n.const], type: n.type || typeof n.const };
  const out = {};
  for (const [k, v] of Object.entries(n)) {
    if (!KEEP.has(k)) continue;
    // zod's z.int() adds ±Number.MAX_SAFE_INTEGER bounds: noise, not a real limit.
    if ((k === 'minimum' || k === 'maximum') && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
    if (k === 'properties' || k === '$defs') out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else if (k === 'items' || k === 'anyOf' || k === 'prefixItems') out[k] = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

/* ------------------------------ parsing ------------------------------ */

/** Balanced {…} or […] blocks in text, outermost first, ignoring brackets inside strings. */
function balancedBlocks(text) {
  const blocks = [];
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          blocks.push(text.slice(start, i + 1));
          start = i; // continue after this block
          break;
        }
      }
    }
  }
  return blocks.sort((a, b) => b.length - a.length);
}

/** Fixes the common ways models break JSON. */
function repair(s) {
  return s
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\bNaN\b|\bundefined\b/g, 'null');
}

function tryParse(s) {
  for (const candidate of [s, repair(s)]) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      /* next */
    }
  }
  return { ok: false };
}

/** The JSON value in a model reply (object or array), or null when there is none. */
export function extractJSON(text = '') {
  const t = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^﻿/, '')
    .trim();
  if (!t) return null;
  const direct = tryParse(t);
  if (direct.ok && typeof direct.value === 'object' && direct.value) return direct.value;
  // Code fences first (```json … ```), then any balanced block in the text.
  const fences = [...t.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const candidate of [...fences, ...balancedBlocks(t)]) {
    const r = tryParse(candidate);
    if (r.ok && typeof r.value === 'object' && r.value) return r.value;
  }
  return null;
}

/* ------------------------------ conforming ------------------------------ */

const numberFrom = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const m = v.replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
};

/**
 * Brings a parsed value into the shape of a JSON schema (as produced by z.toJSONSchema), so small
 * format slips don't throw away a good answer. Content is never invented: missing text becomes "",
 * missing lists [], missing numbers 0 — the app's own checks then treat them as unknown.
 */
export function conformToSchema(value, s) {
  if (!s) return value;
  if (s.anyOf) {
    if (value == null && s.anyOf.some((x) => x.type === 'null')) return null;
    return conformToSchema(value, s.anyOf.find((x) => x.type !== 'null') || s.anyOf[0]);
  }
  const types = typesOf(s);
  const nullable = types.includes('null');
  if (value == null && nullable) return null;

  if (s.enum) {
    if (s.enum.includes(value)) return value;
    const low = String(value ?? '').toLowerCase().trim();
    return s.enum.find((e) => String(e).toLowerCase() === low) || s.enum.find((e) => low && low.includes(String(e).toLowerCase())) || s.enum[0];
  }
  const t = types.find((x) => x !== 'null');
  switch (t) {
    case 'object': {
      // A model sometimes answers {"ideas":[…]} as just […] — wrap it when the schema has one list.
      if (Array.isArray(value)) {
        const listKeys = Object.entries(s.properties || {}).filter(([, v]) => typesOf(v).includes('array'));
        if (listKeys.length === 1) value = { [listKeys[0][0]]: value };
      }
      // …or wraps the answer one level deep ({"result": {…}}).
      if (isObj(value) && s.properties && !Object.keys(s.properties).some((k) => k in value)) {
        const inner = Object.values(value).find((v) => isObj(v) && Object.keys(s.properties).some((k) => k in v));
        if (inner) value = inner;
      }
      const src = isObj(value) ? value : {};
      return Object.fromEntries(Object.entries(s.properties || {}).map(([k, sub]) => [k, conformToSchema(src[k], sub)]));
    }
    case 'array': {
      let list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
      if (s.maxItems != null) list = list.slice(0, s.maxItems);
      return list.map((v) => conformToSchema(v, s.items));
    }
    case 'integer':
    case 'number': {
      const n = numberFrom(value);
      if (n == null) return nullable ? null : 0;
      return t === 'integer' ? Math.round(n) : n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return /^(true|yes|1)$/i.test(value.trim());
      return Boolean(value);
    case 'string': {
      if (value == null) return nullable ? null : '';
      const str = typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : isObj(value) ? JSON.stringify(value) : String(value);
      return s.maxLength != null ? str.slice(0, s.maxLength) : str;
    }
    default:
      return value;
  }
}
