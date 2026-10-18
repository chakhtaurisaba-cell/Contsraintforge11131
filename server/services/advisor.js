// AI Business Advisor. Diagnostics are computed by deterministic rules from recorded
// data (so every number is traceable); the AI only explains them in plain language.
import { all, get, run, now, parseJSON, logActivity } from '../db.js';
import { listProjects, projectEconomics, getProject, projectAllocation } from './projects.js';
import { bomWithAllocation } from '../../shared/allocation.js';

// BOM with each line's owned fraction, so simulations cost only what must be bought.
const allocatedBom = (project) => bomWithAllocation(project.plan?.bom || [], projectAllocation(project));
import { enrichSales, computeAnalytics } from './analytics.js';
import { simulateBatchChange, simulatePriceChange, computeEconomics } from '../../shared/economics.js';
import { aiEnabled, structured } from '../ai/client.js';
import { AdvisorNarrative } from '../ai/schemas.js';
import { SYSTEM_ADVISOR } from '../ai/prompts.js';

const DAY = 86400000;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

export function projectMetrics(project, sinceISO = null) {
  const econ = projectEconomics(project);
  const unitCost = new Map([[project.id, econ.perUnit.productionCost]]);
  const sales = enrichSales(all('SELECT * FROM sales WHERE project_id = ? ORDER BY date', project.id), unitCost);
  const production = all('SELECT * FROM production WHERE project_id = ? ORDER BY date', project.id);
  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const last30 = sales.filter((s) => s.date >= daysAgo(30));
  const last60 = sales.filter((s) => s.date >= daysAgo(60));
  const since = sinceISO ? sales.filter((s) => s.date >= sinceISO.slice(0, 10)) : [];
  const sold = sum(sales, 'quantity');
  const returned = sum(sales, 'returned_units');
  const revenue = sum(sales, 'revenue');
  const profit = sum(sales, 'profit');
  return {
    econ,
    sales,
    production,
    sold,
    returned,
    produced: project.unitsProduced,
    onHand: project.unitsProduced - sold + returned,
    revenue: r2(revenue),
    profit: r2(profit),
    actualMarginPct: revenue > 0 ? r2((profit / revenue) * 100) : null,
    sold30: sum(last30, 'quantity'),
    revenue30: r2(sum(last30, 'revenue')),
    profit30: r2(sum(last30, 'profit')),
    avgMonthlyUnits: r2(sum(last60, 'quantity') / 2),
    firstProduction: production[0]?.date || null,
    firstSale: sales[0]?.date || null,
    lastSale: sales[sales.length - 1]?.date || null,
    since: sinceISO ? { units: sum(since, 'quantity'), revenue: r2(sum(since, 'revenue')), profit: r2(sum(since, 'profit')), days: Math.max(1, Math.round((Date.now() - new Date(sinceISO)) / DAY)) } : null,
  };
}

export function snapshot(project) {
  const m = projectMetrics(project);
  return { at: now(), sold30: m.sold30, revenue30: m.revenue30, profit30: m.profit30, actualMarginPct: m.actualMarginPct, onHand: m.onHand, price: project.economics.price, batchQty: project.economics.batchQty, plannedNetMarginPct: m.econ.perUnit.netMarginPct };
}

const rec = (o) => ({ evidence: [], assumptions: [], risks: [], ...o });

