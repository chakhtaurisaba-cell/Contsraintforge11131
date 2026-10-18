// Sales analytics computed only from recorded / imported data.
import { all } from '../db.js';
import { listProjects, projectEconomics } from './projects.js';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function loadSales({ from, to, projectId, channel, includeExamples = true } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('s.date >= ?'); params.push(from); }
  if (to) { where.push('s.date <= ?'); params.push(to); }
  if (projectId) { where.push('s.project_id = ?'); params.push(projectId); }
  if (channel) { where.push('s.channel = ?'); params.push(channel); }
  if (!includeExamples) where.push('(p.is_example = 0 OR p.is_example IS NULL)');
  const sql = `SELECT s.*, p.name AS project_name, p.is_example FROM sales s LEFT JOIN projects p ON p.id = s.project_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.date DESC`;
  return all(sql, ...params);
}

/** Per-sale breakdown with the formula inputs, so users can audit each number. */
export function enrichSales(sales, unitCostByProject) {
  return sales.map((s) => {
    const revenue = s.quantity * s.unit_price;
    const unitCost = unitCostByProject.get(s.project_id) ?? null;
    const cogs = unitCost != null ? unitCost * s.quantity : null;
    const profit = revenue - s.refund - s.fees - s.shipping_cost - s.ad_cost - (cogs ?? 0);
    return {
      ...s,
      revenue: r2(revenue),
      unitCost: unitCost != null ? r2(unitCost) : null,
      cogs: cogs != null ? r2(cogs) : null,
      profit: r2(profit),
      profitFormula: `revenue ${r2(revenue)} − refund ${r2(s.refund)} − fees ${r2(s.fees)} − shipping ${r2(s.shipping_cost)} − ads ${r2(s.ad_cost)} − production cost ${cogs != null ? r2(cogs) : 'n/a'}`,
      costKnown: unitCost != null,
    };
  });
}

function bucketKey(date, granularity) {
  if (granularity === 'day') return date.slice(0, 10);
  if (granularity === 'week') {
    const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }
  return date.slice(0, 7);
}

export function computeAnalytics(filters = {}) {
  const projects = listProjects().filter((p) => filters.includeExamples !== false || !p.isExample);
  const unitCostByProject = new Map(projects.filter((p) => p.plan?.bom).map((p) => [p.id, projectEconomics(p).perUnit.productionCost]));
  const sales = enrichSales(loadSales(filters), unitCostByProject);

  const expWhere = [];
  const expParams = [];
  if (filters.from) { expWhere.push('e.date >= ?'); expParams.push(filters.from); }
  if (filters.to) { expWhere.push('e.date <= ?'); expParams.push(filters.to); }
  if (filters.projectId) { expWhere.push('e.project_id = ?'); expParams.push(filters.projectId); }
  if (filters.includeExamples === false) expWhere.push('(p.is_example = 0 OR p.is_example IS NULL)');
  const expenses = all(`SELECT e.* FROM expenses e LEFT JOIN projects p ON p.id = e.project_id ${expWhere.length ? `WHERE ${expWhere.join(' AND ')}` : ''}`, ...expParams);

  const totals = sales.reduce(
    (t, s) => {
      t.orders += 1;
      t.units += s.quantity;
      t.returnedUnits += s.returned_units;
      t.revenue += s.revenue;
      t.refunds += s.refund;
      t.fees += s.fees;
      t.shipping += s.shipping_cost;
      t.ads += s.ad_cost;
      t.cogs += s.cogs ?? 0;
      t.profit += s.profit;
      if (!s.costKnown) t.salesWithoutCost += 1;
      return t;
    },
    { orders: 0, units: 0, returnedUnits: 0, revenue: 0, refunds: 0, fees: 0, shipping: 0, ads: 0, cogs: 0, profit: 0, salesWithoutCost: 0 }
  );
  const otherExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  totals.otherExpenses = otherExpenses;
  totals.netProfit = totals.profit - otherExpenses;
  totals.marginPct = totals.revenue > 0 ? r2((totals.netProfit / totals.revenue) * 100) : null;
  totals.avgOrderValue = totals.orders ? r2(totals.revenue / totals.orders) : null;
  for (const k of Object.keys(totals)) if (typeof totals[k] === 'number' && !Number.isInteger(totals[k])) totals[k] = r2(totals[k]);

  const group = (keyFn) => {
    const m = new Map();
    for (const s of sales) {
      const k = keyFn(s);
      const g = m.get(k) || { key: k, orders: 0, units: 0, revenue: 0, profit: 0, fees: 0, shipping: 0 };
      g.orders += 1;
      g.units += s.quantity;
      g.revenue += s.revenue;
      g.profit += s.profit;
      g.fees += s.fees;
      g.shipping += s.shipping_cost;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, revenue: r2(g.revenue), profit: r2(g.profit), fees: r2(g.fees), shipping: r2(g.shipping), profitPerUnit: g.units ? r2(g.profit / g.units) : null }));
  };

  const spanDays = sales.length ? (new Date(sales[0].date) - new Date(sales[sales.length - 1].date)) / 86400000 : 0;
  const granularity = filters.granularity || (spanDays <= 31 ? 'day' : spanDays <= 120 ? 'week' : 'month');
  const timeline = group((s) => bucketKey(s.date, granularity)).sort((a, b) => a.key.localeCompare(b.key));
  const byChannel = group((s) => s.channel).sort((a, b) => b.revenue - a.revenue);
  const byProduct = group((s) => s.project_name || 'Unassigned').sort((a, b) => b.revenue - a.revenue);

  // Conversion: only where visit data has actually been recorded.
  const metrics = all('SELECT * FROM channel_metrics');
  const conversion = byChannel.map((c) => {
    const rows = metrics.filter((m) => m.channel === c.key && (!filters.projectId || m.project_id === filters.projectId));
    const visits = rows.reduce((s, r) => s + (r.visits || 0), 0);
    const impressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
    return {
      channel: c.key,
      orders: c.orders,
      visits: rows.length ? visits : null,
      impressions: rows.length && impressions ? impressions : null,
      conversionPct: rows.length && visits > 0 ? r2((c.orders / visits) * 100) : null,
    };
  });

  // Inventory per project = produced − sold + returned.
  const soldAll = all('SELECT project_id, SUM(quantity) AS sold, SUM(returned_units) AS returned FROM sales GROUP BY project_id');
  const inventory = projects.map((p) => {
    const s = soldAll.find((x) => x.project_id === p.id) || { sold: 0, returned: 0 };
    return { projectId: p.id, name: p.name, isExample: p.isExample, produced: p.unitsProduced, sold: s.sold || 0, returned: s.returned || 0, onHand: p.unitsProduced - (s.sold || 0) + (s.returned || 0) };
  });

  return {
    filters: { ...filters, granularity },
    totals,
    timeline,
    byChannel,
    byProduct,
    conversion,
    inventory,
    sales,
    expenses,
    channels: [...new Set(all('SELECT DISTINCT channel FROM sales').map((r) => r.channel))],
    // Where the numbers come from, and when each connected platform last synced.
    dataSources: all('SELECT source, COUNT(*) AS records, MAX(date) AS latest FROM sales GROUP BY source ORDER BY records DESC').map((s) => {
      const integ = all('SELECT meta, status FROM integrations WHERE provider = ?', s.source)[0];
      let lastSyncAt = null;
      try { lastSyncAt = integ ? JSON.parse(integ.meta || '{}').lastSyncAt || null : null; } catch { /* ignore */ }
      return { ...s, lastSyncAt, status: integ?.status || null };
    }),
    adMetricsAvailable: false,
  };
}
