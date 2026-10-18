// Keyword lexicon used by the rule-based demo engine to understand free text and
// match inventory items to product requirements.

export const MATERIALS = {
  wood_board: {
    label: 'Wood board',
    match: ['board', 'plank', 'wood', 'timber', 'pine', 'oak', 'plywood', 'mdf', 'lumber', 'pallet', 'beam', 'birch', 'walnut', 'scrap wood', 'offcut'],
    exclude: ['screw', 'glue', 'stain', 'oil', 'varnish', 'filler', 'sandpaper', 'drill', 'saw', 'chisel', 'clamp', 'nail', 'plug'],
  },
  screws: { label: 'Screws', match: ['screw', 'bolt'], exclude: ['driver', 'screwdriver', 'plug', 'anchor', 'toggle'] },
  brackets: { label: 'Brackets', match: ['bracket', 'angle iron', 'corner brace', 'l-bracket', 'shelf support'], exclude: [] },
  glass_jar: { label: 'Glass jars', match: ['jar', 'glass container', 'tumbler', 'candle glass'], exclude: [] },
  wax: { label: 'Wax', match: ['wax', 'soy', 'paraffin', 'beeswax'], exclude: ['wax finish'] },
  wick: { label: 'Wicks', match: ['wick'], exclude: [] },
  rope: { label: 'Rope / cord', match: ['rope', 'cord', 'twine', 'jute', 'macrame'], exclude: ['cordless'] },
  fabric: { label: 'Fabric', match: ['fabric', 'canvas', 'cloth', 'denim', 'textile', 'linen', 'cotton sheet'], exclude: [] },
  hooks: { label: 'Hooks', match: ['hook'], exclude: [] },
  glue: { label: 'Glue', match: ['glue', 'adhesive', 'pva'], exclude: ['glue gun', 'glue stick', 'adhesive paper'] },
  finish: { label: 'Wood finish', match: ['oil', 'varnish', 'stain', 'paint', 'lacquer', 'finish'], exclude: [] },
  sandpaper: { label: 'Sandpaper', match: ['sandpaper', 'sanding paper', 'abrasive'], exclude: [] },
  thread: { label: 'Thread', match: ['thread', 'yarn'], exclude: [] },
  webbing: { label: 'Strap webbing', match: ['webbing', 'strap'], exclude: [] },
  felt: { label: 'Felt pads', match: ['felt'], exclude: [] },
  nails: { label: 'Nails / brads', match: ['nail', 'brad'], exclude: ['nail gun', 'nailer'] },
  wall_plugs: { label: 'Wall plugs / anchors', match: ['wall plug', 'anchor', 'rawlplug', 'dowel plug', 'toggle bolt'], exclude: [] },
  plastic_sheet: { label: 'Plastic sheet', match: ['plastic sheet', 'plastic bag', 'pond liner', 'tarp', 'liner', 'polythene', 'plastic film'], exclude: [] },
  labels: { label: 'Labels', match: ['label', 'sticker', 'adhesive paper', 'printer paper'], exclude: [] },
  glue_sticks: { label: 'Hot-glue sticks', match: ['glue stick', 'hot glue stick', 'hot-glue stick'], exclude: [] },
  rubber_feet: { label: 'Rubber feet / bumpers', match: ['rubber feet', 'rubber foot', 'bumper', 'silicone pad'], exclude: [] },
};

/** Lowercase word tokens, ignoring very short words and quantities. */
// Plurals: "boxes" → "box", "glasses" → "glass", but "wires" → "wire" (not "wir").
export const tokens = (s = '') => String(s).toLowerCase().replace(/[^a-z0-9а-яა-ჰ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)).map((w) => (/(s|x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.replace(/s$/, '')));

/** Token-overlap similarity (0..1) between two names — used for AI-named components and duplicate detection. */
export function nameSimilarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((t) => { if (B.has(t)) common += 1; });
  return common / Math.min(A.size, B.size);
}

/** First lexicon key that describes a text (material name, BOM line, etc.). */
export function keyFor(text) {
  const t = String(text).toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const [k, def] of Object.entries(MATERIALS)) {
    if (!matchesKey(t, k)) continue;
    const len = Math.max(...def.match.filter((m) => t.includes(m)).map((m) => m.length));
    if (len > bestLen) { best = k; bestLen = len; }
  }
  return best;
}

