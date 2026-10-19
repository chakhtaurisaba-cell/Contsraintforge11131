// Final quality gate for every idea, applied by the app (not trusted to the model):
//
//   before grounding — the build steps: no vague steps, a real physical action, safe treatment of
//                      glass, and every tool the steps use must be one the user owns (cut steps
//                      name the user's own cutting tool);
//   after grounding  — the product must be more than an owned object under a new name
//                      ("glass jar" → "vase"), and glass must not hang from tape.
//
// A candidate that fails is rejected with a short reason the user can read ("left out"). Tools
// the steps need but the user lacks are returned so the idea is marked "needs a tool" — it is
// then not a card, but can feed the one-item unlock suggestion.
import { materialClass } from '../../shared/productKind.js';

/* ----------------------------- steps ----------------------------- */

const VAGUE_STEP = /^(now\s+|then\s+|finally\s+)?(prepare|assemble|construct|build|make|create|put together|finish|complete|attach|decorate)\s+(the\s+|your\s+|all\s+)?(product|project|item|materials?|pieces?|parts?|components?|it|everything|design|base|structure|organi[sz]er|holder)(\s+(together|securely|properly|carefully))?\s*\.?$/i;
/** Removes steps that say nothing ("Assemble the materials.", "Attach securely."). */
export function concreteSteps(steps = []) {
  return steps.map((s) => String(s).trim()).filter((s) => s && !VAGUE_STEP.test(s) && !/^(attach|fix|secure) (it )?(securely|firmly|properly)\.?$/i.test(s) && s.split(/\s+/).length >= 4);
}

// A step that physically changes or combines something.
const ACTION = /\b(cut|cuts|snip|trim|saw|fold|bend|wrap|wind|tie|knot|loop|thread|lace|glue|tape|stick|press|attach|fix|fasten|screw|nail|hammer|drill|sand|fill|pour|mark|measure|stack|roll|twist|insert|push|slide|hang|clamp|join|sew|stitch|weave|punch|poke|line|cover|seal|paint|label)\w*\b/i;

// Tools that steps can use, how to recognise them in a step, and what counts as owning them.
const TOOLS = [
  { name: 'Scissors', step: /\bscissors\b|\bsnip/i, owns: /scissor|shears/i },
  { name: 'Craft knife', step: /\b(craft|utility|hobby|box)[ -]?(knife|cutter)\b|\bknife\b|\bblade\b/i, owns: /knife|cutter|blade|scalpel/i },
  { name: 'Saw', step: /\b(hand ?saw|saw|sawing|hacksaw|jigsaw)\b/i, owns: /saw/i },
  { name: 'Drill / driver', step: /\bdrill(s|ed|ing)?\b/i, owns: /drill|driver/i },
  { name: 'Screwdriver', step: /\bscrewdriver\b/i, owns: /screwdriver|drill|driver/i },
  { name: 'Hammer', step: /\bhammer(ing)?\b|\bnail (it|them|the)\b/i, owns: /hammer|mallet/i },
  { name: 'Needle', step: /\b(needle|sew|sewing|stitch(es|ing)?)\b/i, owns: /needle|sewing/i },
  { name: 'Hot-glue gun', step: /\b(hot[ -]?glue|glue gun)\b/i, owns: /glue gun|hot.?glue/i },
  { name: 'Stapler', step: /\bstapl(e|er|ing)\b/i, owns: /stapl/i },
  { name: 'Pliers', step: /\bpliers\b/i, owns: /pliers/i },
  { name: 'Clamps', step: /\bclamp(s|ed|ing)?\b/i, owns: /clamp/i },
  { name: 'Hole punch', step: /\bhole punch\b/i, owns: /punch/i },
  { name: 'Paint brush', step: /\bbrush\b/i, owns: /brush/i },
];
// "Cut the bottle" is a cut; "tape over the cut edge" is not.
const CUT_STEP = /\b(cut|cuts|cutting|trim|trimming|snip|slice|score)\b(?!\s+(edges?|ends?|rims?|lines?|sides?|marks?|surfaces?))/i;
const CUTTER_OWNS = /scissor|shears|knife|cutter|blade|scalpel|saw/i;

/** The user's cutting tool for this material (a saw for wood; scissors/knife otherwise), or null. */
function cuttingToolFor(userTools, primaryClass) {
  const tools = userTools.map(String);
  if (primaryClass === 'wood') return tools.find((t) => /saw/i.test(t)) || null;
  return tools.find((t) => /scissor|shears/i.test(t)) || tools.find((t) => /knife|cutter|blade|scalpel/i.test(t)) || tools.find((t) => /saw/i.test(t)) || null;
}

/** A step that cuts must say with what: the user's own tool is named when the model didn't. */
export function nameCuttingTool(steps, userTools, primaryClass) {
  const tool = cuttingToolFor(userTools, primaryClass);
  if (!tool) return steps;
  return steps.map((s) => (CUT_STEP.test(s) && !CUTTER_OWNS.test(s) && !/\b(tape|cord|lace|string|twine|thread)\b.{0,12}\b(length|piece|strip)/i.test(s) ? `${s.replace(/\.\s*$/, '')} (use your ${tool.toLowerCase()}).` : s));
}

