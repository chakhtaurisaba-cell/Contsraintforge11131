// Product ideation + build-plan generation.
//
// Ideas come ONLY from the AI pipeline: validate the input → identify materials →
// generate candidates → reconcile them against real stock (reuse first) → research
// them on the web (separate request, see research.js). There is no template fallback:
// if the AI is unavailable or the input names no materials, the caller gets an honest
// status instead of generic products.
//
// The parametric templates in engine/templates.js are used only to plan the clearly
// labelled example projects (idea.engine === 'demo').
import { z } from 'zod';
import { aiEnabled, aiConfigured, structured, AIError } from '../ai/client.js';
import { IdeaResult, BuildPlan, ParsedResources } from '../ai/schemas.js';
import { SYSTEM_IDEATION, SYSTEM_PLAN, SYSTEM_PARSE } from '../ai/prompts.js';
import { templateById } from '../engine/templates.js';
import { matchesKey, MATERIALS, keyFor, TOOLS } from '../engine/lexicon.js';
import { fromUSD, itemDimsMM, roundTo } from '../engine/units.js';
import { allocate, toolCheck } from '../../shared/allocation.js';
import { nameSimilarity, tokens } from '../../shared/lexicon.js';
import { DIMENSION_STATUS } from '../../shared/constants.js';
import { uid } from '../db.js';
import { config } from '../config.js';
import { checkFeasibility, relevantModelTools, isSupply } from './feasibility.js';
import { researchProduct } from './research.js';

const r2 = (v) => Math.round(v * 100) / 100;

const testBatchFor = (request) => Math.max(1, Math.min(Number(request.quantity) || 3, 3));

/** Tools the user has: listed tools + tool-like inventory items (e.g. a scanned drill). */
export function userToolList(request, inventory) {
  const fromInventory = inventory.filter((i) => Object.values(TOOLS).some((t) => t.match.some((m) => `${i.name}`.toLowerCase().includes(m)))).map((i) => i.name);
  return [...new Set([...(request.tools || []), ...fromInventory])];
}

/** Cheap pre-check before any AI call: the text must contain at least one real word. */
export function precheckText(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: true, empty: true };
  if (!/\p{L}{2,}/u.test(t)) return { ok: false };
  return { ok: true };
}

const unrecognized = (text, reason) => ({
  status: 'unrecognized',
  ideas: [],
  message: `We couldn’t recognise any materials in “${String(text).slice(0, 60)}”.${reason ? ` ${reason}` : ''} Describe the objects you have — for example “6 pine boards, wood screws and a drill” — or scan them with your camera.`,
});

/**
 * Ground one model idea in the real inventory. Nothing the model claims is trusted as-is:
 * - every "uses your X" claim must match a real inventory item (unmatched claims are dropped);
 * - owned parts and the model's shopping list go through the deterministic allocator, so
 *   quantities are checked against stock, owned/substitutable items are never bought and
 *   only the exact shortfall remains;
 * - required tools are checked against the user's tools;
 * - the finished size is checked against the stock it is cut from, when sizes are known.
 * Returns null when the idea uses nothing the user owns (not grounded → not shown).
 */
