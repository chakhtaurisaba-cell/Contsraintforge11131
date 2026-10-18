import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, now, uid, parseJSON, logActivity, transaction } from '../db.js';
import { validate, rateLimit } from '../middleware.js';
import { getProject, listProjects, projectEconomics, getSettings, allocationInputs, projectAllocation } from '../services/projects.js';
import { generateIdeas, generatePlan } from '../services/ideation.js';
import { researchCandidates, researchProduct } from '../services/research.js';
import { toolCheck } from '../../shared/allocation.js';
import { recommendChannels } from '../services/channels.js';
import { generateSellGuide } from '../services/sell.js';
import { searchSuppliers } from '../services/sourcing.js';
import { projectMetrics } from '../services/advisor.js';
import { inventoryForEngines, insertItem } from './core.js';
import { compareOptions, searchLinks } from '../../shared/sourcing.js';
import { PROJECT_STATUSES, statusLabel } from '../../shared/constants.js';

export const projects = Router();
const aiLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 40 });

/* ---------- ideation ---------- */
const IdeaRequest = z.object({
  inventoryIds: z.array(z.string()).max(200).optional(),
  freeText: z.string().max(4000).optional(),
  tools: z.array(z.string().max(80)).max(50).optional(),
  skills: z.array(z.string().max(80)).max(30).optional(),
  budget: z.number().min(0).max(1e8).nullable().optional(),
  currency: z.string().length(3).optional(),
  hoursPerWeek: z.number().min(0).max(168).nullable().optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  customerType: z.string().max(200).optional(),
  region: z.string().max(40).optional(),
  categories: z.array(z.string().max(60)).max(20).optional(),
  spaceLimits: z.string().max(300).optional(),
  goal: z.enum(['diy', 'commercial', 'scalable']).optional(),
  targetMarginPct: z.number().min(0).max(95).nullable().optional(),
});

projects.post('/ideas', aiLimit, validate(IdeaRequest), async (req, res) => {
  const settings = getSettings();
  const inv = inventoryForEngines();
  const selected = req.body.inventoryIds ? inv.filter((i) => req.body.inventoryIds.includes(i.id)) : inv;
  const request = { currency: settings.currency, region: settings.region, ...req.body };
  const finish = (result) => {
    // Only real results are stored; "unrecognized"/"empty" answers are returned as-is.
    if (result.status !== 'ok') return result;
    const runId = uid();
    run('INSERT INTO idea_runs (id, request, ideas, engine, created_at) VALUES (?,?,?,?,?)', runId, JSON.stringify({ ...result.request, pool: result.pool }), JSON.stringify(result.ideas), result.engine, now());
    return { ...result, runId };
  };
  if (!String(req.headers.accept || '').includes('application/x-ndjson')) return res.json(finish(await generateIdeas(request, selected)));

  // Streaming mode: one JSON line per real pipeline event, then the result (or the error).
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  try {
    const result = await generateIdeas(request, selected, { onProgress: (p) => send({ type: 'progress', ...p }) });
    send({ type: 'result', data: finish(result) });
  } catch (err) {
    if (!err.status) console.error('[error]', err);
    send({ type: 'error', error: err.status ? err.message : 'Something went wrong on the server.', code: err.code, retryable: Boolean(err.retryable), status: err.status || 500 });
  }
  res.end();
});

/** Web research for the candidates of one ideas run (runs after the ideas are shown). */
projects.post('/ideas/:runId/research', aiLimit, async (req, res) => {
  const row = get('SELECT * FROM idea_runs WHERE id = ?', req.params.runId);
  if (!row) return res.status(404).json({ error: 'These ideas are no longer available. Generate them again.' });
  const ideas = parseJSON(row.ideas, []);
  const request = parseJSON(row.request, {});
  const research = await researchCandidates(ideas, request.pool || [], request.region);
  const updated = ideas.map((idea, i) => ({ ...idea, research: research.byIndex[i] ? { ...research.byIndex[i], retrievedAt: research.retrievedAt } : { sources: [], note: 'No relevant sources found.', retrievedAt: research.retrievedAt } }));
  run('UPDATE idea_runs SET ideas = ? WHERE id = ?', JSON.stringify(updated), row.id);
  res.json({ ideas: updated, searches: research.searches, dropped: research.dropped, error: research.error || null });
});