function diagnose(project, settings) {
  const cur = settings.currency;
  const m = projectMetrics(project);
  const e = project.economics;
  const out = [];
  const daysSinceProd = m.firstProduction ? (Date.now() - new Date(m.firstProduction)) / DAY : 0;

  // Scenario A — too much inventory
  if (m.produced >= 8 && m.onHand > 0 && daysSinceProd >= 14 && m.onHand > Math.max(3, m.avgMonthlyUnits * 2)) {
    const expected = Math.max(1, Math.round(m.avgMonthlyUnits * 1.5));
    const toQty = Math.max(1, Math.min(e.batchQty, expected));
    const sim = simulateBatchChange(allocatedBom(project), e, { fromQty: e.batchQty, toQty, expectedSales: expected });
    out.push(rec({
      rule: 'inventory_overhang', priority: 85, severity: 'high',
      title: 'Inventory is building up faster than it sells',
      observation: `${m.onHand} units are on hand, about ${m.avgMonthlyUnits ? r2(m.onHand / m.avgMonthlyUnits) : '∞'} months of sales at the current pace.`,
      evidence: [{ label: 'Produced', value: m.produced }, { label: 'Sold (all time)', value: m.sold }, { label: 'On hand', value: m.onHand }, { label: 'Avg units / month (last 60 days)', value: m.avgMonthlyUnits }],
      whyItMatters: 'Unsold stock ties up cash in materials and time, and risks discounting later.',
      action: `Pause further production until stock falls below ~${expected} units, and reduce the next batch from ${e.batchQty} to ${toQty}. Meanwhile test a new channel or a bundle to move existing stock.`,
      expectedEffect: { text: `Next batch needs ${sim.cashSaved} ${cur} less cash; unsold exposure after one month falls from ${sim.inventoryExposureBefore} to ${sim.inventoryExposureAfter} ${cur} (at production cost).`, value: sim.cashSaved },
      simulation: { kind: 'batch', fromQty: e.batchQty, toQty, expectedSales: expected, result: sim },
      apply: { field: 'batchQty', value: toQty, label: `Set the planned batch size to ${toQty}` },
      assumptions: [`Next month's sales ≈ 1.5× the recent monthly average (${m.avgMonthlyUnits}).`],
      risks: ['If demand is about to grow (e.g. seasonality), a smaller batch could cause stock-outs.'],
      test: 'Track units sold over the next 30 days; resume normal batches if on-hand stock drops below one month of sales.',
    }));
  }

  // Scenario B — low margin
  const plannedMargin = m.econ.perUnit.netMarginPct;
  const margin = m.actualMarginPct ?? plannedMargin;
  if (e.price > 0 && margin != null && margin < 15) {
    const pu = m.econ.perUnit;
    const parts = [
      { k: 'Materials', v: pu.material }, { k: 'Packaging', v: pu.packaging }, { k: 'Labour', v: pu.labor },
      { k: 'Shipping', v: pu.shipping }, { k: 'Advertising', v: pu.ads }, { k: 'Fees', v: pu.fees }, { k: 'Refunds', v: pu.refunds },
    ].sort((a, b) => b.v - a.v);
    const target = 25;
    const feePct = ((e.marketplaceFeePct || 0) + (e.paymentFeePct || 0)) / 100;
    const denom = 1 - (e.returnRatePct || 0) / 100 - feePct - target / 100;
    const targetPrice = denom > 0 ? Math.ceil(((pu.productionCost + pu.shipping + pu.ads + (e.marketplaceFixedFee || 0) + (e.paymentFixedFee || 0)) / denom) * 10) / 10 : null;
    const units = Math.max(1, m.sold30 || m.avgMonthlyUnits || 5);
    const sim = targetPrice ? simulatePriceChange(allocatedBom(project), e, { newPrice: targetPrice, unitsBefore: units, unitsAfter: units }) : null;
    out.push(rec({
      rule: 'low_margin', priority: 80, severity: margin < 0 ? 'high' : 'medium',
      title: margin < 0 ? 'Each sale is losing money' : 'Profit margin is thin',
      observation: `${m.actualMarginPct != null ? 'Recorded' : 'Planned'} net margin is ${margin}%. Biggest per-unit costs: ${parts.slice(0, 3).map((p) => `${p.k} ${p.v} ${cur}`).join(', ')}.`,
      evidence: [{ label: 'Price', value: `${e.price} ${cur}` }, { label: 'Full cost / unit', value: `${pu.fullCost} ${cur}` }, { label: 'Break-even price', value: `${m.econ.breakEvenPrice ?? '—'} ${cur}` }, ...parts.slice(0, 3).map((p) => ({ label: p.k, value: `${p.v} ${cur}` }))],
      whyItMatters: 'With a thin margin, any returns, discounts or cost increases wipe out profit.',
      action: targetPrice ? `Test a price of ${targetPrice} ${cur} (25% target margin), or reduce the largest cost (${parts[0].k}).` : `Reduce the largest cost (${parts[0].k}); fees and returns are too high for any price to reach a 25% margin.`,
      expectedEffect: sim ? { text: `At ${units} units/month with unchanged volume: profit ${sim.profitBefore} → ${sim.profitAfter} ${cur}. Volume may fall at a higher price — test it.`, value: r2(sim.profitAfter - sim.profitBefore) } : { text: 'Cannot estimate — fee/return rates leave no room for a 25% margin.', value: null },
      simulation: targetPrice ? { kind: 'price', newPrice: targetPrice, unitsBefore: units, unitsAfter: units, result: sim } : null,
      apply: targetPrice ? { field: 'price', value: targetPrice, label: `Set the planned price to ${targetPrice} ${cur}` } : null,
      assumptions: ['Volume unchanged in the headline estimate; use the simulator to model lower volume.', 'Costs per unit as currently configured in Economics.'],
      risks: ['A higher price may reduce conversion; change one variable at a time.'],
      test: 'Run the new price for 2–4 weeks (or on one channel) and compare units sold and profit per week with the baseline.',
    }));
  }

  // Scenario C — traffic but few sales (only with recorded visit data)
  const visitRows = all('SELECT channel, SUM(visits) AS visits FROM channel_metrics WHERE project_id = ? GROUP BY channel', project.id);
  for (const v of visitRows) {
    const orders = m.sales.filter((s) => s.channel === v.channel).length;
    if (v.visits >= 100 && orders / v.visits < 0.01) {
      out.push(rec({
        rule: `low_conversion:${v.channel}`, priority: 65, severity: 'medium',
        title: `Many visits but few orders on ${v.channel}`,
        observation: `${v.visits} recorded visits produced ${orders} orders (${r2((orders / v.visits) * 100)}% conversion).`,
        evidence: [{ label: 'Visits (recorded)', value: v.visits }, { label: 'Orders', value: orders }],
        whyItMatters: 'People are interested enough to look, so the listing itself may be what stops them buying.',
        action: 'Test one change at a time: a better main photo, clearer dimensions and delivery info, or a price/bundle variation.',
        expectedEffect: { text: `Reaching 2% conversion at the same traffic would mean ~${Math.round(v.visits * 0.02) - orders} extra orders for the same period — a hypothesis, not a forecast.`, value: null },
        simulation: null, apply: null,
        assumptions: ['Visit numbers as entered or imported for this channel.'],
        risks: ['Traffic quality may simply be low; improving the listing will not help mismatched visitors.'],
        test: 'Change only the main photo for 14 days and compare conversion with the previous 14 days.',
      }));
    }
  }

  // Scenario D — supplier too expensive
  const purchases = all('SELECT * FROM purchases WHERE project_id = ?', project.id);
  for (const p of purchases) {
    const opts = parseJSON(p.options, []).filter((o) => o.price != null && o.compatible !== false);
    const chosen = parseJSON(p.chosen_option, null);
    if (chosen?.price != null && opts.length > 1) {
      const cheapest = opts.reduce((a, b) => ((a.price / (a.packQuantity || 1)) <= (b.price / (b.packQuantity || 1)) ? a : b));
      const chosenUnit = chosen.price / (chosen.packQuantity || 1);
      const cheapUnit = cheapest.price / (cheapest.packQuantity || 1);
      if (cheapUnit < chosenUnit * 0.85) {
        const perProductUnit = r2((chosenUnit - cheapUnit) * (p.quantity || 1));
        out.push(rec({
          rule: `supplier:${p.id}`, priority: 55, severity: 'low',
          title: `A cheaper compatible source exists for ${p.name}`,
          observation: `Chosen: ${r2(chosenUnit)} per unit (${chosen.supplier}). Cheapest compatible option: ${r2(cheapUnit)} per unit (${cheapest.supplier}).`,
          evidence: [{ label: 'Chosen unit price', value: r2(chosenUnit) }, { label: 'Cheapest unit price', value: r2(cheapUnit) }],
          whyItMatters: 'Material cost repeats on every unit you make.',
          action: `Switch ${p.name} to ${cheapest.supplier} after checking quality and delivery time.`,
          expectedEffect: { text: `Saves ~${perProductUnit} ${cur} per finished unit (${r2(perProductUnit * e.batchQty)} per ${e.batchQty}-unit batch), before shipping differences.`, value: perProductUnit },
          simulation: null, apply: null,
          assumptions: ['Prices as recorded in your sourcing options; they may have changed.'],
          risks: ['Lower quality or slower delivery may cost more than it saves.'],
          test: 'Order one pack, compare quality and actual landed cost before switching fully.',
        }));
      }
    }
  }

  // Scenario E — a channel performs poorly
  const byCh = new Map();
  for (const s of m.sales) {
    const g = byCh.get(s.channel) || { units: 0, profit: 0 };
    g.units += s.quantity;
    g.profit += s.profit;
    byCh.set(s.channel, g);
  }
  const chans = [...byCh.entries()].filter(([, g]) => g.units >= 3).map(([k, g]) => ({ k, ppu: g.profit / g.units, units: g.units }));
  if (chans.length >= 2) {
    chans.sort((a, b) => b.ppu - a.ppu);
    const best = chans[0];
    const worst = chans[chans.length - 1];
    if (worst.ppu < best.ppu * 0.5) {
      out.push(rec({
        rule: 'channel_gap', priority: 60, severity: 'medium',
        title: `${worst.k} earns much less per unit than ${best.k}`,
        observation: `Profit per unit: ${best.k} ${r2(best.ppu)} ${cur} vs ${worst.k} ${r2(worst.ppu)} ${cur}.`,
        evidence: chans.map((c) => ({ label: `${c.k} (${c.units} units)`, value: `${r2(c.ppu)} ${cur}/unit` })),
        whyItMatters: 'Fees, shipping or discounts on the weaker channel are eating into profit.',
        action: `Shift more stock or effort to ${best.k}, or adjust the price on ${worst.k} to cover its costs.`,
        expectedEffect: { text: `Moving ${worst.units} units to ${best.k} would add ~${r2((best.ppu - worst.ppu) * worst.units)} ${cur}, if ${best.k} can absorb that volume.`, value: r2((best.ppu - worst.ppu) * worst.units) },
        simulation: null, apply: null,
        assumptions: ['Past per-unit profit is representative of each channel.'],
        risks: [`${best.k} demand may not scale; ${worst.k} may reach different customers.`],
        test: `For 30 days, prioritise ${best.k} and record whether total profit rises.`,
      }));
    }
  }

  // Scenario F — weak demand
  const listedLike = ['listed', 'selling', 'needs_improvement', 'ready_to_sell'].includes(project.status);
  const ageDays = (Date.now() - new Date(project.createdAt)) / DAY;
  if (listedLike && ageDays > 21 && m.sold30 < 3) {
    out.push(rec({
      rule: 'weak_demand', priority: 70, severity: 'medium',
      title: 'Demand looks weak so far',
      observation: `${m.sold30} unit(s) sold in the last 30 days while the product is ${project.status.replace(/_/g, ' ')}.`,
      evidence: [{ label: 'Units sold (30 days)', value: m.sold30 }, { label: 'Units on hand', value: m.onHand }],
      whyItMatters: 'Buying more materials before demand is proven puts cash at risk.',
      action: 'Do not buy more batch materials yet. Run a cheap validation: a pre-order post, a different channel, or a market day with the existing stock.',
      expectedEffect: { text: `Avoids ~${m.econ.batch.cashOutlay} ${cur} of batch spending until demand is confirmed.`, value: m.econ.batch.cashOutlay },
      simulation: null, apply: null,
      assumptions: ['Sales are fully recorded in ConstraintForge.'],
      risks: ['Low sales may reflect low visibility rather than low demand.'],
      test: 'Aim for 5 pre-orders or inquiries within 14 days; if not reached, revise the product or audience.',
    }));
  }
  if (listedLike && m.sales.length === 0 && ageDays > 7) {
    out.push(rec({
      rule: 'no_data', priority: 40, severity: 'low',
      title: 'No sales recorded yet',
      observation: 'This product is marked as for sale but has no recorded sales or visit data.',
      evidence: [{ label: 'Recorded sales', value: 0 }],
      whyItMatters: 'The advisor can only diagnose what is recorded.',
      action: 'Record each sale (or import a CSV), and enter listing views/visits per channel weekly if your platform shows them.',
      expectedEffect: { text: 'Enables margin, channel and demand diagnostics.', value: null },
      simulation: null, apply: null, assumptions: [], risks: [],
      test: 'After 2 weeks of recording, re-run the advisor.',
    }));
  }

  // Scenario G — selling well
  if (m.sold30 >= 5 && m.onHand <= Math.max(2, m.sold30 * 0.5)) {
    const toQty = Math.round(Math.max(e.batchQty, m.sold30) * 1.5);
    const sim = simulateBatchChange(allocatedBom(project), e, { fromQty: e.batchQty, toQty, expectedSales: Math.round(m.sold30 * 1.2) });
    out.push(rec({
      rule: 'selling_well', priority: 75, severity: 'opportunity',
      title: 'Selling well — stock may run out',
      observation: `${m.sold30} units sold in 30 days with only ${m.onHand} on hand.`,
      evidence: [{ label: 'Units sold (30 days)', value: m.sold30 }, { label: 'On hand', value: m.onHand }, { label: 'Profit (30 days)', value: `${m.profit30} ${cur}` }],
      whyItMatters: 'Stock-outs lose sales and momentum on marketplaces.',
      action: `Increase the next batch gradually to ~${toQty}, ask your main supplier for a quantity discount, and consider a related product for the same buyers.`,
      expectedEffect: { text: `Needs ${Math.abs(sim.cashSaved)} ${cur} more cash for the batch; unsold exposure if sales hold at +20%: ${sim.inventoryExposureAfter} ${cur}.`, value: -sim.cashSaved },
      simulation: { kind: 'batch', fromQty: e.batchQty, toQty, expectedSales: Math.round(m.sold30 * 1.2), result: sim },
      apply: { field: 'batchQty', value: toQty, label: `Set the planned batch size to ${toQty}` },
      assumptions: ['Recent demand continues at about the same level.'],
      risks: ['Demand spikes can be temporary; scale in steps.'],
      test: 'Track sell-through of the larger batch; keep on-hand stock at 2–4 weeks of sales.',
    }));
  }

  return out.map((r) => ({ ...r, id: `${r.rule}:${project.id}`, projectId: project.id, projectName: project.name, isExample: project.isExample }));
}