function groundIdea(idea, pool, testBatch, request) {
  const owned = [];
  for (const u of idea.usesExisting || []) {
    const item = findInventoryItem(u.inventoryName, pool);
    if (!item || owned.some((o) => o.item.id === item.id)) continue;
    owned.push({ item, quantity: Number(u.quantityUsed) > 0 ? Number(u.quantityUsed) : 1, unit: u.unit || item.unit || 'pcs', use: u.use || '' });
  }
  // A small model sometimes lists the same item as both "uses your X" and "buy X". The owned
  // line already checks the quantity (and reports any shortfall), so the duplicate is dropped —
  // otherwise it would be bought on top of stock the user has.
  const ownedIds = new Set(owned.map((o) => o.item.id));
  const missing = (idea.missing || []).filter((m) => !ownedIds.has(findInventoryItem(m.name, pool)?.id));
  // Reusable equipment (a melting pot, scissors, a mould) is used again for every unit:
  // it is checked once, never multiplied by the batch size or put on a shopping list.
  const equipment = owned.filter((o) => isEquipment(o.item));
  const consumed = owned.filter((o) => !isEquipment(o.item));
  // Physical sense first: an idea whose materials can't do the job is rejected, with the reason.
  const feas = checkFeasibility({ ...idea, missing }, consumed.length ? consumed : owned, request.userTools || []);
  if (!feas.ok) return { rejected: true, name: idea.name, reason: feas.reason };
  missing.push(...feas.addMissing);
  const bom = [
    ...consumed.map((o) => ({ name: o.item.name, quantity: o.quantity, unit: o.unit, unitPrice: Number(o.item.unit_value) || 0, inventoryId: o.item.id, whyNeeded: o.use, owned: true })),
    ...missing.map((m) => ({ name: m.name, quantity: Number(m.quantity) || 0, unit: m.unit || 'pcs', unitPrice: Number(m.estUnitPrice) || 0, matchKey: keyFor(m.name), whyNeeded: m.why })),
  ];
  const a = allocate(bom, pool, testBatch);
  const usedIds = new Set([...a.lines.flatMap((l) => l.sources.map((s) => s.itemId)).filter(Boolean), ...equipment.map((o) => o.item.id)]);
  if (!usedIds.size) return null;

  const materials = [
    ...a.lines.map((l) => {
      const src = bom[l.index];
      const from = [...new Set(l.sources.map((s) => s.name))];
      return { name: src.name, use: src.whyNeeded || '', perUnit: src.quantity, unit: l.unit, needTotal: l.needTotal, status: l.status, from, shortage: l.shortage, note: l.note, needsConfirmation: l.needsConfirmation };
    }),
    ...equipment.map((o) => ({ name: o.item.name, use: o.use, perUnit: 1, unit: o.item.unit || 'pcs', needTotal: 1, status: 'available', from: [o.item.name], shortage: 0, note: 'Reused for every unit.', needsConfirmation: false, equipment: true })),
  ];
  const essential = materials.filter((m) => m.status !== 'optional_upgrade');
  const covered = essential.filter((m) => ['available', 'available_with_adaptation', 'substitutable'].includes(m.status));
  const purchases = a.purchases.map((p) => ({ name: p.name, quantity: p.quantity, unit: p.unit, estUnitPrice: p.unitPrice, reason: p.reason }));
  const shortageCost = r2(purchases.reduce((s, p) => s + p.quantity * (p.estUnitPrice || 0), 0));

  const userTools = request.userTools || [];
  // Tools: cutting/sewing needs from the rules, plus only those model-named tools that fit the materials used.
  const toolsMissing = [...new Set([...toolCheck(relevantModelTools(idea.toolsRequired, owned), userTools, pool).filter((t) => !t.have).map((t) => t.name), ...feas.addTools])];
  // An unknown amount of glue, sandpaper or thread doesn't block a build; other unknown amounts do.
  // (Judged by the stock item that actually covers the line, whichever list the model put it in.)
  const coveredBySupply = (l) => l.sources.some((src) => src.itemId && isSupply(pool.find((p) => p.id === src.itemId) || {}));
  const confirmNotes = a.lines.filter((l) => l.needsConfirmation && !coveredBySupply(l)).map((l) => l.note);
  const sizeWarning = sizeCheck(idea, owned);
  const confirm = confirmNotes.length > 0 || Boolean(sizeWarning);
  const verdict = purchases.length ? 'short' : toolsMissing.length ? 'tools' : confirm ? 'confirm' : 'ready';

  return {
    ...idea,
    tagline: idea.summary,
    description: idea.summary,
    visualShape: idea.visualKind,
    kind: feas.kind,
    // What the allocator actually takes from stock (per unit) — including owned items that
    // cover something the model wanted to buy.
    usesExisting: a.lines.flatMap((l) => l.sources.filter((s) => s.itemId).map((s) => ({
      inventoryName: s.name,
      // Per-unit need for parts the design uses directly; for items covering a shopping-list
      // line (or a substitute), what is actually taken from stock per unit.
      quantityUsed: bom[l.index].owned ? bom[l.index].quantity : r2(s.qty / testBatch),
      unit: s.unit,
      use: bom[l.index].owned ? bom[l.index].whyNeeded : s.kind === 'substitute' ? `instead of ${bom[l.index].name}` : bom[l.index].name,
    }))).concat(equipment.map((o) => ({ inventoryName: o.item.name, quantityUsed: 1, unit: o.item.unit || 'pcs', use: o.use || 'reused for every unit' }))),
    materials,
    missing: purchases,
    missingBasis: `for ${testBatch} unit${testBatch === 1 ? '' : 's'}`,
    toolsMissing,
    sizeWarning,
    confirmNotes,
    fit: { ownedParts: covered.length, totalParts: essential.length, itemsUsed: usedIds.size },
    verdict,
    shortageCost,
    testBatch,
    testBatchCash: shortageCost,
    estCashCostPerUnit: r2(shortageCost / testBatch),
    nothingToBuy: purchases.length === 0,
    maxUnitsFromStock: a.maxUnitsFromStock,
  };
}

