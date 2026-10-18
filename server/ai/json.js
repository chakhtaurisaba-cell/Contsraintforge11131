// JSON from models that don't (reliably) support structured outputs — e.g. Ollama Cloud.
//
// 1. schemaPrompt():   describes the required JSON shape in the prompt (a template + field notes),
//                      so the model knows exactly what to return without a `format` schema.
// 2. extractJSON():    finds the JSON in a reply that may contain prose, code fences, a <think>
//                      block, trailing commas or smart quotes.
// 3. conformToSchema(): repairs the usual deviations against the JSON schema before zod checks it —
//                      numbers sent as strings, missing optional-looking fields, enum case, a bare
//                      array instead of {ideas:[…]}, over-long lists. It never invents content.

/* ------------------------------ prompt ------------------------------ */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const typesOf = (s) => [].concat(s?.type || (s?.anyOf ? s.anyOf.map((x) => x.type) : [])).filter(Boolean);

/** A compact JSON template of the schema: {"name":"string","difficulty":"beginner|intermediate|advanced",...} */
function template(s) {
  if (!s) return 'null';
  if (s.anyOf) return template(s.anyOf.find((x) => x.type !== 'null') || s.anyOf[0]);
  if (s.enum) return s.enum.join('|');
  const t = typesOf(s).find((x) => x !== 'null');
  if (t === 'object') return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, template(v)]));
  if (t === 'array') return [template(s.items)];
  if (t === 'integer') return 0;
  if (t === 'number') return 0;
  if (t === 'boolean') return false;
  return typesOf(s).includes('null') ? 'string or null' : 'string';
}

function notes(s, path = '', out = []) {
  if (!s) return out;
  if (s.anyOf) return notes(s.anyOf.find((x) => x.type !== 'null') || s.anyOf[0], path, out);
  if (s.description && path) out.push(`- ${path}: ${s.description}`);
  const t = typesOf(s).find((x) => x !== 'null');
  if (t === 'object') for (const [k, v] of Object.entries(s.properties || {})) notes(v, path ? `${path}.${k}` : k, out);
  if (t === 'array') notes(s.items, `${path}[]`, out);
  return out;
}

/** Instructions that make a model reply with exactly this JSON shape. */
export function schemaPrompt(jsonSchema) {
  const fieldNotes = notes(jsonSchema);
  return [
    'OUTPUT FORMAT — reply with ONE JSON object and nothing else: no explanation, no markdown, no code fences.',
    'Use exactly these keys and value types (strings in double quotes, numbers as plain numbers, "a|b|c" means pick one of those values):',
    JSON.stringify(template(jsonSchema)),
    ...(fieldNotes.length ? ['Field notes:', ...fieldNotes] : []),
    'Every key is required. Fill every list with real entries for this request; inside an entry, use "" for unknown text, [] for an empty detail list, 0 for an unknown number and null where null is allowed.',
    'Start your reply with { and end it with }.',
  ].join('\n');
}

/**
 * The start of the reply, given as a prefilled assistant message, when the answer's first field
 * is a list of objects ({"ideas": [{…}]}): the model then writes its first entry instead of taking
 * the easy exit of an empty list. '' when no prefill is useful.
 */
export function prefillFor(jsonSchema) {
  const [key, first] = Object.entries(jsonSchema?.properties || {})[0] || [];
  if (!key || !typesOf(first).includes('array') || !typesOf(first.items).includes('object')) return '';
  return `{"${key}": [\n  {`;
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