/**
 * What the analysis is based on, computed from recorded data only. Always returned, so pressing
 * "Analyze" has a visible, checkable outcome — including "there is no sales data yet".
 */
function analysisSummary(includeExamples) {
  const a = computeAnalytics({ includeExamples });
  const dates = a.sales.map((s) => s.date).sort();
  const t = a.totals;
  return {
    hasData: a.sales.length > 0,
    salesRecords: a.sales.length,
    exampleRecords: a.sales.filter((s) => s.source === 'example').length,
    from: dates[0] || null,
    to: dates.at(-1) || null,
    totals: { revenue: t.revenue, costs: Math.round((t.cogs + t.fees + t.shipping + t.ads + t.refunds + t.otherExpenses) * 100) / 100, netProfit: t.netProfit, units: t.units, orders: t.orders, marginPct: t.marginPct, salesWithoutCost: t.salesWithoutCost },
    byProduct: a.byProduct.slice(0, 6).map(({ key, units, revenue, profit }) => ({ name: key, units, revenue, profit })),
    byChannel: a.byChannel.slice(0, 6).map(({ key, units, revenue, profit }) => ({ name: key, units, revenue, profit })),
    onHand: a.inventory.filter((i) => includeExamples || !i.isExample).reduce((s, i) => s + Math.max(0, i.onHand), 0),
  };
}

