// What a product is (its kind) and what it is mainly made of — shared by the server's
// feasibility check and the browser's product preview, so the picture and the check agree.

export const KINDS = ['plant_stand', 'candle_jar', 'jar', 'vase', 'planter_box', 'plant_pot', 'bottle_planter', 'bottle_organizer', 'bird_feeder', 'wall_shelf', 'bookshelf', 'box', 'crate', 'organizer', 'tray', 'coaster', 'frame', 'stand', 'pouch', 'tote_bag', 'key_rack', 'lamp', 'led_light', 'stool', 'birdhouse', 'sign', 'generic'];
const KIND_SET = new Set(KINDS);

// Ordered most specific first; matched against whole words (plural endings allowed).
const KIND_RULES = [
  ['candle_jar', /candle|tealight|tea light|wax melt/],
  ['bird_feeder', /bird feeder|feeder/],
  ['birdhouse', /bird ?house|nest box/],
  ['led_light', /led|night ?light|nightlight|circuit|flashlight|torch/],
  ['bottle_planter', /bottle( \w+)? (planter|garden|pot)|self watering planter|hanging planter/],
  ['bottle_organizer', /bottle( \w+)? (organi[sz]er|holder|caddy|storage)/],
  ['key_rack', /key (holder|rack|hook|hanger)|coat (rack|hook)|hook (rack|board)|wall hook/],
  ['plant_stand', /plant (stand|shelf|holder|table)|flower stand/],
  ['organizer', /pen (holder|stand|cup|pot)|pencil (holder|stand|cup|pot)|desk tidy/],
  ['bookshelf', /book ?(shelf|case)|shelving unit|ladder shelf/],
  ['wall_shelf', /shelf|shelves|ledge/],
  ['coaster', /coaster/],
  ['frame', /frame|photo holder/],
  ['lamp', /lamp|lantern|light fixture/],
  ['stool', /stool|bench|footrest|side table|step/],
  ['tote_bag', /tote|shopping bag|market bag|shoulder bag/],
  ['pouch', /pouch|wallet|pencil case|zip bag|purse|sleeve|cosmetic bag/],
  ['plant_pot', /plant pot|flower pot|succulent pot|pot/],
  ['planter_box', /planter|herb box|window box|garden box/],
  ['vase', /vase|bottle/],
  ['jar', /jar|canister|container/],
  ['tray', /tray|serving board|cutting board|platter/],
  ['stand', /stand|holder|dock|easel|rack/],
  ['organizer', /organi[sz]er|caddy|desk tidy|divider|pen cup/],
  ['crate', /crate|bin|basket/],
  ['box', /box|boxes|chest|case|cabinet|cupboard/],
  ['sign', /sign|plaque|wall art|name board|panel/],
];
const LEGACY = { shelf: 'wall_shelf', panel: 'key_rack', bag: 'tote_bag', planter: 'planter_box', jar: 'candle_jar' };
// Kinds that only make sense in rigid materials; a soft-material product tagged like this is drawn neutrally.
const RIGID_KINDS = new Set(['wall_shelf', 'bookshelf', 'box', 'crate', 'stool', 'birdhouse', 'key_rack', 'stand', 'tray', 'sign', 'frame']);
const SOFT_WORDS = /\b(fabric|cotton|canvas|denim|linen|felt|cloth|textile|wool|yarn|jeans|t-?shirts?|leather|scarf|scarves)\b/;

const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
const matchRule = (text, re) => new RegExp(`(?<=\\s)(?:${re.source})(?:e?s)?(?=\\s)`).test(text);

const kindIn = (text) => {
  for (const [kind, re] of KIND_RULES) if (matchRule(words(text), re)) return kind;
  return null;
};

/** Kind from the product's name only (null when the name says nothing). */
export function kindFromText(idea = {}) {
  return kindIn(idea.name);
}

/**
 * The product's kind: its name decides first, then the model's visualKind, and only then the
 * summary (a summary like "…a cosy glow, like candlelight" must not turn a pillow into a candle).
 */