// Cutting, drilling or breaking glass (not its metal lid) is not a beginner job.
const GLASS_CUT = /\b(cut|cutting|drill|drilling|saw|sawing|score|scoring|break|breaking|crack)\w*\s+(a\s+|the\s+|into\s+the\s+|through\s+the\s+|off\s+the\s+)?(holes?\s+(in|into|through)\s+(the\s+)?)?(glass|jar|bottle)(?!\s*(lid|cap))\b/i;
const GLASS_HOLE = /\bholes?\s+(in|into|through)\s+(the\s+)?(glass|jar)(?!\s*(lid|cap))\b/i;

/**
 * Checks the steps against the user's tools and basic safety. Returns
 * { reject?: reason, steps, toolsNeeded: [tool names the steps use but the user doesn't own] }.
 */
export function checkSteps(idea, { userTools = [], primaryClass = 'other', usesGlass = false } = {}) {
  let steps = concreteSteps(idea.steps || []);
  if (steps.length < 2) return { reject: 'its building steps were too vague to follow', steps, toolsNeeded: [] };
  const text = steps.join(' ');
  if (!ACTION.test(text)) return { reject: 'nothing is actually built or changed — it is the same object under a new name', steps, toolsNeeded: [] };
  if (usesGlass && (GLASS_CUT.test(text) || GLASS_HOLE.test(text)) && !/\b(bottle|jar)\s+(lid|cap)\b/i.test(text.match(GLASS_CUT)?.[0] || '')) {
    return { reject: 'it asks you to cut or drill glass, which isn’t safe without special tools', steps, toolsNeeded: [] };
  }
  const owned = userTools.map(String);
  const toolsNeeded = TOOLS.filter((t) => t.step.test(text) && !owned.some((o) => t.owns.test(o))).map((t) => t.name);
  // Cutting with no cutting tool at all: the cut is impossible, whatever the step says.
  if (CUT_STEP.test(text) && !owned.some((o) => CUTTER_OWNS.test(o)) && !toolsNeeded.some((t) => /scissors|knife|saw/i.test(t))) {
    toolsNeeded.push(primaryClass === 'wood' ? 'Saw' : 'Scissors');
  }
  // Screws are driven with a screwdriver or a drill — never with a hammer.
  if (/\bscrews?\b/i.test(text) && !/\b(cap|lid)\b/i.test(text.match(/[^.]*\bscrews?\b[^.]*/i)?.[0] || '') && !owned.some((o) => /screwdriver|drill|driver/i.test(o)) && !toolsNeeded.includes('Screwdriver')) {
    toolsNeeded.push('Screwdriver');
  }
  steps = nameCuttingTool(steps, owned, primaryClass);
  return { steps, toolsNeeded };
}

/** Tools a text uses that the user doesn't own (for build-plan steps). */
export function toolsNotOwned(text, userTools = []) {
  const owned = userTools.map(String);
  return TOOLS.filter((t) => t.step.test(text) && !owned.some((o) => t.owns.test(o))).map((t) => t.name);
}

/** 1-based numbers of build-plan steps that are too vague for a beginner. */
export function vaguePlanSteps(steps = []) {
  return steps
    .map((s, i) => ({ n: i + 1, text: String(s.instructions || '').trim() }))
    .filter((s) => !concreteSteps([s.text]).length || s.text.split(/\s+/).length < 8)
    .map((s) => s.n);
}

/* ----------------------------- the product itself ----------------------------- */

// What an owned object already is, by its form: calling it that again is not a project
// (a jar is already a vase and a container; a box is already storage; a cup already holds pens).
const FORMS = [
  { form: /\bjars?\b/i, words: /\b(jar|glass|mason)\b/gi, inherent: /\b(vase|containers?|canisters?|storage|cups?|pots?|holders?|pen(cil)? (holders?|cups?|pots?)|flower holders?|drinking glass|tumbler|jars?)\b/i },
  { form: /\bbottles?\b/i, words: /\b(plastic|pet|glass|bottles?)\b/gi, inherent: /^(\s*(water|drink(s|ing)?|liquid)?\s*(containers?|holders?|carriers?|vase|bottles?)\s*)$/i },
  { form: /\b(box(es)?|cartons?|crates?)\b/i, words: /\b(cardboard|wooden|plastic|box(es)?|cartons?)\b/gi, inherent: /\b(box(es)?|storage|containers?|bins?|cartons?)\b/i },
  { form: /\b(cups?|mugs?)\b/i, words: /\b(cups?|mugs?|ceramic|paper|plastic)\b/gi, inherent: /\b(cups?|holders?|pen(cil)? (holders?|pots?)|containers?)\b/i },
  { form: /\b(cans?|tins?)\b/i, words: /\b(tin|metal|cans?|tins?)\b/gi, inherent: /\b(cans?|tins?|containers?|holders?|pen(cil)? (holders?|pots?))\b/i },
  { form: /\b(buckets?|tubs?|baskets?)\b/i, words: /\b(plastic|buckets?|tubs?|baskets?)\b/gi, inherent: /\b(buckets?|tubs?|baskets?|storage|containers?)\b/i },
];
// Steps that change the object's structure (not just decorate or fill it).
const STRUCTURAL = /\b(cut|cuts|cutting|trim|trimming|snip|fold|folding|bend|bending|drill|drilling|saw|sawing|sew|sewing|stitch|punch|divid\w*|(add|attach|fit|fix)\s+(a|an|the)\s+(handle|lid|base|divider|hook|hanger|spout|stand|leg|legs|shelf))\b(?!\s+(edges?|ends?|rims?))/i;

