import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, now, uid, parseJSON, logActivity, transaction } from '../db.js';
import { validate } from '../middleware.js';
import { config, shopifyConfigured } from '../config.js';
import { aiEnabled, aiStatus, probeAI } from '../ai/client.js';
import { getSettings, listProjects, projectEconomics } from '../services/projects.js';
import { computeAnalytics } from '../services/analytics.js';
import { listRecommendations } from '../services/advisor.js';
import { loadExamples, removeExamples } from '../services/examples.js';

export const core = Router();

core.get('/health', async (_req, res) => {
  // Re-check Ollama when it was down or the model was missing, so starting Ollama or
  // pulling the model later is picked up without restarting this server.
  if (['unreachable', 'model_unavailable', 'error', 'unchecked', 'out_of_memory'].includes(aiStatus().state)) await probeAI();
  // ai.status is safe to expose: it names the env var / model to fix, never a secret.
  // storage.temporary: on Vercel the SQLite file lives in /tmp and can disappear (see README).
  res.json({ ok: true, ai: { enabled: aiEnabled(), model: aiEnabled() ? config.ai.model : null, status: aiStatus() }, storage: { temporary: config.dbIsTemporary }, shopify: { configured: shopifyConfigured() } });
});

/* ---------- settings ---------- */
core.get('/settings', (_req, res) => res.json(getSettings()));

const SettingsBody = z.object({
  region: z.string().max(8).optional(),
  currency: z.string().length(3).optional(),
  businessName: z.string().max(120).optional(),
  laborRatePerHour: z.number().min(0).max(100000).optional(),
  includeExamples: z.boolean().optional(),
  deliveryOptions: z.array(z.enum(['pickup', 'courier', 'post'])).optional(),
  marketingHoursPerWeek: z.number().min(0).max(100).optional(),
  audienceSize: z.number().min(0).max(1e9).optional(),
});
core.put('/settings', validate(SettingsBody), (req, res) => {
  transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
    }
  });
  res.json(getSettings());
});

/* ---------- inventory ---------- */
const Dimensions = z
  .object({
    length: z.number().positive().nullable().optional(),
    width: z.number().positive().nullable().optional(),
    height: z.number().positive().nullable().optional(),
    diameter: z.number().positive().nullable().optional(),
    thickness: z.number().positive().nullable().optional(),
    unit: z.enum(['mm', 'cm', 'm', 'in', 'ft']).default('mm'),
    status: z.enum(['ai_inferred', 'from_marking', 'reference_calibrated', 'user_confirmed', 'verified']).default('user_confirmed'),
    uncertaintyPct: z.number().min(0).max(100).nullable().optional(),
    method: z.string().max(200).nullable().optional(),
  })
  .nullable()
  .optional();