projects.get('/ideas/runs', (_req, res) => {
  res.json(all('SELECT * FROM idea_runs ORDER BY created_at DESC LIMIT 10').map((r) => ({ id: r.id, engine: r.engine, createdAt: r.created_at, request: parseJSON(r.request, {}), ideas: parseJSON(r.ideas, []) })));
});

/* ---------- projects ---------- */
projects.get('/projects', (_req, res) => {
  res.json(
    listProjects().map((p) => {
      const econ = p.plan ? projectEconomics(p) : null;
      return {
        id: p.id, name: p.name, status: p.status, isExample: p.isExample, updatedAt: p.updatedAt, createdAt: p.createdAt,
        visualShape: p.idea?.visualShape, visualKind: p.idea?.visualKind, summary: p.idea?.summary, category: p.idea?.category, hasPlan: Boolean(p.plan),
        progress: p.plan ? Math.round(((p.progress?.completedSteps?.length || 0) / p.plan.steps.length) * 100) : 0,
        netProfitPerUnit: econ?.perUnit.netProfit ?? null, netMarginPct: econ?.perUnit.netMarginPct ?? null, price: p.economics.price, unitsProduced: p.unitsProduced,
      };
    })
  );
});

projects.post('/projects', validate(z.object({ name: z.string().min(1).max(160).optional(), idea: z.record(z.string(), z.any()) })), (req, res) => {
  const id = uid();
  const t = now();
  const idea = req.body.idea;
  const name = req.body.name || idea.name || 'Untitled product';
  const price = Number(idea.priceLow && idea.priceHigh ? (idea.priceLow + idea.priceHigh) / 2 : idea.priceLow) || 0;
  // Materials the person only typed ("6 pine boards…") exist nowhere else: without saving them,
  // the plan, bill of materials and sourcing would treat them as missing and tell them to buy
  // what they own. Items already in the inventory (same name) are left as they are.
  const addedToInventory = [];
  const existing = new Set(all('SELECT name FROM inventory_items').map((r) => r.name.trim().toLowerCase()));
  for (const m of Array.isArray(idea.textMaterials) ? idea.textMaterials.slice(0, 50) : []) {
    const itemName = String(m?.name || '').trim().slice(0, 120);
    if (!/\p{L}.*\p{L}/u.test(itemName) || existing.has(itemName.toLowerCase())) continue;
    insertItem({
      name: itemName,
      material: m.material ? String(m.material).slice(0, 80) : null,
      quantity: Math.max(0, Math.min(1e6, Number(m.quantity) || 1)),
      unit: /^[\p{L}²³ ./]*\d?$/u.test(String(m.unit || '')) && String(m.unit || '').trim() ? String(m.unit).trim().slice(0, 20) : 'pcs',
      dimensions: m.dimensions || null,
      notes: m.quantityUnknown ? 'Added from your description — you didn’t say how many, so 1 is a placeholder. Please check.' : 'Added from your description.',
      source: 'user',
    });
    existing.add(itemName.toLowerCase());
    addedToInventory.push(itemName);
  }
  if (addedToInventory.length) logActivity('inventory', `Added ${addedToInventory.join(', ')} from your description`);
  run(
    'INSERT INTO projects (id, name, status, is_example, idea, economics, progress, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, name, 'feasibility', 0, JSON.stringify(idea), JSON.stringify({ price: Math.round(price * 100) / 100, laborRatePerHour: getSettings().laborRatePerHour || 0, batchQty: Math.max(1, Math.round(Number(idea.testBatch) || 3)) }), JSON.stringify({ completedSteps: [], stepNotes: {} }), '[]', t, t
  );
  logActivity('project', `Created project "${name}"`, id);
  res.status(201).json({ ...getProject(id), addedToInventory });
});