/** Exact name first, then token similarity, then the material lexicon. */
function findInventoryItem(name, pool) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const exact = pool.find((i) => i.name.toLowerCase() === n);
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  for (const i of pool) {
    const s = nameSimilarity(i.name, n);
    if (s > bestScore) [best, bestScore] = [i, s];
  }
  if (bestScore >= 0.5) return best;
  const key = keyFor(n);
  return key ? pool.find((i) => matchesKey(i, key)) || null : null;
}

// Reusable equipment: listed tools plus vessels and aids that are not used up.
const EQUIPMENT = /\b(pot for|melting pot|cooking pot|saucepan|pan|double boiler|mou?lds?|jigs?|templates?|needles?|machines?|knife|knives|scissors|drill|saw|hammer|kettle|thermometer|brush(es)?|ruler|clamps?|glue gun|hot-glue gun)\b/i;
// Whole words only: the tool lexicon matches substrings ("pan" in "panel", "pot" in "plant pot").
const isEquipment = (item) => EQUIPMENT.test(item.name);

const SHEET = /wood|board|plank|timber|plywood|mdf|cardboard|card|acrylic|sheet|panel|pine|oak|bamboo|fabric|cloth|felt|leather/i;
/** The product's longest side must fit the longest owned sheet/board it is made from (when both sizes are known). */
function sizeCheck(idea, owned) {
  const longest = Math.max(Number(idea.size?.length) || 0, Number(idea.size?.width) || 0, Number(idea.size?.height) || 0);
  if (!longest) return null;
  const stock = owned
    .filter((o) => SHEET.test(`${o.item.name} ${o.item.material || ''}`))
    .map((o) => ({ o, dims: itemDimsMM(o.item) }))
    .filter((x) => x.dims);
  if (!stock.length) return null;
  const maxStock = Math.max(...stock.map((x) => Math.max(x.dims.length || 0, x.dims.width || 0, x.dims.height || 0, x.dims.diameter || 0)));
  if (!maxStock || longest <= maxStock * 1.02) return null;
  return `Its longest side (~${Math.round(longest)} mm) is longer than your longest piece (${Math.round(maxStock)} mm), so it needs a joint or a smaller size.`;
}

const VERDICT_RANK = { ready: 0, confirm: 1, tools: 2, short: 3 };
const DIFFICULTY_RANK = { beginner: 0, intermediate: 1, advanced: 2 };
/**
 * Transparent ranking: buildable now first, then the share of parts covered by your stock,
 * then the cost of any shortage, then difficulty and build time.
 */
function rankIdeas(a, b) {
  const share = (i) => (i.fit.totalParts ? i.fit.ownedParts / i.fit.totalParts : 0);
  return (
    VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
    share(b) - share(a) ||
    a.shortageCost - b.shortageCost ||
    (DIFFICULTY_RANK[a.difficulty] ?? 1) - (DIFFICULTY_RANK[b.difficulty] ?? 1) ||
    (Number(a.estProductionMinutes) || 0) - (Number(b.estProductionMinutes) || 0)
  );
}

/** Plain-language flags from the user's own limits (budget, time). */
function finaliseIdea(idea, request) {
  const flags = [];
  const budget = Number(request.budget) || null;
  if (budget != null && idea.shortageCost > budget) flags.push(`The parts to buy cost about ${idea.shortageCost} ${request.currency} — more than your ${budget} ${request.currency} budget.`);
  if (request.hoursPerWeek && idea.estProductionMinutes * idea.testBatch > request.hoursPerWeek * 60) flags.push(`Making ${idea.testBatch} takes longer than the time you have in a week.`);
  // textMaterials: what the person typed, so a project made from this idea can add it to the inventory.
  return { ...idea, id: uid(), engine: 'ai', flags, userTools: request.userTools || request.tools || [], currency: request.currency, textMaterials: request.textMaterials || [] };
}

/* ------------------------- example projects (templates) ------------------------- */

function makeCtx(inventory, currency) {
  const find = (key) => inventory.filter((i) => matchesKey(i, key));
  return {
    find,
    item: (key) => find(key)[0] || null,
    price: (usd) => fromUSD(usd, currency),
    stock(key, defaults) {
      const items = find(key);
      const item = items.find((i) => itemDimsMM(i)) || items[0] || null;
      const dims = item ? itemDimsMM(item) || {} : {};
      const out = {};
      const assumptions = [];
      for (const [k, def] of Object.entries(defaults)) {
        if (dims[k] != null && dims[k] > 0) out[k] = Math.round(dims[k]);
        else {
          out[k] = def;
          assumptions.push({ text: `Assumed ${k} = ${def} mm${item ? ` for "${item.name}"` : ''} — measure before cutting.`, needsMeasurement: true });
        }
      }
      if (item && ['ai_inferred', 'from_marking'].includes(dims.status)) {
        assumptions.push({ text: `Sizes of "${item.name}" come from a photo. Check them with a tape measure before cutting.`, needsMeasurement: true });
      }
      return { item, dims: out, assumptions, status: item ? dims.status || null : null };
    },
  };
}

