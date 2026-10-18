import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEconomics, simulateBatchChange, priceSensitivity } from '../shared/economics.js';
import { compareOptions } from '../shared/sourcing.js';
import { packCuts } from '../server/engine/cutlist.js';
import { parseFreeText, matchesKey } from '../server/engine/lexicon.js';
import { applyKnownMeasurement } from '../server/services/vision.js';
import { verifyHmac } from '../server/services/shopify.js';

const bom = [
  { name: 'Board', quantity: 0.5, unitPrice: 10, owned: true },
  { name: 'Screws', quantity: 8, unitPrice: 0.1, owned: false },
];

test('economics: cash vs owned materials and net profit', () => {
  const r = computeEconomics(bom, { price: 30, packagingPerUnit: 1, marketplaceFeePct: 10, shippingPerUnit: 2, includeOwnedValue: true });
  assert.equal(r.perUnit.materialCash, 0.8);
  assert.equal(r.perUnit.materialOwnedValue, 5);
  assert.equal(r.perUnit.productionCost, 6.8); // 0.8 + 5 + 1
  assert.equal(r.perUnit.fees, 3);
  assert.equal(r.perUnit.netProfit, 18.2); // 30 - 3 - 6.8 - 2
  const noOwned = computeEconomics(bom, { price: 30, includeOwnedValue: false });
  assert.equal(noOwned.perUnit.productionCost, 0.8);
});

test('economics: break-even price yields zero profit', () => {
  const inputs = { price: 20, packagingPerUnit: 1, marketplaceFeePct: 12, paymentFeePct: 3, paymentFixedFee: 0.3, returnRatePct: 5, shippingPerUnit: 1.5 };
  const r = computeEconomics(bom, inputs);
  const atBE = computeEconomics(bom, { ...inputs, price: r.breakEvenPrice });
  assert.ok(Math.abs(atBE.perUnit.netProfit) < 0.02, `profit at break-even was ${atBE.perUnit.netProfit}`);
});

test('economics: impossible break-even when fees + returns ≥ 100%', () => {
  const r = computeEconomics(bom, { price: 10, marketplaceFeePct: 80, returnRatePct: 25 });
  assert.equal(r.breakEvenPrice, null);
});

test('economics: batch simulation reports cash saved', () => {
  const s = simulateBatchChange(bom, { price: 30, packagingPerUnit: 1 }, { fromQty: 100, toQty: 20, expectedSales: 15 });
  assert.equal(s.cashOutlayBefore, 180); // 100 × (0.8 + 1)
  assert.equal(s.cashOutlayAfter, 36);
  assert.equal(s.cashSaved, 144);
  assert.equal(s.unsoldAfter, 5);
});

test('economics: sensitivity is monotonic in price', () => {
  const pts = priceSensitivity(bom, { marketplaceFeePct: 10 }, [10, 20, 30]);
  assert.ok(pts[0].netProfit < pts[1].netProfit && pts[1].netProfit < pts[2].netProfit);
});

test('cut list: packs pieces with kerf and reports boards needed', () => {
  const r = packCuts([{ id: 'a', name: 'A', length: 600, width: 100, qty: 3 }], { length: 1200, width: 150, thickness: 18 });
  // usable 1190 mm; each piece takes 603 mm → one per board for 2nd piece? 603 + 603 = 1206 > 1190 → 3 boards
  assert.equal(r.boardsNeeded, 3);
  const r2 = packCuts([{ id: 'a', name: 'A', length: 500, width: 100, qty: 2 }], { length: 1200, width: 150, thickness: 18 });
  assert.equal(r2.boardsNeeded, 1);
  const wide = packCuts([{ id: 'w', name: 'Wide', length: 300, width: 200, qty: 1 }], { length: 1200, width: 150, thickness: 18 });
  assert.equal(wide.warnings.length, 1);
});

test('sourcing: best option accounts for pack size and shipping, not just sticker price', () => {
  const opts = [
    { id: 'cheap-sticker', supplier: 'A', price: 5, packQuantity: 10, shippingCost: 20, currency: 'GEL' },
    { id: 'pricier-sticker', supplier: 'B', price: 9, packQuantity: 50, shippingCost: 0, currency: 'GEL' },
  ];
  const r = compareOptions(opts, 40, { currency: 'GEL' });
  // A: 4 packs × 5 + 20 = 40 ; B: 1 pack × 9 = 9
  assert.equal(r.bestId, 'pricier-sticker');
  assert.equal(r.ranked.find((o) => o.id === 'cheap-sticker').totalCost, 40);
});

test('lexicon: wood screws are not matched as wood boards', () => {
  assert.equal(matchesKey({ name: 'Wood screws' }, 'wood_board'), false);
  assert.equal(matchesKey({ name: 'Wood screws' }, 'screws'), true);
  assert.equal(matchesKey({ name: 'Pine plank' }, 'wood_board'), true);
});

test('free-text parser extracts budget, currency, hours and tools', () => {
  const p = parseFreeText('I have wooden boards, screws, a drill, sandpaper, and 100 GEL. I can work two hours every evening.');
  assert.equal(p.budget, 100);
  assert.equal(p.currency, 'GEL');
  assert.equal(p.hoursPerWeek, 10);
  assert.ok(p.tools.includes('Drill / driver'));
  assert.ok(p.materials.some((m) => m.name.includes('board')));
});

test('vision: known measurement rescales objects in the same image only', () => {
  const objects = [
    { name: 'Pine board', imageIndex: 0, dimensions: { length: 1000, width: 100, unit: 'mm', method: 'ai_inferred', uncertaintyPct: 40 } },
    { name: 'Bracket', imageIndex: 0, dimensions: { length: 100, unit: 'mm', method: 'ai_inferred', uncertaintyPct: 40 } },
    { name: 'Jar', imageIndex: 1, dimensions: { height: 90, unit: 'mm', method: 'ai_inferred', uncertaintyPct: 40 } },
  ];
  const { objects: out, applied, factor } = applyKnownMeasurement(objects, { objectName: 'board', dimension: 'length', value: 1200, unit: 'mm' });
  assert.equal(applied, true);
  assert.equal(factor, 1.2);
  assert.equal(out[0].dimensions.length, 1200);
  // Width was only scaled from the user's length, so the item is labelled calibrated, not confirmed.
  assert.equal(out[0].dimensions.method, 'reference_calibrated');
  assert.deepEqual(out[0].dimensions.confirmedDims, ['length']);
  const solo = applyKnownMeasurement([{ name: 'Rod', imageIndex: 0, dimensions: { length: 500, unit: 'mm', method: 'ai_inferred', uncertaintyPct: 40 } }], { objectName: 'rod', dimension: 'length', value: 610, unit: 'mm' });
  assert.equal(solo.objects[0].dimensions.method, 'user_confirmed', 'only size → confirmed');
  assert.equal(out[1].dimensions.length, 120);
  assert.equal(out[1].dimensions.method, 'reference_calibrated');
  assert.equal(out[2].dimensions.height, 90); // other image untouched
});

test('shopify: HMAC verification rejects tampered queries', () => {
  // Without a configured secret the digest cannot match a random hmac.
  assert.equal(verifyHmac({ shop: 'x.myshopify.com', code: 'abc', hmac: 'deadbeef' }), false);
  assert.equal(verifyHmac({ shop: 'x.myshopify.com' }), false);
});