const ItemBody = z.object({
  // Must contain real letters (any language) — rejects junk like "q" or "1234".
  name: z.string().trim().min(2).max(120).refine((v) => /\p{L}.*\p{L}/u.test(v), { message: 'Enter a real item name' }),
  material: z.string().max(80).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  quantity: z.number().min(0).max(1e6).default(1),
  unit: z.string().trim().max(20).regex(/^[\p{L}²³ ./]*\d?$/u, 'Use a unit like pcs, m, kg').default('pcs'),
  dimensions: Dimensions,
  condition: z.string().max(200).nullable().optional(),
  potentialUses: z.array(z.string().max(120)).max(20).optional(),
  notes: z.string().max(1000).nullable().optional(),
  unitValue: z.number().min(0).max(1e7).nullable().optional(),
  source: z.enum(['user', 'ai_scan']).default('user'),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const hydrateItem = (r) => ({
  id: r.id, name: r.name, material: r.material, category: r.category, quantity: r.quantity, unit: r.unit,
  dimensions: parseJSON(r.dimensions, null), condition: r.condition, potentialUses: parseJSON(r.potential_uses, []),
  notes: r.notes, unitValue: r.unit_value, source: r.source, confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at,
});
export const listInventory = () => all('SELECT * FROM inventory_items ORDER BY created_at DESC').map(hydrateItem);
/** Shape used by the engines (snake_case unit_value preserved). */
export const inventoryForEngines = () => all('SELECT * FROM inventory_items').map((r) => ({ ...hydrateItem(r), unit_value: r.unit_value }));

export function insertItem(b) {
  const id = uid();
  const t = now();
  run(
    'INSERT INTO inventory_items (id, name, material, category, quantity, unit, dimensions, condition, potential_uses, notes, unit_value, source, confidence, confirmed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
    id, b.name, b.material ?? null, b.category ?? null, b.quantity, b.unit, b.dimensions ? JSON.stringify(b.dimensions) : null, b.condition ?? null,
    JSON.stringify(b.potentialUses || []), b.notes ?? null, b.unitValue ?? null, b.source, b.confidence ?? null, t, t
  );
  return id;
}

core.get('/inventory', (_req, res) => res.json(listInventory()));
core.post('/inventory', validate(ItemBody), (req, res) => {
  const id = insertItem(req.body);
  logActivity('inventory', `Added "${req.body.name}" to inventory`);
  res.status(201).json(hydrateItem(get('SELECT * FROM inventory_items WHERE id = ?', id)));
});
// How trustworthy a dimension source is — a merge never replaces better dimensions with worse ones.
const DIM_RANK = { ai_inferred: 1, from_marking: 2, reference_calibrated: 3, user_confirmed: 4, verified: 5 };

/**
 * Saves confirmed scan results. A new scan never silently replaces existing inventory:
 * each item is either added as new, or merged into an existing item the user chose
 * (quantities add up; dimensions are upgraded only if the new source is more reliable).
 */
core.post('/inventory/bulk', validate(z.object({ items: z.array(ItemBody.extend({ mergeIntoId: z.string().nullable().optional() })).min(1).max(100) })), (req, res) => {
  let added = 0;
  let merged = 0;
  transaction(() => {
    for (const item of req.body.items) {
      const target = item.mergeIntoId ? get('SELECT * FROM inventory_items WHERE id = ?', item.mergeIntoId) : null;
      if (!target) {
        insertItem(item);
        added += 1;
        continue;
      }
      const oldDims = parseJSON(target.dimensions, null);
      const better = item.dimensions && (DIM_RANK[item.dimensions.status] || 0) > (DIM_RANK[oldDims?.status] || 0);
      const sameUnit = (target.unit || 'pcs') === (item.unit || 'pcs');
      run(
        'UPDATE inventory_items SET quantity = ?, dimensions = ?, notes = ?, updated_at = ? WHERE id = ?',
        sameUnit ? Number(target.quantity) + Number(item.quantity) : target.quantity,
        better ? JSON.stringify(item.dimensions) : target.dimensions,
        [target.notes, sameUnit ? null : `Scan found ${item.quantity} ${item.unit} more — units differ, quantity not added.`].filter(Boolean).join(' · ') || null,
        now(),
        target.id
      );
      merged += 1;
    }
  });
  logActivity('inventory', `Saved scan: ${added} new item(s), ${merged} merged into existing`);
  res.status(201).json(listInventory());
});
core.put('/inventory/:id', validate(ItemBody), (req, res) => {
  const b = req.body;
  const r = run(
    'UPDATE inventory_items SET name=?, material=?, category=?, quantity=?, unit=?, dimensions=?, condition=?, potential_uses=?, notes=?, unit_value=?, updated_at=? WHERE id=?',
    b.name, b.material ?? null, b.category ?? null, b.quantity, b.unit, b.dimensions ? JSON.stringify(b.dimensions) : null, b.condition ?? null, JSON.stringify(b.potentialUses || []), b.notes ?? null, b.unitValue ?? null, now(), req.params.id
  );
  if (!r.changes) return res.status(404).json({ error: 'Item not found' });
  res.json(hydrateItem(get('SELECT * FROM inventory_items WHERE id = ?', req.params.id)));
});
core.delete('/inventory/:id', (req, res) => {
  run('DELETE FROM inventory_items WHERE id = ?', req.params.id);
  res.status(204).end();
});

/* ---------- dashboard ---------- */
core.get('/dashboard', (_req, res) => {
  const settings = getSettings();
  const includeExamples = settings.includeExamples !== false;
  const projects = listProjects();
  const real = projects.filter((p) => !p.isExample);
  const scope = includeExamples ? projects : real;
  const analytics = computeAnalytics({ includeExamples });
  const materialCash = scope.reduce((s, p) => s + (p.plan ? projectEconomics(p).batch.cashOutlay : 0), 0);
  const estProductionCost = scope.reduce((s, p) => s + (p.plan ? projectEconomics(p).perUnit.productionCost * (p.unitsProduced || 0) : 0), 0);
  const purchases = all('SELECT p.*, pr.is_example FROM purchases p JOIN projects pr ON pr.id = p.project_id');
  const spent = purchases.filter((p) => p.purchased && (includeExamples || !p.is_example)).reduce((s, p) => s + (p.actual_cost ?? (p.est_unit_price || 0) * p.quantity), 0);
  const recs = listRecommendations().recommendations.filter((r) => r.status === 'proposed' && (includeExamples || !r.isExample));
  res.json({
    settings,
    hasExamples: projects.some((p) => p.isExample),
    counts: {
      projects: scope.length,
      active: scope.filter((p) => !['archived', 'idea'].includes(p.status)).length,
      inventoryItems: get('SELECT COUNT(*) AS c FROM inventory_items').c,
    },
    money: {
      plannedBatchCash: Math.round(materialCash * 100) / 100,
      estProductionCost: Math.round(estProductionCost * 100) / 100,
      materialsPurchased: Math.round(spent * 100) / 100,
    },
    totals: analytics.totals,
    timeline: analytics.timeline,
    inventory: analytics.inventory.filter((i) => includeExamples || !i.isExample),
    conversionAvailable: analytics.conversion.some((c) => c.conversionPct != null),
    conversion: analytics.conversion,
    projects: scope.slice(0, 6).map((p) => ({ id: p.id, name: p.name, status: p.status, isExample: p.isExample, updatedAt: p.updatedAt, progress: p.plan ? Math.round(((p.progress?.completedSteps?.length || 0) / p.plan.steps.length) * 100) : 0, visualShape: p.idea?.visualShape, visualKind: p.idea?.visualKind })),
    recommendations: recs.slice(0, 3),
    activity: all('SELECT * FROM activity ORDER BY created_at DESC LIMIT 12'),
  });
});

/* ---------- examples ---------- */
core.post('/examples', async (_req, res) => res.json(await loadExamples(getSettings().currency)));
core.delete('/examples', (_req, res) => res.json(removeExamples()));
