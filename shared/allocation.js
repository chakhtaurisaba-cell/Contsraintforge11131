// Reuse-first material allocation. Deterministic: given a design's bill of
// materials, the user's inventory and a batch size, decide for every component
// whether it is already owned, owned-but-needs-adapting, covered by a safe
// substitute, short, a genuine purchase, or an optional upgrade — and compute
// the exact shortage. Purchases are only ever the remainder after reuse.
import { MATERIALS, TOOLS, matchesKey, keyFor, nameSimilarity, hasTool } from './lexicon.js';

export const STATUS = {
  available: { label: 'You have it', tone: 'ok', rank: 0 },
  available_with_adaptation: { label: 'You have it — needs cutting/adjusting', tone: 'ok', rank: 1 },
  substitutable: { label: 'Use substitute', tone: 'info', rank: 2 },
  insufficient: { label: 'Need more', tone: 'warn', rank: 3 },
  required_purchase: { label: 'Missing', tone: 'danger', rank: 4 },
  optional_upgrade: { label: 'Optional', tone: '', rank: 5 },
};

const COUNT_UNITS = new Set(['', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'board', 'boards', 'plank', 'planks', 'jar', 'jars', 'set', 'sets', 'sheet', 'sheets', 'stick', 'sticks', 'bottle', 'bottles', 'spool', 'spools', 'roll', 'rolls', 'item', 'items', 'x']);
const LENGTH = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
const MASS = { g: 0.001, kg: 1 };
const VOLUME = { ml: 0.001, l: 1 };
const norm = (u) => String(u || '').trim().toLowerCase().replace(/\.$/, '');
// Any unit that is not a length, mass or volume counts pieces ("screw", "wicks", "container").
const isCountLike = (u) => COUNT_UNITS.has(u) || (LENGTH[u] == null && MASS[u] == null && VOLUME[u] == null);

/** Convert qty from one unit to another; null when the units are not comparable. */
export function convertQty(qty, from, to) {
  const a = norm(from);
  const b = norm(to);
  if (a === b) return qty;
  if (isCountLike(a) && isCountLike(b)) return qty;
  for (const table of [LENGTH, MASS, VOLUME]) {
    if (table[a] != null && table[b] != null) return (qty * table[a]) / table[b];
  }
  return null;
}
const isCount = (u) => COUNT_UNITS.has(norm(u));
const r2 = (v) => Math.round(v * 100) / 100;
const roundNeed = (v, unit) => (isCount(unit) ? Math.ceil(v - 1e-9) : r2(v));

function candidatesFor(line, inventory) {
  if (line.inventoryId) {
    const exact = inventory.find((i) => i.id === line.inventoryId);
    if (exact) return [exact];
  }
  const key = line.matchKey || keyFor(`${line.name} ${line.material || ''}`);
  const byKey = key ? inventory.filter((i) => matchesKey(i, key)) : [];
  const byName = inventory.filter((i) => !byKey.includes(i) && nameSimilarity(i.name, line.name) >= 0.6);
  return [...byKey, ...byName];
}

function substituteCandidates(sub, inventory) {
  if (sub.key && MATERIALS[sub.key]) return inventory.filter((i) => matchesKey(i, sub.key));
  if (sub.keywords?.length) {
    const kw = sub.keywords.map((k) => k.toLowerCase());
    return inventory.filter((i) => kw.some((k) => `${i.name} ${i.material || ''}`.toLowerCase().includes(k)));
  }
  return [];
}

/**
 * @param bom        [{name, quantity (per unit), unit, matchKey?, inventoryId?, optional?, essential?, substitutes?, adaptation?, whyNeeded?, unitPrice, spec}]
 * @param inventory  [{id, name, material, category, quantity, unit}]
 * @param batchQty   units to build
 * @param reserved   {inventoryId: quantity already committed to other active projects}
 */
