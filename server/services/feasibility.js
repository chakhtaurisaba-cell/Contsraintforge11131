// Physical feasibility of a product idea, checked by rules — not by the model's say-so.
//
// The model proposes; this decides whether the proposal makes physical sense for the
// materials actually used: the main material must suit the kind of product (a shelf has to
// carry load, so it can't be made of plastic bottles or cardboard), at least one material the
// product is really made of must be owned, parts need a way to join, and the tools must be
// able to cut and sew what the design needs. Implausible ideas are rejected with a reason.
import { resolveKind, materialClass } from '../../shared/productKind.js';

const STRUCTURAL = ['wood', 'metal'];
const CLASS_LABEL = {
  wood: 'wood', metal: 'metal', cardboard: 'cardboard', paper: 'paper', plastic: 'rigid plastic', plastic_bottle: 'plastic bottles', glass: 'glass jars or bottles',
  textile: 'fabric', ceramic: 'ceramic', concrete: 'concrete', wax: 'wax', electronics: 'electronic parts', thread: 'thread', fastener: 'screws, nails or brackets', adhesive: 'glue or tape',
};

/**
 * core: the product must be made mainly of one of these (owned) material classes.
 * load: it carries weight in use, so its main material must be structural (wood/metal).
 * join: parts need one of these to hold together (owned, or on the shopping list).
 * sew:  textile product — needs a needle or sewing machine.
 */
const PROFILE = {
  wall_shelf: { core: STRUCTURAL, load: true, join: ['fastener'] },
  bookshelf: { core: STRUCTURAL, load: true, join: ['fastener', 'adhesive'] },
  stool: { core: STRUCTURAL, load: true, join: ['fastener', 'adhesive'] },
  key_rack: { core: ['wood', 'metal', 'plastic'], load: true, join: ['fastener'] },
  birdhouse: { core: ['wood', 'plastic_bottle', 'metal'], join: ['fastener', 'adhesive'] },
  box: { core: ['wood', 'cardboard', 'metal', 'plastic', 'paper'], join: ['fastener', 'adhesive'] },
  crate: { core: ['wood', 'cardboard', 'metal', 'plastic'], join: ['fastener', 'adhesive'] },
  tray: { core: ['wood', 'cardboard', 'metal', 'plastic', 'ceramic', 'concrete'] },
  organizer: { core: ['wood', 'cardboard', 'plastic', 'plastic_bottle', 'metal', 'textile', 'glass', 'paper'] },
  bottle_organizer: { core: ['plastic_bottle', 'glass'] },
  bottle_planter: { core: ['plastic_bottle'] },
  bird_feeder: { core: ['plastic_bottle', 'wood', 'metal'] },
  frame: { core: ['wood', 'cardboard', 'metal', 'paper', 'plastic'] },
  sign: { core: ['wood', 'cardboard', 'metal', 'plastic', 'paper'] },
  stand: { core: ['wood', 'cardboard', 'metal', 'plastic'] },
  plant_stand: { core: ['wood', 'metal'], join: ['fastener', 'adhesive'] },
  planter_box: { core: ['wood', 'plastic', 'plastic_bottle', 'metal', 'concrete'] },
  plant_pot: { core: ['ceramic', 'concrete', 'plastic', 'plastic_bottle', 'metal', 'glass'] },
  candle_jar: { core: ['wax', 'glass'] },
  jar: { core: ['glass', 'plastic', 'metal', 'ceramic'] },
  vase: { core: ['glass', 'plastic_bottle', 'ceramic', 'concrete', 'metal'] },
  coaster: { core: ['wood', 'cardboard', 'textile', 'ceramic', 'concrete', 'plastic'] },
  pouch: { core: ['textile'], sew: true },
  tote_bag: { core: ['textile'], sew: true },
  lamp: { core: ['electronics'] },
  led_light: { core: ['electronics'] },
};