function demoBom(t, ctx, plan) {
  const reqs = plan.requirements || t.requires;
  return reqs.map((r) => {
    const item = ctx.item(r.key);
    let qty = r.perUnit;
    let adaptation = r.adaptation || null;
    if (r.key === 'wood_board' && plan.cutList && item) {
      const stockLen = itemDimsMM(item)?.length || null;
      if (stockLen) {
        const used = plan.cutList.layout.reduce((s, b) => s + b.cuts.reduce((a, c) => a + c.length + 3, 0), 0);
        qty = plan.cutList.boardsNeeded > 1 ? plan.cutList.boardsNeeded : r2(Math.max(used / stockLen, 0.05));
        adaptation = `Cut from your “${item.name}” (${stockLen} mm long) — see the cut list.`;
      }
    }
    if (r.key === 'wax' && plan.summary.match(/(\d+) g of wax/)) qty = r2(Number(plan.summary.match(/(\d+) g of wax/)[1]) / 1000);
    if (r.key === 'rope' && plan.components[0]?.cutLength) qty = r2((plan.components[0].cutLength * plan.components[0].quantity) / 1000);
    return {
      name: item ? item.name : r.buy.name,
      quantity: qty,
      unit: r.unit,
      material: MATERIALS[r.key]?.label || r.key,
      spec: r.buy.spec,
      unitPrice: item?.unit_value != null ? Number(item.unit_value) : ctx.price(r.buy.usd),
      priceSource: item?.unit_value != null ? 'user' : 'demo_estimate',
      role: r.why || (r.essential ? 'Main material' : 'Hardware'),
      matchKey: r.key,
      optional: Boolean(r.optional),
      substitutes: r.substitutes || [],
      adaptation,
      whyNeeded: r.why || '',
      buyName: r.buy.name,
    };
  });
}

function demoPlan(project, inventory, currency) {
  const t = templateById(project.idea?.templateId);
  if (!t) return null;
  const ctx = makeCtx(inventory, currency);
  const plan = t.plan(ctx);
  return { ...plan, bom: demoBom(t, ctx, plan) };
}

/* ----------------------------- AI engine ----------------------------- */

const inventoryForPrompt = (inventory) =>
  inventory.map((i) => ({
    name: i.name,
    material: i.material,
    // Small local models refuse to design anything when a quantity is a string such as
    // "not stated"; a numeric placeholder marked as an assumption keeps them working.
    quantity: i.quantityUnknown ? 1 : i.quantity,
    ...(i.quantityUnknown ? { quantityAssumed: 'amount not given — 1 is a placeholder; size designs small' } : {}),
    unit: i.unit,
    condition: i.condition,
    dimensions: i.dimensions ? { ...i.dimensions, provenance: DIMENSION_STATUS[i.dimensions.status]?.label || i.dimensions.status } : 'unknown',
    replacementValue: i.unit_value,
  }));

const aiParseFreeText = (text) => structured({ system: SYSTEM_PARSE, content: text, schema: ParsedResources, effort: 'low', maxTokens: 700, label: 'parse materials' });

