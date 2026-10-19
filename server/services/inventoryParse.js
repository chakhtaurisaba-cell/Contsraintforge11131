// Turns a typed inventory ("3 pine boards (1000 x 150 x 18 mm), a box of 100 screws, glue and a
// hand saw") into the structured inventory the pipeline works with — on the server, without a
// Gemini call. Amounts, units, sizes, tools, a budget, hours per week and skill words are read
// with plain rules; anything not stated stays "not stated" (never guessed).
//
// Whether the text names real objects at all (vs. gibberish) is decided by the single ideas call
// (inputRecognized), so this costs no extra Gemini request.
import { materialClass } from '../../shared/productKind.js';

const TOOL_WORDS = /\b(saw|hand ?saw|hacksaw|jigsaw|hammer|mallet|drill|driver|screwdriver|scissors|shears|knife|cutter|glue gun|sander|clamps?|tape measure|ruler|pliers|wrench|spanner|sewing machine|needle|soldering iron|chisel|file|plane|brush|stapler|hole punch|awl)\b/i;
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, pair: 2, half: 0.5 };
const VAGUE_AMOUNT = /^(some|a few|few|several|lots of|a lot of|many|plenty of|loads of|a bunch of|a couple of|couple of)\s+/i;
const AMOUNT = /^(about |around |roughly |approx\.? )?(\d+(?:[.,]\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|half|pair of|a pair of)\s+/i;
const UNIT = /^(boxes|box|bags?|packs?|rolls?|bottles?|tubes?|sheets?|pieces?|pcs|kg|kilos?|g|grams?|m|metres?|meters?|cm|mm|litres?|liters?|l|ml|balls?|spools?|skeins?|cans?|tins?|jars?)\s+(of\s+)?/i;
const CONTAINER_UNITS = /^(boxes|box|bags?|packs?|tubes?|bottles?|cans?|tins?|jars?)$/i; // "a box of 100 screws": the count inside wins
const UNIT_NAME = { kilo: 'kg', kilos: 'kg', gram: 'g', grams: 'g', metre: 'm', metres: 'm', meter: 'm', meters: 'm', litre: 'l', litres: 'l', liter: 'l', liters: 'l', piece: 'pcs', pieces: 'pcs' };
const CLAUSES = [
  /\b(i am|i'm|im)\s+(a\s+)?(complete\s+|total\s+)?(beginner|novice|intermediate|advanced|experienced)[^,.;]*/gi,
  /\b(my\s+)?budget\s*(is|of)?[^,.;]*/gi,
  /\b(i\s+)?(can|could)\s+spend[^,.;]*/gi,
  /\b\d+(?:[.,]\d+)?\s*(hours?|hrs?|h)\s*(a|per|each|every|\/)\s*(week|wk|day)[^,.;]*/gi,
];

const toMm = (v, unit) => (unit === 'm' ? v * 1000 : unit === 'cm' ? v * 10 : v);
const num = (s) => Number(String(s).replace(',', '.'));

/** "1000 x 150 x 18 mm", "1 m × 15 cm × 18 mm", "30x20cm" → { length, width, thickness } in mm, or null. */
export function sizeIn(text) {
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?(?:\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?)?/i);
  if (!m) return null;
  const last = (m[6] || m[4] || m[2] || 'mm').toLowerCase();
  const dims = [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].filter(([v]) => v != null).map(([v, u]) => Math.round(toMm(num(v), (u || last).toLowerCase())));
  return { length: dims[0] ?? null, width: dims[1] ?? null, thickness: dims[2] ?? null };
}

/** One item phrase → { name, quantity, quantityStated, unit, size }. */
function readItem(raw) {
  let p = raw.trim().replace(/^(and|with|plus|also|then|i have|i've got|i got|i own|got|have)\s+/i, '');
  const size = sizeIn(p);
  p = p.replace(/\([^)]*\)/g, ' ').replace(/\d+(?:[.,]\d+)?\s*(mm|cm|m)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(mm|cm|m)?(\s*[x×]\s*\d+(?:[.,]\d+)?\s*(mm|cm|m)?)?/gi, ' ').replace(/\s+/g, ' ').trim();
  let quantity = null;
  let unit = 'pcs';
  if (VAGUE_AMOUNT.test(p)) p = p.replace(VAGUE_AMOUNT, '');
  for (let pass = 0; pass < 2; pass++) {
    const a = p.match(AMOUNT);
    if (a) {
      const word = a[2].toLowerCase().replace(/^a pair of$|^pair of$/, 'pair');
      quantity = NUMBER_WORDS[word] ?? num(word);
      p = p.slice(a[0].length);
    }
    const u = p.match(UNIT);
    if (u) {
      const name = u[1].toLowerCase();
      p = p.slice(u[0].length);
      // "a box of 100 screws": keep reading — the number inside is the count.
      if (CONTAINER_UNITS.test(name) && AMOUNT.test(p)) continue;
      if (!CONTAINER_UNITS.test(name)) unit = UNIT_NAME[name] || name.replace(/s$/, '');
    }
    if (!AMOUNT.test(p)) break;
  }
  const name = p.replace(/[^\p{L}\p{N} '-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return { name, quantity, quantityStated: quantity != null, unit, size };
}

const LABEL = { wood: 'wood', plastic_bottle: 'plastic', plastic: 'plastic', glass: 'glass', cardboard: 'cardboard', paper: 'paper', textile: 'fabric', thread: 'cord', fastener: 'metal', metal: 'metal', adhesive: 'adhesive', finish: 'finish', electronics: 'electronics', wax: 'wax', wick: 'cotton', ceramic: 'ceramic', concrete: 'concrete' };

/**
 * Returns the same shape the pipeline used to get from the Gemini parse call:
 * { recognized, unrecognizedReason, materials: [{name, material, quantity, quantityStated, unit, size}], tools, skills, budget, currency, hoursPerWeek }.
 */
export function parseInventoryText(text) {
  const t = String(text || '');
  const budget = t.match(/\b(?:budget(?:\s+(?:is|of))?|spend|up to)\D{0,12}?(\d+(?:[.,]\d+)?)\s*(gel|lari|usd|eur|gbp|\$|€|£)?/i);
  const hours = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\s*(?:a|per|each|every|\/)\s*(week|wk|day)/i);
  const skill = t.match(/\b(beginner|novice|intermediate|advanced|experienced)\b/i);
  let body = t;
  for (const re of CLAUSES) body = body.replace(re, ',');
  body = body.replace(/\b(tools?|materials?|inventory)\s*:/gi, ',').replace(/\.(\s|$)/g, ',$1');
  // Split on separators — but never inside parentheses ("(1 m × 15 cm × 18 mm)").
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && /[,;\n+&]/.test(ch)) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const items = parts
    .flatMap((p) => (/\(/.test(p) ? [p] : p.split(/\s+(?:and|plus|with)\s+/i)))
    .map(readItem)
    .filter((i) => i.name.length >= 2 && i.name.length <= 60 && /\p{L}{2}/u.test(i.name));
  const seen = new Set();
  const unique = items.filter((i) => !seen.has(i.name.toLowerCase()) && seen.add(i.name.toLowerCase()));
  const tools = unique.filter((i) => TOOL_WORDS.test(i.name)).map((i) => i.name);
  const materials = unique.filter((i) => !TOOL_WORDS.test(i.name)).map((i) => ({
    name: i.name,
    material: LABEL[materialClass({ name: i.name })] || '',
    quantity: i.quantity ?? 0,
    quantityStated: i.quantityStated,
    unit: i.unit,
    size: i.size,
  }));
  const currency = budget?.[2] ? ({ $: 'USD', '€': 'EUR', '£': 'GBP', lari: 'GEL' }[budget[2].toLowerCase()] || budget[2].toUpperCase()) : null;
  return {
    recognized: materials.length > 0 || tools.length > 0,
    unrecognizedReason: materials.length || tools.length ? '' : 'No materials or objects were named.',
    materials,
    tools,
    skills: skill ? [skill[1].toLowerCase()] : [],
    budget: budget ? num(budget[1]) : null,
    currency,
    hoursPerWeek: hours ? num(hours[1]) * (/day/i.test(hours[2]) ? 7 : 1) : null,
  };
}