// Material words a product name can carry ("Wooden box", "Cardboard organizer").
const NAMEABLE = new Set(['wood', 'cardboard', 'textile', 'glass', 'plastic_bottle', 'metal', 'concrete', 'ceramic', 'paper', 'plastic']);
const LOAD_WORDS =/\b(ladder|chair|bench|table|stool|shelf|shelves|bookcase|bookshelf|step|seat)\b/;
// Counted in pieces so owned screws (also in pieces) cover it.
const JOIN_BY = {
  wood: { name: 'Wood screws (or wood glue)', qty: 8, unit: 'pcs', },
  wood_fastener: { name: 'Wood screws', qty: 8, unit: 'pcs', },
  metal: { name: 'Bolts or rivets', qty: 8, unit: 'pcs', },
  cardboard: { name: 'Glue or strong tape', qty: 1, unit: 'pcs' },
  paper: { name: 'Glue or strong tape', qty: 1, unit: 'pcs' },
  plastic: { name: 'Strong glue', qty: 1, unit: 'pcs' },
  plastic_bottle: { name: 'Strong glue', qty: 1, unit: 'pcs' },
};

const CUTS = { wood: 'Saw', cardboard: 'Craft knife or scissors', plastic_bottle: 'Craft knife or scissors', textile: 'Scissors', paper: 'Scissors' };
const CUTTER = /\b(saw|jigsaw|hacksaw|handsaw|knife|knives|cutter|scissors|shears|rotary)\b/i;
const WOOD_CUTTER = /\b(saw|jigsaw|hacksaw|handsaw)\b/i;
const SEWING = /\b(needles?|sewing)\b/i;

const list = (classes) => {
  const names = [...new Set(classes.map((c) => CLASS_LABEL[c] || c))];
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
};

/**
 * @param idea   the model's idea (name, summary, visualKind, primaryMaterial, missing)
 * @param owned  [{ item, quantity, unit, use }] — the inventory items it really uses (already matched)
 * @param tools  names of the user's tools (listed tools + tool-like inventory items)
 * @returns {{ ok: boolean, reason?: string, kind: string, addMissing: [], addTools: [] }}
 */
export function checkFeasibility(idea, owned, tools = []) {
  const kind = resolveKind(idea);
  const profile = PROFILE[kind];
  const out = { ok: true, kind, addMissing: [], addTools: [] };
  if (!owned.length) return { ...out, ok: false, reason: 'It doesn’t use any of your materials.' };

  const classes = owned.map((o) => materialClass(o.item));
  // Screws, glue, thread or sandpaper are never what a product is made of, even if the model says so.
  const isBody = (o) => !['fastener', 'adhesive', 'thread', 'finish', 'other'].includes(materialClass(o.item));
  const primaryOwned = owned.find((o) => isBody(o) && idea.primaryMaterial && o.item.name.toLowerCase() === String(idea.primaryMaterial).toLowerCase())
    || owned.find(isBody)
    || owned[0];
  const primary = materialClass(primaryOwned.item);
  const toolText = tools.join(' | ');

  // A name that states a material ("Cardboard box") must match what it is really made of.
  // (Only the product's own words count: "stand for glass jars" is not made of glass.)
  const named = materialClass({ name: String(idea.name || '').replace(/\b(for|to hold|holding|with)\b.*$/i, '') });
  if (NAMEABLE.has(named) && !classes.includes(named)) {
    return { ...out, ok: false, reason: `It’s called ${CLASS_LABEL[named] || named}, but it would be made from ${primaryOwned.item.name}.` };
  }
  // Whatever kind the model chose, a name that says it carries weight must be built from something structural.
  if (LOAD_WORDS.test(String(idea.name || '').toLowerCase()) && !STRUCTURAL.includes(primary)) {
    return { ...out, ok: false, reason: `It has to carry weight, and ${CLASS_LABEL[primary] || primaryOwned.item.name} can’t do that safely.` };
  }
  if (profile) {
    if (!classes.some((c) => profile.core.includes(c))) {
      return { ...out, ok: false, reason: `A ${kind.replace(/_/g, ' ')} needs ${list(profile.core)} as its main material — none of those are in what you have.` };
    }
    if (profile.load && !STRUCTURAL.includes(primary)) {
      return { ...out, ok: false, reason: `It has to carry weight, and ${CLASS_LABEL[primary] || primaryOwned.item.name} can’t do that safely.` };
    }
    if (profile.join && !classes.some((c) => profile.join.includes(c))) {
      const listed = (idea.missing || []).some((m) => profile.join.includes(materialClass({ name: m.name })));
      // How parts join depends on the material: screws for wood, glue or tape for cardboard…
      // Fastener-only products (wall shelf, key rack) are always wood or metal — the weight rule ensures it.
      const join = profile.join.includes('adhesive') ? JOIN_BY[primary] || JOIN_BY.wood : primary === 'metal' ? JOIN_BY.metal : JOIN_BY.wood_fastener;
      if (!listed) out.addMissing.push({ name: join.name, quantity: join.qty, unit: join.unit, estUnitPrice: 0, why: 'to join the parts' });
    }
    if (profile.sew && !SEWING.test(toolText) && !classes.includes('adhesive')) out.addTools.push('Needle or sewing machine');
  }
  // Cutting the main material needs a tool that can cut it — when the design cuts it. The build
  // steps say so; an idea without steps is assumed to need cutting.
  const cut = CUTS[primary];
  const steps = Array.isArray(idea.steps) ? idea.steps.join(' ') : '';
  const cuts = !steps.trim() || /\b(cut|cuts|cutting|saw|sawing|trim|trimming|slice|snip|score|pierce|punch)\b/i.test(steps);
  if (cut && cuts && !(primary === 'wood' ? WOOD_CUTTER : CUTTER).test(toolText)) out.addTools.push(cut);

  // A named component the product can't work without ("zipped bag", "alarm clock") that the
  // user doesn't have goes on the shopping list instead of being silently assumed.
  const ownedText = owned.map((o) => o.item.name.toLowerCase()).join(' | ');
  const listedText = (idea.missing || []).map((m) => String(m.name).toLowerCase()).join(' | ');
  const nameText = String(idea.name || '').toLowerCase();
  for (const [re, part] of KEY_PARTS) {
    if (re.test(nameText) && !re.test(ownedText) && !re.test(listedText)) out.addMissing.push({ name: part, quantity: 1, unit: 'pcs', estUnitPrice: 0, why: `the product needs it and it isn’t in your materials` });
  }
  return out;
}