export async function runAdvisor(settings, { includeExamples = true, withAI = true } = {}) {
  const summary = analysisSummary(includeExamples);
  const all_ = listProjects().filter((p) => p.status !== 'archived' && (includeExamples || !p.isExample));
  const projects = all_.filter((p) => p.plan);
  const fresh = projects.flatMap((p) => diagnose(p, settings));
  summary.productsAnalysed = projects.length;
  summary.productsWithoutPlan = all_.length - projects.length;

  let narrative = null;
  // The model only explains numbers the app computed; with no recorded sales there is nothing to explain.
  if (withAI && aiEnabled() && summary.hasData) {
    try {
      narrative = await structured({
        system: SYSTEM_ADVISOR,
        content: `Currency: ${settings.currency}\nRecorded results (computed by the app, JSON):\n${JSON.stringify({ salesRecords: summary.salesRecords, period: [summary.from, summary.to], totals: summary.totals, byProduct: summary.byProduct, byChannel: summary.byChannel, unitsOnHand: summary.onHand })}\n\nDiagnostics (JSON):\n${JSON.stringify(fresh.map(({ id, title, observation, evidence, action, expectedEffect, assumptions, risks }) => ({ id, title, observation, evidence, action, expectedEffect: expectedEffect.text, assumptions, risks })))}\n\nIn "overall", explain in 2–3 short sentences what these recorded results show. Use only the numbers given.`,
        schema: AdvisorNarrative,
        effort: 'low',
        maxTokens: 1200,
        label: 'advisor',
      });
    } catch (err) {
      narrative = { error: err.message };
    }
  }

  for (const r of fresh) {
    const ai = narrative?.items?.find((i) => i.id === r.id);
    const payload = { ...r, aiExplanation: ai?.explanation || null, aiIdeas: ai?.extraIdeas || [] };
    const existing = get('SELECT * FROM recommendations WHERE id = ?', r.id);
    if (!existing) {
      run('INSERT INTO recommendations (id, project_id, rule, priority, payload, status, created_at) VALUES (?,?,?,?,?,?,?)', r.id, r.projectId, r.rule, r.priority, JSON.stringify(payload), 'proposed', now());
    } else if (existing.status === 'proposed') {
      run('UPDATE recommendations SET payload = ?, priority = ? WHERE id = ?', JSON.stringify(payload), r.priority, r.id);
    }
  }
  const activeIds = new Set(fresh.map((r) => r.id));
  // Proposed recommendations whose condition no longer holds are removed; decided ones are kept as history.
  for (const row of all("SELECT id FROM recommendations WHERE status = 'proposed'")) {
    if (!activeIds.has(row.id)) run('DELETE FROM recommendations WHERE id = ?', row.id);
  }
  return { engine: aiEnabled() ? 'ai' : 'rules', ranAt: new Date().toISOString(), summary, diagnosticsFound: fresh.length, overall: narrative?.overall || null, aiError: narrative?.error || null, ...listRecommendations() };
}