function projectDetail(p) {
  const inputs = allocationInputs(p);
  const allocation = projectAllocation(p, inputs);
  const econ = projectEconomics(p, allocation);
  const purchases = all('SELECT * FROM purchases WHERE project_id = ? ORDER BY created_at', p.id).map(hydratePurchase);
  const requiredTools = p.plan?.tools || p.idea?.toolsRequired || [];
  return {
    ...p,
    computed: {
      economics: econ,
      allocation,
      // Sent so the browser can re-run the same allocation live when the batch size changes.
      allocationInputs: inputs,
      tools: toolCheck(requiredTools, p.idea?.userTools || [], inputs.inventory),
      metrics: (() => {
        const m = projectMetrics(p);
        return { sold: m.sold, produced: m.produced, onHand: m.onHand, revenue: m.revenue, profit: m.profit, actualMarginPct: m.actualMarginPct, sold30: m.sold30 };
      })(),
    },
    purchases,
    production: all('SELECT * FROM production WHERE project_id = ? ORDER BY date DESC', p.id),
  };
}

projects.get('/projects/:id', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json(projectDetail(p));
});

const ProjectPatch = z.object({
  name: z.string().min(1).max(160).optional(),
  status: z.enum(PROJECT_STATUSES.map((s) => s.id)).optional(),
  economics: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  progress: z
    .object({
      completedSteps: z.array(z.string()).max(500),
      stepNotes: z.record(z.string(), z.string().max(2000)).optional(),
      currentStep: z.string().max(20).optional(),
      inspection: z.array(z.number().int()).max(100).optional(),
    })
    .optional(),
  addNote: z.string().min(1).max(4000).optional(),
  removeNoteId: z.string().optional(),
  bom: z.array(z.object({ name: z.string().max(160), quantity: z.number().min(0), unit: z.string().max(20), unitPrice: z.number().min(0), ownedOverride: z.boolean().optional(), included: z.boolean().optional(), priceSource: z.string().max(30).optional() }).passthrough()).max(200).optional(),
});

projects.patch('/projects/:id', validate(ProjectPatch), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const b = req.body;
  const sets = [];
  const vals = [];
  if (b.name) { sets.push('name = ?'); vals.push(b.name); }
  if (b.status && b.status !== p.status) {
    sets.push('status = ?'); vals.push(b.status);
    logActivity('status', `"${p.name}" moved to ${statusLabel(b.status)}`, p.id);
  }
  if (b.economics) { sets.push('economics = ?'); vals.push(JSON.stringify({ ...p.economics, ...b.economics })); }
  if (b.progress) { sets.push('progress = ?'); vals.push(JSON.stringify({ ...p.progress, ...b.progress })); }
  if (b.addNote || b.removeNoteId) {
    let notes = p.notes.filter((n) => n.id !== b.removeNoteId);
    if (b.addNote) notes = [{ id: uid(), text: b.addNote, created_at: now() }, ...notes];
    sets.push('notes = ?'); vals.push(JSON.stringify(notes));
  }
  if (b.bom && p.plan) {
    // User edits to prices/quantities; provenance becomes "user" for changed prices.
    const bom = b.bom.map((line, i) => ({ ...p.plan.bom[i], ...line }));
    sets.push('plan = ?'); vals.push(JSON.stringify({ ...p.plan, bom }));
  }
  if (sets.length) {
    sets.push('updated_at = ?'); vals.push(now());
    run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, ...vals, p.id);
  }
  // BOM or batch-size changes alter what must be bought.
  const updated = getProject(p.id);
  if (updated.plan && (b.bom || b.economics?.batchQty !== undefined || b.status)) syncPurchases(p.id, getSettings().currency);
  res.json(projectDetail(getProject(p.id)));
});

projects.delete('/projects/:id', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  run('DELETE FROM projects WHERE id = ?', p.id);
  logActivity('project', `Deleted project "${p.name}"`);
  res.status(204).end();
});