const KEY_PARTS = [
  [/\bzip(per|ped)?s?\b/, 'Zip'],
  [/\bclock\b/, 'Clock movement'],
  [/\bmagnet(ic|s)?\b/, 'Magnets'],
  [/\bhinged?\b/, 'Hinges'],
  [/\bwheels?\b/, 'Wheels'],
  [/\bvelcro\b/, 'Hook-and-loop tape'],
];

// The model's own tool list is unreliable ("screwdriver" for a bottle pen holder). A tool it
// names only counts when it fits a material the product really uses.
const TOOL_FITS = [
  [/solder|wire strip/i, ['electronics']],
  [/drill|driver/i, ['fastener']],
  [/sewing machine/i, []], // a needle does the same job; covered by the sewing rule
];
// Steps that use a tool imply it, whatever the tool list says ("Drill 6 mm holes…").
const STEP_TOOLS = [
  [/\bdrill(s|ed|ing)?\b/i, 'Drill / driver'],
  [/\bsolder(s|ed|ing)?\b/i, 'Soldering iron'],
  [/\b(sew|sews|sewn|sewing|stitch|stitches|stitching)\b/i, 'Needle or sewing machine'],
];
/**
 * The model's tools that matter for this design: those that fit the materials (a drill for
 * screws, a soldering iron for electronics) or that its own build steps actually use, plus
 * tools the steps imply.
 */
export function relevantModelTools(toolsRequired = [], owned = [], steps = []) {
  const classes = new Set(owned.map((o) => materialClass(o.item)));
  const stepText = (Array.isArray(steps) ? steps : [steps]).join(' ');
  const named = toolsRequired.filter((t) => {
    const fit = TOOL_FITS.find(([re]) => re.test(t));
    if (fit && fit[1].some((c) => classes.has(c))) return true;
    const word = String(t).toLowerCase().match(/[a-z]{4,}/)?.[0];
    return Boolean(fit && word && new RegExp(`\\b${word}`, 'i').test(stepText));
  });
  const implied = STEP_TOOLS.filter(([re, tool]) => re.test(stepText) && !named.some((t) => re.test(t) || t === tool)).map(([, tool]) => tool);
  return [...named, ...implied];
}

// Supplies whose exact amount rarely decides whether a build can start.
const SUPPLY_CLASSES = new Set(['adhesive', 'finish', 'thread']);
export const isSupply = (item) => SUPPLY_CLASSES.has(materialClass(item));
