// Loads clearly-labelled EXAMPLE projects (is_example = 1, sales source = 'example')
// so new users can explore analytics and the advisor. Examples can be excluded from
// all totals and removed in one click; they are never mixed into real figures silently.
import { run, all, now, uid, transaction, logActivity } from '../db.js';
import { generatePlan } from './ideation.js';
import { TEMPLATES } from '../engine/templates.js';
import { fromUSD } from '../engine/units.js';

const dayISO = (daysBack) => new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);

async function makeProject(templateId, currency, { status, economics, produced, productionDaysAgo, sales }) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  const idea = { templateId, engine: 'demo', name: t.name, tagline: t.tagline, description: t.description, category: t.category, visualShape: t.visualShape, difficulty: t.difficulty, targetCustomers: t.customers, channels: t.channels, priceLow: fromUSD(t.priceUSD[0], currency), priceHigh: fromUSD(t.priceUSD[1], currency) };
  const plan = await generatePlan({ idea }, [], currency);
  const id = uid();
  const created = dayISO(70);
  run(
    'INSERT INTO projects (id, name, status, is_example, idea, plan, economics, progress, notes, units_produced, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, `${t.name} (example)`, status, 1, JSON.stringify(idea), JSON.stringify(plan), JSON.stringify({ ...economics, price: fromUSD(economics.priceUSD, currency), packagingPerUnit: plan.packagingPerUnit, laborMinutesPerUnit: plan.laborMinutesPerUnit }),
    JSON.stringify({ completedSteps: plan.steps.map((s) => s.id), stepNotes: {} }), JSON.stringify([{ id: uid(), text: 'Example project with simulated data — not your real business.', created_at: now() }]), produced, created, now()
  );
  run('INSERT INTO production (id, project_id, date, quantity, note, created_at) VALUES (?,?,?,?,?,?)', uid(), id, dayISO(productionDaysAgo), produced, 'Example batch', now());
  for (const s of sales) {
    const price = fromUSD(s.priceUSD, currency);
    run(
      'INSERT INTO sales (id, project_id, date, channel, quantity, unit_price, fees, shipping_cost, ad_cost, refund, returned_units, currency, note, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid(), id, dayISO(s.daysAgo), s.channel, s.qty, price, Math.round(price * s.qty * (s.feePct || 0)) / 100, fromUSD(s.shipUSD || 0, currency), 0, 0, 0, currency, 'Example sale', 'example', now()
    );
  }
  return id;
}

export async function loadExamples(currency = 'GEL') {
  if (all('SELECT id FROM projects WHERE is_example = 1').length) return { loaded: false, message: 'Examples are already loaded.' };
  // Example 1: shelves — overproduced, slow sales, thin margin on a marketplace.
  const shelfSales = [50, 44, 37, 30, 18, 9].map((d, i) => ({ daysAgo: d, qty: 1, channel: i % 2 ? 'Handmade marketplace' : 'Local classifieds', priceUSD: 22, feePct: i % 2 ? 12 : 0, shipUSD: i % 2 ? 6 : 0 }));
  await makeProject('wall_shelf', currency, { status: 'selling', produced: 30, productionDaysAgo: 55, sales: shelfSales, economics: { priceUSD: 22, batchQty: 30, marketplaceFeePct: 0, includeOwnedValue: true } });
  // Example 2: desk organiser — selling well, low stock.
  const orgSales = [];
  for (let d = 28; d >= 1; d -= 3) orgSales.push({ daysAgo: d, qty: 1 + (d % 2), channel: d % 3 === 0 ? 'Instagram DM' : 'Craft market', priceUSD: 19, feePct: 0, shipUSD: 0 });
  await makeProject('desk_organizer', currency, { status: 'selling', produced: 20, productionDaysAgo: 30, sales: orgSales, economics: { priceUSD: 19, batchQty: 12 } });
  logActivity('examples', 'Loaded example projects (simulated data)');
  return { loaded: true };
}

export function removeExamples() {
  transaction(() => {
    run("DELETE FROM recommendations WHERE project_id IN (SELECT id FROM projects WHERE is_example = 1)");
    run('DELETE FROM projects WHERE is_example = 1');
    run("DELETE FROM sales WHERE source = 'example'");
  });
  logActivity('examples', 'Removed example projects');
  return { removed: true };
}