/* ---------- plan generation ---------- */
projects.post('/projects/:id/plan', aiLimit, async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const settings = getSettings();
  const plan = await generatePlan(p, inventoryForEngines(), settings.currency, { region: settings.region, research: req.body?.refreshResearch ? null : p.plan?.research || null, withResearch: Boolean(req.body?.withResearch || req.body?.refreshResearch) });
  const econ = {
    ...p.economics,
    price: p.economics.price || plan.suggestedPrice,
    packagingPerUnit: p.economics.packagingPerUnit || plan.packagingPerUnit,
    laborMinutesPerUnit: p.economics.laborMinutesPerUnit || plan.laborMinutesPerUnit,
  };
  transaction(() => {
    run('UPDATE projects SET plan = ?, economics = ?, progress = ?, updated_at = ? WHERE id = ?', JSON.stringify(plan), JSON.stringify(econ), JSON.stringify({ completedSteps: [], stepNotes: {} }), now(), p.id);
    const allocation = syncPurchases(p.id, settings.currency);
    // Status follows the purchase gate: nothing to buy → ready to build.
    if (['idea', 'feasibility', 'design'].includes(p.status)) run('UPDATE projects SET status = ? WHERE id = ?', allocation?.everythingOwned ? 'ready_to_build' : 'materials_needed', p.id);
  });
  logActivity('plan', `Generated build plan for "${p.name}" (${plan.engine === 'ai' ? 'AI' : 'demo engine'})`, p.id);
  res.json(projectDetail(getProject(p.id)));
});

/** Re-run web research for a project's product and keep it with the plan. */
projects.post('/projects/:id/research', aiLimit, async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.idea?.engine === 'demo') return res.status(400).json({ error: 'Example projects are not researched.' });
  const research = await researchProduct(p, inventoryForEngines(), getSettings().region);
  const plan = p.plan ? { ...p.plan, research } : null;
  if (plan) run('UPDATE projects SET plan = ?, updated_at = ? WHERE id = ?', JSON.stringify(plan), now(), p.id);
  logActivity('research', `Researched "${p.name}" — ${research.sources.length} verified source(s)`, p.id);
  res.json(projectDetail(getProject(p.id)));
});

/* ---------- purchases / sourcing ---------- */
function hydratePurchase(r) {
  return {
    id: r.id, projectId: r.project_id, name: r.name, spec: r.spec, quantity: r.quantity, unit: r.unit,
    estUnitPrice: r.est_unit_price, currency: r.currency, options: parseJSON(r.options, []), chosenOption: parseJSON(r.chosen_option, null),
    searchMeta: parseJSON(r.search_meta, null), purchased: Boolean(r.purchased), actualCost: r.actual_cost, createdAt: r.created_at, reason: r.reason || null,
  };
}

/**
 * Purchase gate. The checklist holds ONLY genuine shortages computed by the reuse-first
 * allocator (owned stock, safe substitutes and purchased items are subtracted first),
 * each with the reason it is needed. Optional upgrades never enter the list.
 */
function syncPurchases(projectId, currency) {
  const p = getProject(projectId);
  if (!p?.plan) return null;
  const allocation = projectAllocation(p);
  const existing = all('SELECT * FROM purchases WHERE project_id = ?', projectId);
  const needed = new Map(allocation.purchases.map((x) => [x.name, x]));
  for (const row of existing) {
    if (!needed.has(row.name) && !row.purchased) run('DELETE FROM purchases WHERE id = ?', row.id);
  }
  for (const need of allocation.purchases) {
    const row = existing.find((e) => e.name === need.name && !e.purchased);
    if (row) run('UPDATE purchases SET quantity = ?, unit = ?, spec = ?, est_unit_price = ?, reason = ? WHERE id = ?', need.quantity, need.unit, need.spec || null, need.unitPrice, need.reason, row.id);
    else run('INSERT INTO purchases (id, project_id, name, spec, quantity, unit, est_unit_price, currency, options, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', uid(), projectId, need.name, need.spec || null, need.quantity, need.unit, need.unitPrice, currency, '[]', need.reason, now());
  }
  return allocation;
}

projects.post('/projects/:id/purchases/sync', (req, res) => {
  const p = getProject(req.params.id);
  if (!p?.plan) return res.status(400).json({ error: 'Generate a plan first.' });
  syncPurchases(p.id, getSettings().currency);
  res.json(projectDetail(getProject(p.id)));
});