// Words that show a new function or a real construction on top of the object.
const NEW_FUNCTION = /\b(hanging|hanger|hang|wall|lantern|lamp|light|feeder|birdhouse|planter|plant|terrarium|dispenser|funnel|scoop|organi[sz]er|divider|divided|caddy|rack|stand|tray|lid|cover|sleeve|grip|handle|carrier|tote|bag|weight|dumbbell|rolling pin|shaper|reel|spool|stop|bank|piggy|maraca|shaker|toy|game|bowling|sprinkler|watering|drip|irrigation|mobile|wind ?chime|chime|scarer|trap|cloche|greenhouse|seed|propagat|candle|lantern|lamp)\b/i;

/**
 * True when the idea is an owned object renamed: it is built around ONE owned object (a jar, a
 * box, a cup…), its purpose is what that object already does, and no new function is added —
 * "Glass jar vase", "Cardboard storage box" (from a box), "Cup pencil holder". Decorating it
 * (wrapping, painting) does not change what it is for.
 */
export function isRenamedObject(idea) {
  const uses = idea.usesExisting || [];
  // Paint and varnish decorate ("acrylic paint" is not a plastic part); glue, tape, cord and fasteners don't make a new object either.
  const decoration = (name) => /\b(paint|varnish|stain|lacquer|polish|sticker|ribbon)\b/i.test(name) || ['adhesive', 'thread', 'finish', 'fastener', 'other'].includes(materialClass({ name }));
  const body = uses.filter((u) => !decoration(u.inventoryName));
  if (body.length !== 1) return false;
  // Cutting, folding, drilling or adding a part is a real modification, whatever the name says.
  if (STRUCTURAL.test((idea.steps || []).join(' '))) return false;
  const form = FORMS.find((f) => f.form.test(body[0].inventoryName));
  if (!form) return false;
  const name = String(idea.name || '').toLowerCase();
  if (NEW_FUNCTION.test(name)) return false;
  // The purpose words, without the material ("Glass jar vase" → "vase").
  const purpose = name.replace(form.words, ' ').replace(/\b(simple|easy|diy|handmade|upcycled|recycled|decorative|decorated|wrapped|painted|rustic|mini|small|large|big|twine|lace|shoelace|cord|string|ribbon|tape|taped|glued)[- ]?/gi, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return !purpose || form.inherent.test(purpose);
}

/** Glass hung or wall-mounted with nothing stronger than tape or glue (a cord, wire or hook to buy counts). */
export function tapeHoldsGlass(idea) {
  const uses = [...(idea.usesExisting || []).map((u) => u.inventoryName), ...(idea.missing || []).map((m) => m.name)].map((name) => ({ cls: materialClass({ name }), name }));
  if (!uses.some((u) => u.cls === 'glass')) return false;
  const text = `${idea.name} ${(idea.steps || []).join(' ')}`;
  if (!/\b(hang|hanging|hung|suspend\w*|wall)\b/i.test(text)) return false;
  const strongHolder = uses.some((u) => u.cls === 'thread' || u.cls === 'fastener' || u.cls === 'metal' || /hook|wire|bracket/i.test(u.name));
  return !strongHolder;
}

/** The after-grounding checks; returns a reason to reject, or null. */
export function checkProduct(idea) {
  if (isRenamedObject(idea)) return 'it is the same object under a new name — nothing meaningful is built or changed';
  if (tapeHoldsGlass(idea)) return 'tape can’t safely hold up a glass object';
  return null;
}

/** A practical precaution when the design genuinely needs one and the model gave none. */
export function safetyNoteFor(idea) {
  if (idea.safetyNote?.trim()) return idea.safetyNote;
  const uses = (idea.usesExisting || []).map((u) => materialClass({ name: u.inventoryName }));
  const text = `${idea.name} ${(idea.steps || []).join(' ')}`;
  if (uses.includes('glass') && /\bhang|hung|suspend/i.test(text)) return 'Keep it light and hang it low over a soft surface — knots can slip and glass breaks.';
  if (uses.includes('plastic_bottle') && /\bcut/i.test(text)) return 'Cut plastic edges are sharp: cover them with tape before use.';
  return idea.safetyNote || '';
}
