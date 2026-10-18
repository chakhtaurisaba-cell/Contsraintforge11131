// Curated example photos (free licences, reviewed one by one; credits in data-product-photos.json).
//
// A photo is shown only when it really shows this kind of product in this material — a photo of
// a single wall shelf is not used for a "two-tier shelf unit", and an LED night-light photo is
// not used for an "LED battery tester". Everything else gets the drawn concept illustration.
import PHOTOS from '../data-product-photos.json';
import { resolveKind, resolveMaterial } from '../../shared/productKind.js';

// require: the product's words must include one of these for the photo to fit.
// avoid:   words that describe a different design than the one in the photo.
const RULES = {
  'wall_shelf-wood': { avoid: /tier|unit|corner|ladder|cube|hanging|book ?(shelf|case)|floating/ },
  'box-wood': { avoid: /divid|compartment|drawer|open|organi[sz]|planter|crate/ },
  'box-cardboard': { avoid: /divid|compartment|drawer|organi[sz]|stand|shelf/ },
  'crate-wood': { avoid: /planter|bench|shelf/ },
  'tray-wood': { avoid: /divid|compartment|cutting board|wall/ },
  'frame-wood': { avoid: /mirror|shadow box|collage/ },
  'stand-wood': { require: /phone|mobile|smartphone/ },
  'stand-cardboard': { require: /phone|mobile|smartphone/ },
  'stand-cardboard-laptop': { require: /laptop|notebook computer|computer/ },
  'plant_stand-wood': { require: /ladder|tier|shelf|rack|display|step/ },
  'plant_pot-concrete': { avoid: /hanging|self.?watering/ },
  'bird_feeder-plastic': { avoid: /house|nest/ },
  'bird_feeder-wood': { avoid: /bottle|hanging/ },
  'birdhouse-wood': { avoid: /feeder|bat|insect/ },
  'candle_jar-glass': { avoid: /tea ?light|lantern|hanging|wall/ },
  'jar-glass': { avoid: /candle|lamp|terrarium|vase/ },
  'vase-glass': { avoid: /lamp|planter|terrarium/ },
  'pouch-fabric': { avoid: /wallet|backpack|drawstring|lunch/ },
  'tote_bag-fabric': { avoid: /backpack|drawstring|lunch/ },
  'lamp-wood': { avoid: /led|night|lantern|wall|floor|pendant/ },
  'led_light-plastic': { require: /night ?light|nightlight|wall light|plug/ },
  'stool-wood': { avoid: /step|bench|bar stool|folding/ },
  'sign-wood': { avoid: /panel|wall art|plaque|name|house number|neon/ },
};

/** The fitting example photo for an idea, or null. */
export function photoFor(idea = {}) {
  const kind = resolveKind(idea);
  const finish = resolveMaterial(idea, kind);
  const text = `${idea.name || ''} ${idea.summary || idea.tagline || ''}`.toLowerCase();
  const keys = kind === 'stand' && finish === 'cardboard' ? ['stand-cardboard-laptop', 'stand-cardboard'] : [`${kind}-${finish}`];
  for (const key of keys) {
    const photo = PHOTOS[key];
    const rule = RULES[key] || {};
    if (!photo) continue;
    if (rule.require && !rule.require.test(text)) continue;
    if (rule.avoid && rule.avoid.test(text)) continue;
    return { key, ...photo };
  }
  return null;
}

/**
 * Photos for a list of ideas, each photo used at most once — two different products never show
 * the same picture; the second one gets its concept illustration instead.
 */
export function assignPhotos(ideas = []) {
  const used = new Set();
  return ideas.map((idea) => {
    const p = photoFor(idea);
    if (!p || used.has(p.key)) return null;
    used.add(p.key);
    return p;
  });
}

export const PHOTO_CREDITS = Object.entries(PHOTOS).map(([key, p]) => ({ key, ...p }));
