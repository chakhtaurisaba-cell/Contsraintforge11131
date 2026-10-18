import { Router } from 'express';
import { z } from 'zod';
import { all, run, now, uid, logActivity, transaction } from '../db.js';
import { validate, rateLimit } from '../middleware.js';
import { computeAnalytics } from '../services/analytics.js';
import { runAdvisor, listRecommendations, decide } from '../services/advisor.js';
import { getSettings, getProject } from '../services/projects.js';

export const business = Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/* ---------- sales ---------- */
const SaleBody = z.object({
  projectId: z.string().nullable().optional(),
  date,
  channel: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(100000),
  unitPrice: z.number().min(0).max(1e8),
  fees: z.number().min(0).max(1e8).default(0),
  shippingCost: z.number().min(0).max(1e8).default(0),
  adCost: z.number().min(0).max(1e8).default(0),
  refund: z.number().min(0).max(1e8).default(0),
  returnedUnits: z.number().int().min(0).max(100000).default(0),
  note: z.string().max(500).optional(),
});

function insertSale(b, source = 'manual', currency) {
  if (b.projectId && !getProject(b.projectId)) throw Object.assign(new Error('Unknown project'), { status: 400 });
  run(
    'INSERT INTO sales (id, project_id, date, channel, quantity, unit_price, fees, shipping_cost, ad_cost, refund, returned_units, currency, note, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid(), b.projectId || null, b.date, b.channel, b.quantity, b.unitPrice, b.fees, b.shippingCost, b.adCost, b.refund, b.returnedUnits, currency, b.note || null, source, now()
  );
}

business.post('/sales', validate(SaleBody), (req, res) => {
  insertSale(req.body, 'manual', getSettings().currency);
  if (req.body.projectId) {
    const p = getProject(req.body.projectId);
    if (['ready_to_sell', 'listed'].includes(p.status)) run("UPDATE projects SET status = 'selling', updated_at = ? WHERE id = ?", now(), p.id);
  }
  logActivity('sale', `Recorded sale: ${req.body.quantity} × ${req.body.unitPrice} via ${req.body.channel}`, req.body.projectId);
  res.status(201).json({ ok: true });
});

business.post('/sales/import', validate(z.object({ rows: z.array(SaleBody).min(1).max(5000) })), (req, res) => {
  const currency = getSettings().currency;
  transaction(() => req.body.rows.forEach((r) => insertSale(r, 'csv', currency)));
  logActivity('sale', `Imported ${req.body.rows.length} sale(s) from CSV`);
  res.status(201).json({ imported: req.body.rows.length });
});

business.delete('/sales/:id', (req, res) => {
  run('DELETE FROM sales WHERE id = ?', req.params.id);
  res.status(204).end();
});

/* ---------- expenses ---------- */
business.post('/expenses', validate(z.object({ projectId: z.string().nullable().optional(), date, category: z.string().min(1).max(60), amount: z.number().min(0).max(1e8), note: z.string().max(500).optional() })), (req, res) => {
  const b = req.body;
  run('INSERT INTO expenses (id, project_id, date, category, amount, note, created_at) VALUES (?,?,?,?,?,?,?)', uid(), b.projectId || null, b.date, b.category, b.amount, b.note || null, now());
  logActivity('expense', `Recorded expense: ${b.category} ${b.amount}`, b.projectId);
  res.status(201).json({ ok: true });
});
business.delete('/expenses/:id', (req, res) => {
  run('DELETE FROM expenses WHERE id = ?', req.params.id);
  res.status(204).end();
});

/* ---------- channel traffic metrics (for conversion rates) ---------- */
business.get('/channel-metrics', (_req, res) => res.json(all('SELECT * FROM channel_metrics ORDER BY period_end DESC')));
business.post('/channel-metrics', validate(z.object({ projectId: z.string().nullable().optional(), channel: z.string().min(1).max(80), periodStart: date, periodEnd: date, impressions: z.number().int().min(0).nullable().optional(), visits: z.number().int().min(0).nullable().optional() })), (req, res) => {
  const b = req.body;
  run('INSERT INTO channel_metrics (id, project_id, channel, period_start, period_end, impressions, visits, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), b.projectId || null, b.channel, b.periodStart, b.periodEnd, b.impressions ?? null, b.visits ?? null, now());
  res.status(201).json({ ok: true });
});
business.delete('/channel-metrics/:id', (req, res) => {
  run('DELETE FROM channel_metrics WHERE id = ?', req.params.id);
  res.status(204).end();
});

/* ---------- analytics ---------- */
const filtersFrom = (q) => ({
  from: q.from || undefined,
  to: q.to || undefined,
  projectId: q.projectId || undefined,
  channel: q.channel || undefined,
  granularity: ['day', 'week', 'month'].includes(q.granularity) ? q.granularity : undefined,
  includeExamples: q.includeExamples !== 'false',
});

business.get('/analytics', (req, res) => res.json(computeAnalytics(filtersFrom(req.query))));

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

business.get('/analytics/export.csv', (req, res) => {
  const a = computeAnalytics(filtersFrom(req.query));
  const header = ['date', 'product', 'channel', 'quantity', 'unit_price', 'revenue', 'fees', 'shipping', 'ads', 'refund', 'returned_units', 'production_cost', 'profit', 'source', 'note'];
  const lines = [header.join(',')];
  for (const s of a.sales) {
    lines.push([s.date, s.project_name, s.channel, s.quantity, s.unit_price, s.revenue, s.fees, s.shipping_cost, s.ad_cost, s.refund, s.returned_units, s.cogs, s.profit, s.source, s.note].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="constraintforge-sales-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

/* ---------- advisor ---------- */
business.get('/advisor', (_req, res) => res.json(listRecommendations()));
business.post('/advisor/run', rateLimit({ windowMs: 10 * 60 * 1000, max: 20 }), async (req, res) => {
  const settings = getSettings();
  res.json(await runAdvisor(settings, { includeExamples: settings.includeExamples !== false, withAI: req.body?.withAI !== false }));
});
business.post('/advisor/:id/decision', validate(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(1000).optional(), apply: z.boolean().optional() })), (req, res) => {
  res.json(decide(req.params.id, req.body));
});