export function allocate(bom = [], inventory = [], batchQty = 1, reserved = {}) {
  const batch = Math.max(1, Math.round(Number(batchQty) || 1));
  const remaining = new Map(inventory.map((i) => [i.id, Math.max(0, Number(i.quantity || 0) - Number(reserved[i.id] || 0))]));
  const lines = [];

  // Essential lines first (so optional extras never consume stock a real part needs).
  const order = bom.map((l, i) => ({ l, i })).sort((a, b) => Number(Boolean(a.l.optional)) - Number(Boolean(b.l.optional)));

  for (const { l: line, i: index } of order) {
    const unitNeed = Number(line.quantity) || 0;
    const needTotal = roundNeed(unitNeed * batch, line.unit);
    const base = { index, name: line.name, unit: line.unit, unitNeed, needTotal, sources: [], shortage: 0, purchaseQty: 0, note: '', needsConfirmation: false, optional: Boolean(line.optional), whyNeeded: line.whyNeeded || line.role || '' };

    // Optional upgrades stay out of the plan unless the user explicitly includes them.
    if (line.optional && !line.included) {
      const owned = candidatesFor(line, inventory).length > 0;
      lines.push({ ...base, status: 'optional_upgrade', ownedFraction: owned ? 1 : 0, note: owned ? 'You have this — use it if you like.' : line.whyNeeded || 'Improves finish or convenience; not needed to build.' });
      continue;
    }
    base.optional = false;
    base.upgrade = Boolean(line.optional);
    // The user told us they have it (e.g. not yet entered in the inventory).
    if (line.ownedOverride) {
      lines.push({ ...base, status: 'available', ownedFraction: 1, ownedCovered: needTotal, maxUnits: null, sources: [{ itemId: null, name: 'Marked as owned by you', qty: needTotal, unit: line.unit, itemQty: 0, kind: 'manual' }], note: 'You marked this as already owned.' });
      continue;
    }

    let left = needTotal;
    const take = (item, kind, note, ratio = 1) => {
      if (left <= 0) return;
      const have = remaining.get(item.id) ?? 0;
      if (have <= 0) return;
      // ratio = substitute units consumed per unit of the original component (e.g. 0.005 bottle of glue per screw).
      const conv = item.quantityUnknown ? null : convertQty(have, item.unit, line.unit);
      const haveInLineUnits = conv == null ? null : conv / ratio;
      if (haveInLineUnits == null) {
        // Units not comparable (e.g. "1 roll" vs "6 m"): assume it covers the need but ask the user to confirm.
        base.needsConfirmation = true;
        base.note = item.quantityUnknown
          ? `Confirm you have at least ${needTotal} ${line.unit} of "${item.name}" — you didn't say how many.`
          : `Check "${item.name}" is enough: need ${needTotal} ${line.unit}, inventory counts it in ${item.unit}.`;
        base.sources.push({ itemId: item.id, name: item.name, qty: needTotal, unit: line.unit, itemQty: have, kind, note });
        remaining.set(item.id, 0);
        left = 0;
        return;
      }
      const used = Math.min(haveInLineUnits, left);
      const usedInItemUnits = convertQty(used * ratio, line.unit, item.unit);
      remaining.set(item.id, r2(have - usedInItemUnits));
      left = roundNeed(left - used, line.unit);
      base.sources.push({ itemId: item.id, name: item.name, qty: r2(ratio === 1 ? used : usedInItemUnits), unit: ratio === 1 ? line.unit : item.unit, itemQty: r2(usedInItemUnits), kind, note });
    };

    for (const item of candidatesFor(line, inventory)) take(item, 'owned');
    const ownedCovered = needTotal - left;
    if (left > 0) {
      for (const sub of line.substitutes || []) {
        for (const item of substituteCandidates(sub, inventory)) take(item, 'substitute', sub.note, sub.ratio || 1);
      }
    }
    const covered = needTotal - left;
    const usedSubstitute = base.sources.some((s) => s.kind === 'substitute');
    let status;
    if (left <= 0) status = usedSubstitute ? 'substitutable' : line.adaptation ? 'available_with_adaptation' : 'available';
    else if (covered > 0) status = 'insufficient';
    else status = 'required_purchase';

    const shortage = left > 0 ? roundNeed(left, line.unit) : 0;
    const perUnitStock = unitNeed > 0 ? Math.floor((covered + 1e-9) / unitNeed) : null;
    let note = base.note;
    if (status === 'substitutable') note = base.sources.filter((s) => s.kind === 'substitute').map((s) => `Use your "${s.name}"${s.note ? ` — ${s.note}` : ''}.`).join(' ');
    if (status === 'available_with_adaptation') note = line.adaptation;
    if (status === 'insufficient') note = `You have enough for ${perUnitStock} of ${batch} unit(s); short by ${shortage} ${line.unit}.`;
    if (status === 'required_purchase') note = line.whyNeeded ? `Needed because: ${line.whyNeeded}` : 'Nothing in your inventory can do this job.';
    lines.push({ ...base, status, ownedFraction: needTotal > 0 ? Math.min(1, covered / needTotal) : 1, ownedCovered: r2(ownedCovered), shortage, purchaseQty: shortage, maxUnits: perUnitStock, note });
  }
  lines.sort((a, b) => a.index - b.index);

  const essential = lines.filter((l) => !l.optional);
  const blockers = essential.filter((l) => l.status === 'required_purchase');
  const maxUnitsFromStock = blockers.length ? 0 : essential.reduce((m, l) => (l.maxUnits == null ? m : Math.min(m, l.maxUnits)), Infinity);
  const purchases = essential
    .filter((l) => l.purchaseQty > 0)
    .map((l) => {
      const src = bom[l.index];
      return {
        lineIndex: l.index,
        name: src.name,
        spec: src.spec || '',
        quantity: l.purchaseQty,
        unit: l.unit,
        unitPrice: Number(src.unitPrice) || 0,
        reason: l.status === 'insufficient' ? `Shortage: you have ${r2(l.needTotal - l.shortage)} of ${l.needTotal} ${l.unit} needed for ${batch} unit(s).` : l.note,
      };
    });
  return {
    batchQty: batch,
    lines,
    purchases,
    optional: lines.filter((l) => l.optional),
    everythingOwned: purchases.length === 0,
    maxUnitsFromStock: Number.isFinite(maxUnitsFromStock) ? maxUnitsFromStock : null,
    // Smaller batch that needs no purchases at all (only when every essential part is in stock for ≥1 unit).
    reduceBatchTo: !blockers.length && Number.isFinite(maxUnitsFromStock) && maxUnitsFromStock >= 1 && maxUnitsFromStock < batch ? maxUnitsFromStock : null,
    needsConfirmation: lines.filter((l) => l.needsConfirmation).map((l) => l.note),
  };
}

/** BOM copy carrying each line's owned fraction (for cash-vs-owned economics) and excluding optional upgrades. */
export function bomWithAllocation(bom = [], allocation) {
  if (!allocation) return bom;
  return bom.map((line, i) => {
    const a = allocation.lines.find((l) => l.index === i);
    return a ? { ...line, owned: a.ownedFraction >= 1, ownedFraction: a.ownedFraction, optional: Boolean(line.optional) } : line;
  });
}

/** Which required tools the user has (tool list + tool-like inventory items). */
export function toolCheck(required = [], userTools = [], inventory = []) {
  const all = [...userTools, ...inventory.map((i) => i.name)];
  return required.map((name) => {
    const key = Object.keys(TOOLS).find((k) => TOOLS[k].match.some((m) => name.toLowerCase().includes(m)) || TOOLS[k].label === name);
    const have = key ? hasTool(all, key) : all.some((t) => nameSimilarity(t, name) >= 0.6);
    return { name, have };
  });
}