export const TOOLS = {
  drill: { label: 'Drill / driver', match: ['drill', 'driver', 'impact'] },
  saw: { label: 'Saw', match: ['saw', 'jigsaw', 'mitre', 'miter'] },
  sander: { label: 'Sander or sandpaper', match: ['sander', 'sandpaper', 'sanding'] },
  clamp: { label: 'Clamps', match: ['clamp'] },
  tape: { label: 'Tape measure / ruler', match: ['tape measure', 'measuring tape', 'ruler', 'tape'] },
  square: { label: 'Try square', match: ['square'] },
  level: { label: 'Spirit level', match: ['level'] },
  glue_gun: { label: 'Hot-glue gun', match: ['glue gun', 'hot glue'] },
  sewing_machine: { label: 'Sewing machine', match: ['sewing machine'] },
  hand_sewing: { label: 'Needle and thread', match: ['needle', 'sewing kit'] },
  scissors: { label: 'Fabric scissors', match: ['scissors', 'shears', 'rotary cutter'] },
  thermometer: { label: 'Thermometer', match: ['thermometer'] },
  pot: { label: 'Double boiler / pouring pot', match: ['pot', 'double boiler', 'boiler', 'pan'] },
  iron: { label: 'Iron', match: ['iron'] },
};

export const SKILLS = ['woodworking', 'sewing', 'candle making', 'painting', 'electronics', 'metalwork', 'crafts', 'design', 'photography', 'marketing'];

const textOf = (item) => `${item.name || ''} ${item.material || ''} ${item.category || ''}`.toLowerCase();

export function matchesKey(item, key, dict = MATERIALS) {
  const def = dict[key];
  if (!def) return false;
  const t = typeof item === 'string' ? item.toLowerCase() : textOf(item);
  if (def.exclude?.some((x) => t.includes(x))) return false;
  return def.match.some((x) => t.includes(x));
}

export function hasTool(tools, key) {
  const def = TOOLS[key];
  return tools.some((t) => def.match.some((m) => String(t).toLowerCase().includes(m)));
}

/** Very small natural-language parser for the demo engine. */
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };

export function parseFreeText(text = '') {
  const t = text.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\b/g, (w) => String(NUMBER_WORDS[w]));
  const materials = [];
  const words = t.split(/[,;\n]|\band\b|\bwith\b/).map((s) => s.trim()).filter(Boolean);
  for (const chunk of words) {
    const isTool = Object.values(TOOLS).some((d) => d.match.some((m) => chunk.includes(m)));
    const matKey = Object.keys(MATERIALS).find((k) => matchesKey(chunk, k));
    if (matKey && !isTool) {
      const qtyMatch = chunk.match(/(\d+)\s*(x|pcs|pieces)?/);
      // An unstated count is unknown — never assume 1 (that would invent a shortage).
      const qty = qtyMatch ? Number(qtyMatch[1]) : null;
      const name = chunk.replace(/^(i have|i've got|i got|some|a few|a|an|the)\s+/g, '').replace(/\d+\s*(gel|usd|eur|\$|€|₾).*/g, '').trim();
      if (name && name.length < 60) materials.push({ name, material: MATERIALS[matKey].label, quantity: qty ?? 1, quantityUnknown: qty == null, unit: 'pcs' });
    }
  }
  const tools = Object.entries(TOOLS)
    .filter(([, d]) => d.match.some((m) => new RegExp(`\\b${m}`).test(t)))
    .map(([, d]) => d.label);
  const budgetMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(gel|lari|₾|usd|\$|eur|€|gbp|£)/) || t.match(/(₾|\$|€|£)\s*(\d+(?:[.,]\d+)?)/);
  let budget = null;
  let currency = null;
  if (budgetMatch) {
    const [a, b] = /\d/.test(budgetMatch[1]) ? [budgetMatch[1], budgetMatch[2]] : [budgetMatch[2], budgetMatch[1]];
    budget = Number(a.replace(',', '.'));
    currency = { gel: 'GEL', lari: 'GEL', '₾': 'GEL', usd: 'USD', $: 'USD', eur: 'EUR', '€': 'EUR', gbp: 'GBP', '£': 'GBP' }[b] || null;
  }
  const hoursMatch = t.match(/(\d+(?:\.\d+)?)\s*hours?\s*(every|each|per|a)?\s*(evening|day|night|week)?/);
  let hoursPerWeek = null;
  if (hoursMatch) {
    const h = Number(hoursMatch[1]);
    hoursPerWeek = /evening|day|night/.test(hoursMatch[3] || '') ? h * 5 : h;
  }
  const skills = SKILLS.filter((s) => t.includes(s.split(' ')[0]));
  return { materials, tools, skills, budget, currency, hoursPerWeek };
}
