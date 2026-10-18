// Context-aware assistant. The server assembles the user's REAL data for the current
// scope (inventory, selected project plan, materials breakdown, research, costs,
// recorded sales) — the browser only says which page/project is open. Threads are
// stored per project so follow-up questions keep their context. No canned replies:
// if the AI is unavailable the request fails honestly and can be retried.
import { z } from 'zod';
import { all, run, now, uid, parseJSON } from '../db.js';
import { validate } from '../middleware.js';
import { chatWithResearch } from '../ai/client.js';
import { SYSTEM_ASSISTANT } from '../ai/prompts.js';
import { getProject, getSettings, allocationInputs, projectAllocation, projectEconomics } from './projects.js';
import { computeAnalytics } from './analytics.js';
import { projectMetrics } from './advisor.js';
import { STATUS } from '../../shared/allocation.js';

const dims = (d) => (d ? ['length', 'width', 'thickness', 'height', 'diameter'].filter((k) => d[k]).map((k) => `${k} ${d[k]}${d.unit || 'mm'}`).join(', ') + (d.status ? ` (${d.status})` : '') : 'not measured');

export function buildContext({ page, projectId }) {
  const settings = getSettings();
  const ctx = {
    page,
    currency: settings.currency,
    region: settings.region,
    inventory: all('SELECT name, material, quantity, unit, dimensions FROM inventory_items ORDER BY name').map((i) => ({ name: i.name, material: i.material, quantity: `${i.quantity} ${i.unit}`, size: dims(parseJSON(i.dimensions, null)) })),
  };
  const p = projectId ? getProject(projectId) : null;
  if (p) {
    const allocation = projectAllocation(p, allocationInputs(p));
    const econ = projectEconomics(p, allocation);
    const m = projectMetrics(p);
    const currentStep = p.plan?.steps?.find((s) => s.id === p.progress?.currentStep);
    ctx.project = {
      name: p.name,
      isExample: p.isExample,
      status: p.status,
      description: p.idea?.description,
      toolsUserHas: p.idea?.userTools || [],
      plan: p.plan && {
        summary: p.plan.summary,
        overallSizeMm: p.plan.overall,
        assumptions: p.plan.assumptions,
        components: p.plan.components.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, cutMm: [c.cutLength, c.cutWidth, c.thickness].filter(Boolean).join(' × '), madeFrom: c.fromInventory || 'to buy', role: c.role })),
        steps: p.plan.steps.map((s) => ({ step: s.n, title: s.title, objective: s.objective, instructions: s.instructions, measurements: s.measurements, parts: s.components, orientation: s.orientation, connections: s.connections, check: s.alignmentCheck, result: s.expectedResult, done: p.progress?.completedSteps?.includes(s.id) })),
        currentStep: currentStep ? `${currentStep.n}. ${currentStep.title}` : null,
        toolNotes: p.plan.toolNotes,
      },
      materials: allocation && {
        batchSize: allocation.batchQty,
        everythingOwned: allocation.everythingOwned,
        lines: allocation.lines.map((l) => ({ part: l.name, status: STATUS[l.status]?.label, needed: `${l.needTotal} ${l.unit}`, fromStock: l.sources.map((s) => `${s.name} ${s.qty} ${s.unit}${s.kind === 'substitute' ? ' (substitute)' : ''}`), shortage: l.shortage || 0, note: l.note })),
        smallerBatchWithNoPurchases: allocation.reduceBatchTo,
      },
      research: p.plan?.research && { summary: p.plan.research.summary, limited: p.plan.research.limited, sources: (p.plan.research.sources || []).map((s, i) => ({ ref: i, title: s.title, url: s.url, type: s.type, findings: s.findings })) },
      costs: { price: p.economics.price, batchSize: p.economics.batchQty, perUnit: econ.perUnit, breakEvenPrice: econ.breakEvenPrice, note: 'Costs are app calculations from the materials list and the user’s inputs (estimates).' },
      recordedSales: { produced: m.produced, sold: m.sold, onHand: m.onHand, revenue: m.revenue, profit: m.profit, marginPct: m.actualMarginPct, last30DaysSold: m.sold30 },
    };
  }
  if (['dashboard', 'analytics', 'advisor', 'strategy'].includes(page)) {
    const a = computeAnalytics({ includeExamples: settings.includeExamples !== false });
    ctx.business = { totals: a.totals, byChannel: a.byChannel, byProduct: a.byProduct, inventory: a.inventory, note: a.sales.some((s) => s.source === 'example') ? 'Includes simulated example sales.' : 'Recorded sales only.' };
  }
  return ctx;
}

const Body = z.object({
  scope: z.string().regex(/^(project:[\w-]+|page:[\w-]+)$/),
  page: z.string().max(40),
  projectId: z.string().max(60).nullable().optional(),
  message: z.string().trim().min(1).max(4000),
});

const loadThread = (scope) => all('SELECT role, content, sources, created_at FROM assistant_messages WHERE scope = ? ORDER BY created_at, rowid', scope).map((m) => ({ role: m.role, content: m.content, sources: parseJSON(m.sources, []), createdAt: m.created_at }));

export function assistantRoutes(router, limit) {
  router.get('/assistant/thread', (req, res) => {
    const scope = String(req.query.scope || '');
    if (!/^(project:[\w-]+|page:[\w-]+)$/.test(scope)) return res.status(400).json({ error: 'Invalid scope' });
    res.json({ messages: loadThread(scope) });
  });

  router.delete('/assistant/thread', (req, res) => {
    run('DELETE FROM assistant_messages WHERE scope = ?', String(req.query.scope || ''));
    res.status(204).end();
  });

  router.post('/assistant', limit, validate(Body), async (req, res) => {
    const { scope, page, projectId, message } = req.body;
    const history = loadThread(scope).slice(-12).map((m) => ({ role: m.role, content: m.content }));
    // The latest turn carries the current app data; earlier turns stay as plain text.
    const data = JSON.stringify(buildContext({ page, projectId }));
    const messages = [...history, { role: 'user', content: `${message}\n\n<app_data>${data.slice(0, 60000)}</app_data>` }];
    // Conversation must start with a user turn and alternate.
    while (messages.length && messages[0].role !== 'user') messages.shift();
    const reply = await chatWithResearch({ system: SYSTEM_ASSISTANT, messages, effort: 'low' });
    const t = now();
    run('INSERT INTO assistant_messages (id, scope, role, content, sources, created_at) VALUES (?,?,?,?,?,?)', uid(), scope, 'user', message, null, t);
    run('INSERT INTO assistant_messages (id, scope, role, content, sources, created_at) VALUES (?,?,?,?,?,?)', uid(), scope, 'assistant', reply.text || '(no answer)', JSON.stringify(reply.sources), new Date(Date.now() + 1).toISOString());
    res.json({ reply: reply.text, sources: reply.sources, searched: reply.searched });
  });
}