export function resolveKind(idea = {}) {
  // What it holds isn't what it is: "Wooden stand for glass jars" is a stand.
  const fromName = kindIn(String(idea.name || '').replace(/\b(for|to hold|holding)\b.*$/i, '')) || kindIn(idea.name);
  if (fromName) return fromName;
  const k = idea.visualKind || idea.visualShape;
  let kind = KIND_SET.has(k) ? k : LEGACY[k] || 'generic';
  if (kind === 'generic') kind = kindIn(idea.summary || idea.tagline) || 'generic';
  if (RIGID_KINDS.has(kind) && SOFT_WORDS.test(`${idea.name || ''} ${(idea.usesExisting || []).map((u) => u.inventoryName).join(' ')}`.toLowerCase())) return 'generic';
  return kind;
}

/* ----------------------------- materials ----------------------------- */

// Whole words only ("floating" is not tin). Order = which class wins for one item name.
const MATERIAL_CLASSES = [
  ['electronics', /\b(leds?|resistors?|batter(y|ies)|arduino|raspberry|circuit|breadboard|transistors?|capacitors?|motors?|sensors?|switch(es)?|solar|usb|wires?|cables?|electronic|electronics)\b/],
  ['wax', /\b(wax|paraffin|beeswax|soy wax)\b/],
  ['wick', /\bwicks?\b/],
  ['glass', /\b(glass|jars?)\b/],
  ['plastic_bottle', /\b(plastic bottles?|pet bottles?|bottles?)\b/],
  ['cardboard', /\b(cardboard|cartons?|corrugated|card ?stock)\b/],
  ['paper', /\b(paper|kraft|newspaper|magazines?)\b/],
  ['textile', /\b(fabric|cotton|canvas|denim|linen|felt|cloth|textile|wool|jeans|t-?shirts?|scraps?|leather)\b/],
  ['thread', /\b(thread|yarn|twine|string|rope|cord)\b/],
  ['fastener', /\b(screws?|nails?|bolts?|nuts?|brackets?|hinges?|hooks?|staples?|rivets?|dowels?)\b/],
  ['adhesive', /\b(glue|pva|epoxy|tape|adhesive|hot glue|silicone)\b/],
  ['concrete', /\b(concrete|cement|plaster)\b/],
  ['ceramic', /\b(ceramic|clay|terracotta|porcelain|tiles?)\b/],
  ['metal', /\b(metal|steel|tin|cans?|aluminium|aluminum|copper|iron)\b/],
  ['plastic', /\b(plastic|acrylic|pvc|resin|containers?|tubs?)\b/],
  ['wood', /\b(wood(en)?|pine|oak|planks?|boards?|timber|plywood|mdf|bamboo|pallets?|logs?|branch(es)?|sticks?|cork)\b/],
  ['finish', /\b(paint|varnish|stain|oil|sandpaper|polish)\b/],
];

/** Material class of one inventory item (by its name and material), or 'other'. */
export function materialClass(item = {}) {
  // The item's own name decides first ("sandpaper" whose material is "abrasive paper" is a
  // finishing supply, not paper); its material only helps when the name says nothing.
  for (const t of [item.name || item.inventoryName || '', item.material || '']) {
    const low = String(t).toLowerCase();
    for (const [cls, re] of MATERIAL_CLASSES) if (re.test(low)) return cls;
  }
  return 'other';
}

// Preview finishes: material class → drawing material.
const CLASS_TO_FINISH = { wood: 'wood', cardboard: 'cardboard', paper: 'paper', textile: 'fabric', concrete: 'concrete', ceramic: 'ceramic', metal: 'metal', plastic: 'plastic', plastic_bottle: 'plastic', glass: 'glass', wax: 'glass' };
const DEFAULT_FINISH = { candle_jar: 'glass', jar: 'glass', vase: 'glass', pouch: 'fabric', tote_bag: 'fabric', plant_pot: 'ceramic', lamp: 'wood', bottle_planter: 'plastic', bottle_organizer: 'plastic', bird_feeder: 'plastic', led_light: 'plastic' };

/** Drawing material for the preview: the name first, then the used items in order (the first is the main one). */
export function resolveMaterial(idea = {}, kind) {
  const used = (idea.usesExisting || idea.materials || []).map((u) => ({ name: u.inventoryName || u.name || '' }));
  for (const item of [{ name: idea.name }, ...used, { name: idea.summary || idea.description }]) {
    if (/\bleather\b/i.test(item.name || '')) return 'leather';
    const finish = CLASS_TO_FINISH[materialClass(item)];
    if (finish) return finish;
  }
  return DEFAULT_FINISH[kind] || 'wood';
}