export function listRecommendations() {
  const rows = all('SELECT * FROM recommendations ORDER BY CASE status WHEN \'proposed\' THEN 0 ELSE 1 END, priority DESC, created_at DESC');
  return {
    recommendations: rows.map((r) => {
      const payload = parseJSON(r.payload, {});
      const project = r.project_id ? getProject(r.project_id) : null;
      let results = null;
      if (r.decided_at && project && r.status !== 'rejected') {
        const m = projectMetrics(project, r.decided_at);
        const base = parseJSON(r.baseline, null);
        results = { since: m.since, baseline: base, per30: m.since ? { units: r2((m.since.units / m.since.days) * 30), profit: r2((m.since.profit / m.since.days) * 30) } : null };
      }
      return { ...payload, id: r.id, status: r.status, decisionNote: r.decision_note, decidedAt: r.decided_at, baseline: parseJSON(r.baseline, null), results };
    }),
  };
}

export function decide(id, { decision, note, apply }) {
  const row = get('SELECT * FROM recommendations WHERE id = ?', id);
  if (!row) throw Object.assign(new Error('Recommendation not found'), { status: 404 });
  const payload = parseJSON(row.payload, {});
  const project = getProject(row.project_id);
  const baseline = project ? snapshot(project) : null;
  let status = decision === 'approve' ? 'approved' : 'rejected';
  if (decision === 'approve' && apply && payload.apply && project) {
    const econ = { ...project.economics, [payload.apply.field]: payload.apply.value };
    // Recompute to make sure the applied value is valid before saving.
    computeEconomics(allocatedBom(project), econ);
    run('UPDATE projects SET economics = ?, updated_at = ? WHERE id = ?', JSON.stringify(econ), now(), project.id);
    status = 'applied';
    logActivity('advisor', `Applied: ${payload.apply.label} (${project.name})`, project.id);
  } else {
    logActivity('advisor', `${status === 'approved' ? 'Approved' : 'Rejected'}: ${payload.title}`, row.project_id);
  }
  run('UPDATE recommendations SET status = ?, decision_note = ?, decided_at = ?, baseline = ? WHERE id = ?', status, note || null, now(), JSON.stringify(baseline), id);
  return listRecommendations();
}