projects.get('/purchases', (_req, res) => {
  // Re-run the purchase gate first: inventory may have changed since the plans were made.
  const currency = getSettings().currency;
  for (const p of listProjects()) if (p.plan && !['archived'].includes(p.status)) syncPurchases(p.id, currency);
  const rows = all('SELECT pu.*, p.name AS project_name, p.is_example FROM purchases pu JOIN projects p ON p.id = pu.project_id ORDER BY pu.purchased, pu.created_at DESC');
  res.json(rows.map((r) => ({ ...hydratePurchase(r), projectName: r.project_name, isExample: Boolean(r.is_example), links: searchLinks([r.name, r.spec].filter(Boolean).join(' '), getSettings().region) })));
});

const OptionBody = z.object({
  supplier: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  url: z.string().url().max(1000).optional().or(z.literal('')),
  price: z.number().min(0).max(1e8),
  currency: z.string().length(3),
  packQuantity: z.number().positive().max(1e6).default(1),
  shippingCost: z.number().min(0).max(1e7).nullable().optional(),
  deliveryDays: z.number().min(0).max(365).nullable().optional(),
  compatible: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

projects.post('/purchases/:id/options', validate(OptionBody), (req, res) => {
  const row = get('SELECT * FROM purchases WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase item not found' });
  const options = [...parseJSON(row.options, []), { id: uid(), ...req.body, source: 'manual_quote', retrievedAt: now() }];
  run('UPDATE purchases SET options = ? WHERE id = ?', JSON.stringify(options), row.id);
  res.json(withComparison(hydratePurchase(get('SELECT * FROM purchases WHERE id = ?', row.id))));
});

projects.delete('/purchases/:id/options/:optionId', (req, res) => {
  const row = get('SELECT * FROM purchases WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase item not found' });
  run('UPDATE purchases SET options = ? WHERE id = ?', JSON.stringify(parseJSON(row.options, []).filter((o) => o.id !== req.params.optionId)), row.id);
  res.json(withComparison(hydratePurchase(get('SELECT * FROM purchases WHERE id = ?', row.id))));
});

function withComparison(p) {
  return { ...p, comparison: compareOptions(p.options, p.quantity, { currency: p.currency }) };
}

projects.get('/purchases/:id', (req, res) => {
  const row = get('SELECT * FROM purchases WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase item not found' });
  res.json({ ...withComparison(hydratePurchase(row)), links: searchLinks([row.name, row.spec].filter(Boolean).join(' '), getSettings().region) });
});

projects.post('/purchases/:id/search', aiLimit, async (req, res) => {
  const row = get('SELECT * FROM purchases WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase item not found' });
  const settings = getSettings();
  const result = await searchSuppliers(hydratePurchase(row), { region: settings.region, currency: settings.currency, quantity: row.quantity });
  const options = [...parseJSON(row.options, []).filter((o) => o.source !== 'web_search'), ...result.options];
  run('UPDATE purchases SET options = ?, search_meta = ? WHERE id = ?', JSON.stringify(options), JSON.stringify({ engine: result.engine, live: result.live, retrievedAt: result.retrievedAt, note: result.note, alternatives: result.alternatives || [] }), row.id);
  res.json({ ...withComparison(hydratePurchase(get('SELECT * FROM purchases WHERE id = ?', row.id))), links: result.links, search: result });
});

projects.patch('/purchases/:id', validate(z.object({ purchased: z.boolean().optional(), chosenOptionId: z.string().nullable().optional(), actualCost: z.number().min(0).nullable().optional() })), (req, res) => {
  const row = get('SELECT * FROM purchases WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase item not found' });
  const b = req.body;
  if (b.chosenOptionId !== undefined) {
    const opt = parseJSON(row.options, []).find((o) => o.id === b.chosenOptionId) || null;
    run('UPDATE purchases SET chosen_option = ? WHERE id = ?', opt ? JSON.stringify(opt) : null, row.id);
  }
  if (b.purchased !== undefined) {
    run('UPDATE purchases SET purchased = ? WHERE id = ?', b.purchased ? 1 : 0, row.id);
    if (b.purchased) logActivity('purchase', `Marked "${row.name}" as purchased`, row.project_id);
  }
  if (b.actualCost !== undefined) run('UPDATE purchases SET actual_cost = ? WHERE id = ?', b.actualCost, row.id);
  // Keep the "materials needed" status honest.
  const p = getProject(row.project_id);
  const open = get('SELECT COUNT(*) AS c FROM purchases WHERE project_id = ? AND purchased = 0', row.project_id).c;
  if (p.status === 'materials_needed' && open === 0) {
    run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', 'ready_to_build', now(), p.id);
    logActivity('status', `All materials purchased — "${p.name}" is ready to build`, p.id);
  }
  res.json(withComparison(hydratePurchase(get('SELECT * FROM purchases WHERE id = ?', row.id))));
});

