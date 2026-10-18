import { all, get, parseJSON } from '../db.js';
import { computeEconomics, DEFAULT_ECONOMICS } from '../../shared/economics.js';
import { allocate, bomWithAllocation } from '../../shared/allocation.js';

export function hydrateProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isExample: Boolean(row.is_example),
    idea: parseJSON(row.idea, null),
    plan: parseJSON(row.plan, null),
    economics: { ...DEFAULT_ECONOMICS, ...parseJSON(row.economics, {}) },
    strategy: parseJSON(row.strategy, null),
    progress: parseJSON(row.progress, { completedSteps: [], stepNotes: {} }),
    notes: parseJSON(row.notes, []),
    unitsProduced: row.units_produced,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const getProject = (id) => hydrateProject(get('SELECT * FROM projects WHERE id = ?', id));
export const listProjects = () => all('SELECT * FROM projects ORDER BY updated_at DESC').map(hydrateProject);

/* ---------------- reuse-first allocation against live inventory ---------------- */

// Projects whose material needs are committed (they hold stock other projects should not count on).
const COMMITTED = new Set(['materials_needed', 'ready_to_build', 'in_production']);

export const inventoryForAllocation = () =>
  all('SELECT id, name, material, category, quantity, unit, dimensions FROM inventory_items').map((r) => ({ ...r, dimensions: parseJSON(r.dimensions, null) }));

/** Items already bought for this project count as its stock. */
const purchasedStock = (projectId) =>
  all('SELECT id, name, quantity, unit FROM purchases WHERE project_id = ? AND purchased = 1', projectId).map((p) => ({ id: `purchase:${p.id}`, name: p.name, material: '', category: 'purchased', quantity: p.quantity, unit: p.unit, purchased: true }));

/** Stock held by OTHER committed projects (prevents double-counting the same boards in two plans). */
export function reservationsExcluding(projectId, inventory) {
  const reserved = {};
  const holders = {};
  for (const p of listProjects()) {
    if (p.id === projectId || p.isExample || !p.plan?.bom || !COMMITTED.has(p.status)) continue;
    const a = allocate(p.plan.bom, inventory, p.economics.batchQty);
    for (const l of a.lines) {
      for (const s of l.sources) {
        if (String(s.itemId).startsWith('purchase:')) continue;
        reserved[s.itemId] = (reserved[s.itemId] || 0) + (s.itemQty || 0);
        (holders[s.itemId] ||= new Set()).add(p.name);
      }
    }
  }
  return { reserved, holders: Object.fromEntries(Object.entries(holders).map(([k, v]) => [k, [...v]])) };
}

/** Inputs the allocator needs — also sent to the browser so it can re-allocate live (e.g. batch size edits). */
export function allocationInputs(project) {
  // Example projects run on simulated data and never touch the user's real inventory.
  const inventory = project.isExample ? [] : inventoryForAllocation();
  const { reserved, holders } = project.isExample ? { reserved: {}, holders: {} } : reservationsExcluding(project.id, inventory);
  return { inventory: [...inventory, ...purchasedStock(project.id)], reserved, reservedBy: holders };
}

export function projectAllocation(project, inputs = allocationInputs(project), batchQty = project.economics.batchQty) {
  if (!project.plan?.bom) return null;
  return allocate(project.plan.bom, inputs.inventory, batchQty, inputs.reserved);
}

export function projectEconomics(project, allocation = projectAllocation(project)) {
  return computeEconomics(bomWithAllocation(project.plan?.bom || [], allocation), project.economics);
}

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const s = { region: 'GE', currency: 'GEL', businessName: '', laborRatePerHour: 0, includeExamples: true, deliveryOptions: ['pickup', 'courier'], marketingHoursPerWeek: 3, audienceSize: 0 };
  for (const r of rows) s[r.key] = parseJSON(r.value, r.value);
  return s;
}
