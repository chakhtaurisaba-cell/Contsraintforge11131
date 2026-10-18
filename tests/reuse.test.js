// Reuse-first behaviour (requirement tests D–G) against the real example-project engine and
// allocator. AI-generated ideas are covered in ideation-pipeline.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, bomWithAllocation, convertQty } from '../shared/allocation.js';
import { computeEconomics } from '../shared/economics.js';
import { generatePlan } from '../server/services/ideation.js';

const board = (qty = 6) => ({ id: 'b', name: 'Pine boards', material: 'Pine wood', quantity: qty, unit: 'pcs', dimensions: { length: 1200, width: 150, thickness: 18, unit: 'mm', status: 'user_confirmed' }, unit_value: 10 });
const screws = (qty = 100) => ({ id: 's', name: 'Wood screws 4x40', material: 'Steel', quantity: qty, unit: 'pcs' });
const brackets = (qty = 10) => ({ id: 'k', name: 'Steel L-brackets', material: 'Steel', quantity: qty, unit: 'pcs' });
const plugs = (qty = 20) => ({ id: 'p', name: 'Wall plugs with screws', material: 'Nylon', quantity: qty, unit: 'sets' });
const plan = async (templateId, inventory, batchQty = 1) => {
  const p = await generatePlan({ idea: { templateId, engine: 'demo' } }, inventory, 'GEL');
  return { p, a: allocate(p.bom, inventory, batchQty) };
};

test('D — owns everything: shelf plan needs no purchases', async () => {
  const inv = [board(), screws(), brackets(), plugs()];
  const { a } = await plan('wall_shelf', inv, 2);
  assert.equal(a.everythingOwned, true, JSON.stringify(a.purchases));
  assert.deepEqual(a.purchases, []);
  // The finish is an optional upgrade, never on the shopping list.
  assert.ok(a.lines.some((l) => l.status === 'optional_upgrade'));
  // Boards must be cut, so the line says how (adaptation), not "buy".
  assert.equal(a.lines.find((l) => l.name === 'Pine boards').status, 'available_with_adaptation');
});

test('E — partial shortage: only the exact remainder is bought, and a smaller batch is offered', async () => {
  const inv = [board(), screws(14), brackets(), plugs()];
  const { a } = await plan('wall_shelf', inv, 2); // needs 16 screws
  const line = a.lines.find((l) => l.name.includes('screws'));
  assert.equal(line.status, 'insufficient');
  assert.equal(line.shortage, 2, 'exactly two screws short');
  assert.deepEqual(a.purchases.map((p) => [p.name, p.quantity]), [[line.name, 2]]);
  assert.equal(a.reduceBatchTo, 1, 'one unit can be built with no purchase');
});

test('F — substitution: owned nails replace screws in the organiser', async () => {
  const inv = [board(), { id: 'n', name: 'Brad nails 30 mm', material: 'Steel', quantity: 200, unit: 'pcs' }];
  const { a } = await plan('desk_organizer', inv, 3);
  const fasteners = a.lines.find((l) => l.whyNeeded.includes('butt joints'));
  assert.equal(fasteners.status, 'substitutable');
  assert.match(fasteners.note, /Brad nails/);
  assert.ok(!a.purchases.some((p) => /screw/i.test(p.name)), 'no screws purchased');
});

test('F — design adaptation: no brackets → gusset shelf cut from owned boards', async () => {
  const { p, a } = await plan('wall_shelf', [board(), screws(), plugs()], 1);
  assert.equal(p.adaptedFrom, 'Bracket-mounted shelf');
  assert.ok(p.components.some((c) => c.id === 'gusset'));
  assert.ok(!a.purchases.some((x) => /bracket/i.test(x.name)), 'brackets not bought');
  assert.equal(a.everythingOwned, true);
});

test('G — genuine requirement: wall fixings have no unsafe substitute and are explained', async () => {
  const { a } = await plan('wall_shelf', [board(), screws(), brackets()], 1);
  const fix = a.lines.find((l) => l.status === 'required_purchase');
  assert.ok(fix, 'a required purchase exists');
  assert.match(fix.note, /wall type/i);
  assert.equal(a.purchases.length, 1);
  assert.match(a.purchases[0].reason, /wall type/i);
});

test('stock reserved by another project is not counted twice', () => {
  const bom = [{ name: 'Pine board', quantity: 1, unit: 'board', matchKey: 'wood_board', unitPrice: 10 }];
  const a = allocate(bom, [board(6)], 4, { b: 4 }); // 4 of 6 boards held by another committed project
  assert.equal(a.lines[0].shortage, 2);
});

test('economics: partly-owned line costs only the shortage in cash', () => {
  const bom = [{ name: 'Screws', quantity: 10, unit: 'pcs', matchKey: 'screws', unitPrice: 0.1 }];
  const a = allocate(bom, [screws(15)], 2); // 15 of 20 owned
  const e = computeEconomics(bomWithAllocation(bom, a), { price: 10 });
  assert.equal(e.perUnit.materialCash, 0.25);
  assert.equal(e.perUnit.materialOwnedValue, 0.75);
});

test('units: lengths convert, incomparable units ask for confirmation instead of buying', () => {
  assert.equal(convertQty(250, 'cm', 'm'), 2.5);
  const bom = [{ name: 'Cotton rope', quantity: 6, unit: 'm', matchKey: 'rope', unitPrice: 0.4 }];
  const a = allocate(bom, [{ id: 'r', name: 'Cotton rope', quantity: 1, unit: 'roll' }], 1);
  assert.equal(a.purchases.length, 0);
  assert.equal(a.lines[0].needsConfirmation, true);
});