/** Drops null, empty-string and empty-array fields so the prompt carries only real information. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));

// The ideas array is generated in schema order, so a finished idea ends with its last field.
const LAST_IDEA_FIELD = '"visualKind"';

async function aiIdeas(request, inventory, { nudge = '', onDrafted } = {}) {
  const payload = compact({
    inventory: inventoryForPrompt(inventory).map(compact),
    toolsOwned: request.userTools,
    skills: request.skills,
    budget: request.budget,
    currency: request.currency,
    hoursPerWeek: request.hoursPerWeek,
    unitsWanted: request.quantity,
    customerType: request.customerType,
    region: request.region,
    categories: request.categories,
    spaceLimits: request.spaceLimits,
    goal: request.goal,
    targetMarginPct: request.targetMarginPct,
  });
  const max = config.ai.maxIdeas;
  let drafted = 0;
  return structured({
    system: SYSTEM_IDEATION,
    content: `Resources and constraints (JSON):\n${JSON.stringify(payload)}\n\nPropose ${max} genuinely different products these resources can make — different purposes, not variations of one product (each idea a different visualKind where possible), and use the other owned items too, not only the main material. Return fewer only if the materials truly cannot support ${max}. Keep every text field short.${nudge ? `\n\n${nudge}` : ''}`,
    // A compact idea is ~250–350 tokens; the budget leaves room without allowing runaway output.
    // The description reaches the model in prompt mode (no schema enforcement), where a small
    // model otherwise tends to answer with an empty list.
    schema: IdeaResult.extend({ ideas: IdeaResult.shape.ideas.max(max).describe(`${max} different products these materials can make — always propose some; an empty list only if nothing at all is possible`) }),
    effort: 'medium',
    maxTokens: 650 * max + 500,
    label: 'product ideas',
    onProgress: onDrafted && ((text) => {
      const n = text.split(LAST_IDEA_FIELD).length - 1;
      if (n !== drafted) onDrafted((drafted = n));
    }),
  });
}

const NUMBER_WORDS = /\b(\d+([.,]\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|a few|several|half|pair|pairs)\b/i;
/**
 * Did the text give an amount for this material? A small model reports "cotton wicks" as
 * "1, stated". For Latin-script text the words just before the item must contain a number
 * ("5 small glass jars", "1 kg of soy wax", "a drill"); otherwise the amount is unknown and
 * the user is asked to confirm it instead of being told to buy more.
 */
function amountStated(text, name) {
  if (!LATIN_ONLY.test(text)) return true;
  const low = text.toLowerCase();
  const first = tokens(name).map((t) => low.indexOf(t.slice(0, Math.max(4, Math.min(t.length, 6))))).filter((i) => i >= 0);
  if (!first.length) return true;
  const at = Math.min(...first);
  const before = low.slice(Math.max(0, at - 28), at).split(/[,;.\n]| and /).pop();
  return NUMBER_WORDS.test(before);
}