/* ---------- sell guide (the project's "Sell it" step) ---------- */
projects.post('/projects/:id/sell', aiLimit, async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const s = getSettings();
  const unit = projectDetail(p).computed.economics.perUnit;
  const guide = await generateSellGuide(p, { productionCost: unit.productionCost, materialCash: unit.materialCash }, s);
  run('UPDATE projects SET strategy = ?, updated_at = ? WHERE id = ?', JSON.stringify(guide), now(), p.id);
  logActivity('strategy', `Selling guide for "${p.name}"`, p.id);
  res.json(projectDetail(getProject(p.id)));
});

/* ---------- channels / strategy ---------- */
projects.post('/projects/:id/channels', aiLimit, validate(z.object({ delivery: z.array(z.string()).optional(), marketingHoursPerWeek: z.number().min(0).max(100).optional(), adBudget: z.number().min(0).optional(), audienceSize: z.number().min(0).optional(), goal: z.string().optional() })), async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const s = getSettings();
  const ctx = { region: s.region, currency: s.currency, delivery: s.deliveryOptions, marketingHoursPerWeek: s.marketingHoursPerWeek, audienceSize: s.audienceSize, ...req.body };
  const strategy = await recommendChannels(p, ctx);
  run('UPDATE projects SET strategy = ?, updated_at = ? WHERE id = ?', JSON.stringify({ ...strategy, context: ctx }), now(), p.id);
  logActivity('strategy', `Generated sales strategy for "${p.name}"`, p.id);
  res.json(projectDetail(getProject(p.id)));
});

/* ---------- production ---------- */
projects.post('/projects/:id/production', validate(z.object({ quantity: z.number().int().min(1).max(100000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(500).optional(), deductInventory: z.boolean().optional() })), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const deducted = [];
  transaction(() => {
    run('INSERT INTO production (id, project_id, date, quantity, note, created_at) VALUES (?,?,?,?,?,?)', uid(), p.id, req.body.date, req.body.quantity, req.body.note || null, now());
    run('UPDATE projects SET units_produced = units_produced + ?, updated_at = ? WHERE id = ?', req.body.quantity, now(), p.id);
    // Explicit, opt-in stock consumption: only the owned materials these units actually used.
    if (req.body.deductInventory && p.plan && !p.isExample) {
      const a = projectAllocation(p, allocationInputs(p), req.body.quantity);
      for (const line of a.lines) {
        for (const src of line.sources) {
          if (!src.itemId || String(src.itemId).startsWith('purchase:') || !(src.itemQty > 0)) continue;
          run('UPDATE inventory_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?', src.itemQty, now(), src.itemId);
          deducted.push(`${src.itemQty} × ${src.name}`);
        }
      }
    }
  });
  logActivity('production', `Recorded ${req.body.quantity} unit(s) produced for "${p.name}"${deducted.length ? ` — deducted from stock: ${deducted.join(', ')}` : ''}`, p.id);
  res.json(projectDetail(getProject(p.id)));
});

projects.delete('/production/:id', (req, res) => {
  const row = get('SELECT * FROM production WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  transaction(() => {
    run('DELETE FROM production WHERE id = ?', row.id);
    run('UPDATE projects SET units_produced = MAX(0, units_produced - ?), updated_at = ? WHERE id = ?', row.quantity, now(), row.project_id);
  });
  res.json(projectDetail(getProject(row.project_id)));
});