/** The text contains an explicit size (a number with a length unit, or "a x b"), so parsed sizes can be trusted. */
const sizeStated = (text) => /\d\s*(mm|cm|m|in|inch|inches|"|ft)\b|\d\s*[x×]\s*\d/i.test(text);

const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u;
/**
 * A small model sometimes "recognises" materials the text never mentions. For Latin-script
 * input every parsed material must share a word with the text; other scripts are trusted,
 * because the model may translate names into English.
 */
function mentioned(text, name) {
  if (!LATIN_ONLY.test(text)) return true;
  const words = new Set(tokens(text));
  const low = text.toLowerCase();
  return tokens(name).some((t) => words.has(t) || (t.length >= 4 && low.includes(t.slice(0, 4))));
}

function researchForPrompt(research) {
  if (!research || !research.sources?.length) return 'No external research is available — the plan is your own proposal; keep sourceRefs empty.';
  return [
    `Research summary: ${research.summary}`,
    research.typicalDimensions?.length ? `Typical dimensions found: ${research.typicalDimensions.join('; ')}` : '',
    'Sources (cite by index in sourceRefs):',
    ...research.sources.map((s, i) => `[${i}] ${s.title} (${s.publisher}, ${s.type}) ${s.url}\n    findings: ${(s.findings || []).join(' | ')}\n    methods: ${(s.methods || []).join(' | ')}\n    differs from user: ${s.differencesFromUser || '—'}`),
  ].filter(Boolean).join('\n');
}

// A simple product needs a short, specific manual, not a long one — and every list costs generation time.
const Step = BuildPlan.shape.steps.element;
const PLAN_SCHEMA = BuildPlan.extend({
  designConstraints: BuildPlan.shape.designConstraints.max(4),
  tolerances: BuildPlan.shape.tolerances.max(3),
  safety: BuildPlan.shape.safety.max(4),
  finalInspection: BuildPlan.shape.finalInspection.max(5),
  steps: z.array(Step.extend({ commonMistakes: Step.shape.commonMistakes.max(2), measurements: Step.shape.measurements.max(4) })).min(1).max(8),
});

async function aiPlan(project, inventory, currency, research) {
  // Only what the plan needs: the whole stored idea (materials analysis, research, flags…) would
  // double the prompt for nothing.
  const i = project.idea || {};
  const idea = compact({ name: i.name || project.name, summary: i.summary || i.description, size: i.size, usesExisting: i.usesExisting, missing: i.missing, substitutions: i.substitutions, toolsRequired: i.toolsRequired, difficulty: i.difficulty, dependsOnMeasurements: i.dependsOnMeasurements, safetyNote: i.safetyNote });
  const content = `Selected product idea (JSON):\n${JSON.stringify(idea)}\n\nConfirmed inventory (JSON):\n${JSON.stringify(inventoryForPrompt(inventory).map(compact))}\n\nTools the user owns: ${JSON.stringify(project.idea?.userTools || [])}\nCurrency for prices: ${currency}.\n\n${researchForPrompt(research)}\n\nProduce the complete build plan for ONE unit, adapted to this inventory.`;
  const plan = await structured({ system: SYSTEM_PLAN, content, schema: PLAN_SCHEMA, effort: 'high', maxTokens: 4000, label: 'build plan' });
  const byName = new Map(inventory.map((i) => [i.name.toLowerCase(), i]));
  plan.bom = plan.bom.map((b) => {
    const inv = b.inventoryItem ? byName.get(b.inventoryItem.toLowerCase()) : byName.get(b.name.toLowerCase());
    return {
      name: inv?.name || b.name,
      quantity: b.quantity,
      unit: b.unit,
      material: b.material,
      spec: b.spec,
      unitPrice: inv?.unit_value != null ? Number(inv.unit_value) : b.unitPrice,
      priceSource: inv?.unit_value != null ? 'user' : 'ai_estimate',
      role: b.role,
      inventoryId: inv?.id || null,
      matchKey: keyFor(`${b.name} ${b.material}`),
      optional: !b.essential,
      substitutes: (b.substitutes || []).map((s) => ({ keywords: [s.inventoryItem.toLowerCase()], note: s.note })),
      adaptation: b.adaptation || null,
      whyNeeded: b.whyNeeded,
      buyName: b.name,
    };
  });
  // Drop step → source references that point outside the verified source list.
  const n = research?.sources?.length || 0;
  plan.steps = plan.steps.map((s) => ({ ...s, sourceRefs: (s.sourceRefs || []).filter((i) => i >= 0 && i < n) }));
  plan.cutList = null;
  return plan;
}

/**
 * A part cut from an owned item cannot be bigger than that item (a 100 mm thick part from an
 * 18 mm board). Small models get this wrong, so every such part is flagged for the user.
 */
function cutCheck(plan, inventory) {
  const notes = [];
  for (const c of plan.components || []) {
    if (!c.fromInventory) continue;
    const item = findInventoryItem(c.fromInventory, inventory);
    const d = item && itemDimsMM(item);
    if (!d) continue;
    const stock = [d.length, d.width, d.thickness ?? d.height].filter((v) => v > 0).sort((a, b) => b - a);
    const part = [c.cutLength, c.cutWidth, c.thickness].filter((v) => v > 0).sort((a, b) => b - a);
    if (stock.length < 2 || !part.length) continue;
    if (part.some((v, k) => stock[k] != null && v > stock[k] * 1.01)) {
      notes.push(`"${c.name}" is planned at ${part.join(' × ')} mm, but your "${item.name}" is ${stock.join(' × ')} mm. Change the part size (or join pieces) before cutting.`);
    }
  }
  return notes;
}

const CUTTERS = /\b(saw|jigsaw|hacksaw|handsaw|knife|knives|cutter|scissors|shears|rotary)\b/i;
/**
 * Small models write "use the drill to cut the board". If a step asks for cutting and none of
 * the user's tools can cut, say so instead of presenting an impossible step as feasible.
 */
function cuttingToolCheck(plan, project, inventory) {
  const tools = [...(project.idea?.userTools || []), ...inventory.map((i) => i.name)];
  if (tools.some((t) => CUTTERS.test(t))) return [];
  const steps = (plan.steps || []).map((s, i) => ({ n: i + 1, text: `${s.title} ${s.instructions}` })).filter((s) => /\bcut(s|ting)?\b/i.test(s.text));
  if (!steps.length) return [];
  return [`Step${steps.length > 1 ? 's' : ''} ${steps.map((s) => s.n).join(', ')} ask${steps.length > 1 ? '' : 's'} you to cut, but none of your tools can cut (${(project.idea?.userTools || []).join(', ') || 'no tools listed'}). A drill can’t cut boards — you’ll need a saw, or keep the material at its full size.`];
}

/* ----------------------------- public API ----------------------------- */

function unavailable() {
  return aiConfigured()
    ? new AIError('Product ideas come from the AI service, which is unavailable right now. Please try again shortly.', 503, 'ai_unavailable', true)
    : new AIError('Product ideas come from the AI service, which isn’t set up on this installation yet.', 503, 'ai_not_configured');
}

/**
 * @param onProgress  optional ({stage:'parsing'|'ideas'|'checking', drafted?}) => void — real
 *                    pipeline events only (drafted = ideas the model has finished writing so far).
 * @returns {{status:'ok'|'unrecognized'|'empty'|'no_ideas', ideas:[], message?, parsed?, notes?, request?}}
 */
export async function generateIdeas(request, inventory, { onProgress } = {}) {
  const req = { currency: 'GEL', quantity: 3, tools: [], skills: [], categories: [], ...request };
  const text = (req.freeText || '').trim();
  const pre = precheckText(text);
  if (!pre.ok) return unrecognized(text, 'It contains no words.');
  if (!aiEnabled()) throw unavailable();

  let parsed = null;
  let adHoc = [];
  if (text) {
    onProgress?.({ stage: 'parsing' });
    parsed = await aiParseFreeText(text);
    const invented = parsed.materials.filter((m) => !mentioned(text, m.name));
    if (invented.length) console.warn(`[ideas] dropped materials the text never mentions: ${invented.map((m) => m.name).join(', ')}`);
    parsed = { ...parsed, materials: parsed.materials.filter((m) => mentioned(text, m.name)).map((m) => (m.quantityStated && !amountStated(text, m.name) ? { ...m, quantityStated: false } : m)) };
    // The user's text is what they asked about: if it names nothing, stop here —
    // never fall back to saved inventory or generic products.
    if (!parsed.recognized || (!parsed.materials.length && !parsed.tools.length)) return unrecognized(text, parsed.unrecognizedReason);
    adHoc = parsed.materials
      .filter((m) => !inventory.some((i) => i.name.toLowerCase() === m.name.toLowerCase()))
      // "Fabric scraps" with no amount still means they own some: keep a nominal 1 flagged as
      // unknown, so the allocator asks them to confirm the amount instead of buying it.
      .map((m, i) => {
        const unknown = m.quantityStated === false || !(m.quantity > 0);
        // Sizes the person typed ("1000 x 150 x 18 mm") count as user-confirmed; only when the text really contains them.
        const s = m.size && sizeStated(text) ? m.size : null;
        const dims = s && (s.length > 0 || s.width > 0 || s.thickness > 0) ? { length: s.length > 0 ? s.length : null, width: s.width > 0 ? s.width : null, thickness: s.thickness > 0 ? s.thickness : null, unit: 'mm', status: 'user_confirmed' } : null;
        const { size, ...rest } = m;
        return { ...rest, quantity: unknown ? 1 : m.quantity, quantityUnknown: unknown, id: `text-${i}`, source: 'free_text', dimensions: dims };
      });
    req.textMaterials = adHoc.map(({ id, source, ...m }) => m);
    req.tools = [...new Set([...(req.tools || []), ...parsed.tools])];
    req.skills = [...new Set([...(req.skills || []), ...parsed.skills])];
    if (req.budget == null && parsed.budget != null) req.budget = parsed.budget;
    if (req.hoursPerWeek == null && parsed.hoursPerWeek != null) req.hoursPerWeek = parsed.hoursPerWeek;
  }
  const pool = [...inventory, ...adHoc];
  req.userTools = userToolList(req, pool);
  if (!pool.length) {
    return { status: 'empty', ideas: [], parsed, message: 'Tell us which materials you have — type them, pick them from your inventory, or scan them.' };
  }

  const onDrafted = onProgress && ((drafted) => onProgress({ stage: 'ideas', drafted }));
  onProgress?.({ stage: 'ideas', drafted: 0 });
  let result = await aiIdeas(req, pool, { onDrafted });
  // Small local models sometimes give up when details are missing. Ask once more,
  // explicitly; if it still finds nothing, that answer is reported as-is.
  if (!result.ideas.some((i) => i.name?.trim())) {
    result = await aiIdeas(req, pool, { onDrafted, nudge: 'Your previous answer proposed no products. Missing quantities, sizes or skill level are not a reason to stop: assume small quantities and beginner hand skills and propose what these materials and tools CAN make. Return no ideas only if no product at all is possible.' });
  }
  onProgress?.({ stage: 'checking' });
  const testBatch = testBatchFor(req);
  // Small local models sometimes repeat an idea ("Soy Wax Candle (2nd)"); a repeat is padding, not a new option.
  // Judged first, de-duplicated after: an unrealistic idea is reported with its reason even when
  // its name resembles a realistic one.
  let ungrounded = 0;
  const grounded = result.ideas.filter((i) => i.name?.trim()).map((i) => groundIdea(i, pool, testBatch, req));
  const rejected = grounded.filter((i) => i?.rejected).map(({ name, reason }) => ({ name, reason }));
  const seen = [];
  const isRepeat = (i) => {
    const key = i.name.toLowerCase().replace(/\(.*?\)|\b(2nd|second|another|v\d)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // Same name, or a near-identical name for the same kind of product ("pen holder" / "pencil holder").
    if (seen.some((s) => s.key === key || (s.kind === i.kind && nameSimilarity(s.key, key) >= 0.66))) return true;
    seen.push({ key, kind: i.kind });
    return false;
  };
  // Variety: at most two ideas of the same kind of product (a third "shelf" is not a new choice).
  const perKind = {};
  const ideas = grounded
    .filter((i) => i || !++ungrounded)
    .filter((i) => !i.rejected)
    .filter((i) => !isRepeat(i))
    .filter((i) => (perKind[i.kind] = (perKind[i.kind] || 0) + 1) <= 2)
    .map((i) => finaliseIdea(i, req))
    .sort(rankIdeas);
  if (ungrounded) console.warn(`[ideas] dropped ${ungrounded} idea(s) that used nothing from the inventory`);
  if (rejected.length) console.warn(`[ideas] rejected as physically unrealistic: ${rejected.map((r) => `${r.name} (${r.reason})`).join('; ')}`);
  if (!ideas.length) {
    return {
      status: 'no_ideas',
      ideas: [],
      parsed,
      rejected,
      message: rejected.length || ungrounded
        ? 'None of the AI’s suggestions hold up for these materials, so none are shown. Tell us more — amounts, sizes, and the tools you have — and try again.'
        : result.notes || 'We couldn’t find a product these materials can realistically make. Add more materials or tools and try again.',
    };
  }
  return { status: 'ok', ideas, engine: 'ai', parsed, notes: result.notes, dropped: ungrounded, rejected, request: req, pool: pool.map((p) => ({ name: p.name, quantity: p.quantity, unit: p.unit })) };
}

export async function generatePlan(project, inventory, currency, { region, research: existingResearch, withResearch = false } = {}) {
  const engine = project.idea?.engine === 'demo' ? 'demo' : 'ai';
  let plan;
  let research = existingResearch || null;
  if (engine === 'demo') {
    plan = demoPlan(project, inventory, currency);
    if (!plan) throw Object.assign(new Error('This example design could not be found.'), { status: 404 });
  } else {
    if (!aiEnabled()) throw unavailable();
    if (!research && !withResearch) {
      // Web research costs several extra model calls plus page downloads, so it only runs when asked.
      research = { limited: true, skipped: true, sources: [], summary: '', limitationNote: 'No web research was run for this plan — it is the AI’s own proposal. Use “Find build guides” to compare it with real guides.', retrievedAt: new Date().toISOString() };
    }
    if (!research) {
      // Research the chosen product before planning; a research failure is reported, not hidden.
      try {
        research = await researchProduct(project, inventory, region);
      } catch (err) {
        research = { limited: true, sources: [], summary: '', limitationNote: `Web research failed (${err.message}). The plan below is the AI’s own proposal.`, retrievedAt: new Date().toISOString() };
      }
    }
    plan = await aiPlan(project, inventory, currency, research);
  }
  const usedNames = new Set(plan.components.map((c) => c.fromInventory).filter(Boolean).map((n) => n.toLowerCase()));
  const usedItems = inventory.filter((i) => usedNames.has(i.name.toLowerCase()));
  const unconfirmed = usedItems.filter((i) => !['user_confirmed', 'verified'].includes(i.dimensions?.status));
  const needsMeasure = plan.assumptions.filter((a) => a.needsMeasurement);
  plan.dimensionsValidated = unconfirmed.length === 0 && needsMeasure.length === 0;
  const sizeIssues = [...cutCheck(plan, inventory), ...cuttingToolCheck(plan, project, inventory)];
  if (sizeIssues.length) plan.dimensionsValidated = false;
  plan.sizeIssues = sizeIssues;
  plan.validationNotes = [
    ...sizeIssues,
    ...unconfirmed.map((i) => `"${i.name}" ${i.dimensions ? `sizes are ${DIMENSION_STATUS[i.dimensions.status]?.label?.toLowerCase() || 'unconfirmed'}` : 'has no measurements yet'}.`),
    ...needsMeasure.map((a) => a.text),
  ];
  delete plan.requirements;
  plan.research = research;
  plan.engine = engine;
  plan.generatedAt = new Date().toISOString();
  plan.steps = plan.steps.map((s, i) => ({ ...s, id: `s${i + 1}`, n: i + 1 }));
  plan.overall = { ...plan.overall, length: roundTo(plan.overall.length, 1), width: roundTo(plan.overall.width, 1), height: roundTo(plan.overall.height, 1) };
  return plan;
}
