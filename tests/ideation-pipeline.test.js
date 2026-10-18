// Ideation pipeline (requirement tests 1, 4, 5, 8) against a LOCAL MOCK of the Ollama API.
// The mock plays the model; everything after it — input validation, reuse-first
// reconciliation of the model's shopping list against real stock, scoring, honest
// errors — is the real application code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startOllamaMock, useMock } from './ollama-mock.js';

const idea = (o = {}) => ({
  name: 'Bracket wall shelf', summary: 'A small wall shelf.', category: 'Home & storage', primaryMaterial: 'Pine boards',
  usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'shelf board' }],
  missing: [], substitutions: [], optionalUpgrades: [], toolsRequired: ['Drill / driver'],
  difficulty: 'beginner', estProductionMinutes: 60, size: { length: 600, width: 150, height: 150 }, priceLow: 40, priceHigh: 60,
  targetCustomers: ['renters'], safetyNote: '', dependsOnMeasurements: [], visualKind: 'wall_shelf',
  ...o,
});
let extraIdeas = [];

let mode = 'ok';
let mock;
let ideation;

before(async () => {
  mock = await startOllamaMock((body) => {
    if (mode === 'down') return { status: 500, error: 'llama-server process has terminated' };
    const sys = body.messages[0].content;
    const user = body.messages.at(-1).content;
    if (sys.startsWith('You extract a structured inventory')) {
      if (/^[a-z]{6,}$/.test(user.trim())) return JSON.stringify({ recognized: false, unrecognizedReason: 'Random letters, no objects.', materials: [], tools: [], skills: [], budget: null, currency: null, hoursPerWeek: null });
      if (/^some /.test(user)) return JSON.stringify({ recognized: true, unrecognizedReason: '', materials: [{ name: 'wooden boards', material: 'wood', quantity: 0, quantityStated: false, unit: 'pcs' }, { name: 'screws', material: 'steel', quantity: 0, quantityStated: false, unit: 'pcs' }, { name: 'metal brackets', material: 'steel', quantity: 0, quantityStated: false, unit: 'pcs' }], tools: [], skills: [], budget: null, currency: null, hoursPerWeek: null });
      return JSON.stringify({ recognized: true, unrecognizedReason: '', materials: [{ name: 'wooden boards', material: 'wood', quantity: 4, quantityStated: true, unit: 'pcs' }, { name: 'screws', material: 'steel', quantity: 50, quantityStated: true, unit: 'pcs' }, { name: 'metal brackets', material: 'steel', quantity: 4, quantityStated: true, unit: 'pcs' }], tools: ['drill'], skills: [], budget: null, currency: null, hoursPerWeek: null });
    }
    if (sys.startsWith('You are the product-ideation engine')) {
      if (mode === 'empty') return JSON.stringify({ ideas: [], notes: 'Nothing possible.' });
      // A careless model: it lists screws and brackets as "missing" although the user owns them,
      // plus one genuinely missing part.
      return JSON.stringify({
        ideas: [
          idea({ missing: [
            { name: 'Wood screws', quantity: 8, unit: 'pcs', estUnitPrice: 0.2, why: 'fix brackets' },
            { name: 'L-brackets', quantity: 2, unit: 'pcs', estUnitPrice: 3, why: 'hold the shelf' },
            { name: 'Wall plugs', quantity: 4, unit: 'pcs', estUnitPrice: 0.3, why: 'fix to the wall — depends on wall type' },
          ] }),
          idea({ name: 'Plant stand', visualKind: 'stand' }),
          idea({ name: 'Plant Stand!', visualKind: 'stand' }), // a repeat a small model may produce
          ...extraIdeas,
        ],
        notes: '',
      });
    }
    return '{}';
  });
  useMock(mock);
  ideation = await import('../server/services/ideation.js');
});
after(() => mock.close());

const pine = { id: 'b', name: 'Pine boards', material: 'Pine wood', quantity: 6, unit: 'pcs', dimensions: null };
const screws = { id: 's', name: 'Wood screws 4x40', material: 'Steel', quantity: 100, unit: 'pcs' };
const brackets = { id: 'k', name: 'Steel L-brackets', material: 'Steel', quantity: 10, unit: 'pcs' };

test('1 — meaningless text produces no ideas, only a request for a real description', async () => {
  mode = 'ok';
  mock.calls = [];
  const r = await ideation.generateIdeas({ freeText: 'sydvfyqwdq', currency: 'GEL' }, [pine]);
  assert.equal(r.status, 'unrecognized');
  assert.deepEqual(r.ideas, []);
  assert.match(r.message, /couldn’t recognise/);
  assert.equal(mock.calls.length, 1, 'stops after the parse — never falls back to saved inventory or templates');
});

test('1 — text without any letters is rejected before calling the model', async () => {
  mock.calls = [];
  const r = await ideation.generateIdeas({ freeText: '12345 !!! ###', currency: 'GEL' }, []);
  assert.equal(r.status, 'unrecognized');
  assert.equal(mock.calls.length, 0);
});

test('4 — owned materials are reused: the model’s shopping list is cut to what is genuinely missing', async () => {
  const r = await ideation.generateIdeas({ quantity: 2, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  assert.equal(r.status, 'ok');
  const shelf = r.ideas.find((i) => i.name === 'Bracket wall shelf');
  assert.ok(!shelf.missing.some((m) => /screw/i.test(m.name)), `owned screws must not be bought: ${JSON.stringify(shelf.missing)}`);
  assert.ok(!shelf.missing.some((m) => /bracket/i.test(m.name)), 'owned brackets must not be bought');
  assert.ok(shelf.usesExisting.some((u) => u.inventoryName === 'Wood screws 4x40'));
  assert.equal(r.ideas[0].engine, 'ai');
  assert.equal(r.ideas[0].name, 'Plant stand', 'buildable now ranks above an idea with something to buy');
  assert.equal(r.ideas[0].verdict, 'ready');
  assert.equal(shelf.verdict, 'short');
  assert.equal(r.ideas.length, 2, 'a repeated idea is dropped, not shown twice');
});

test('5 — a genuinely missing part stays on the list, with its exact quantity', async () => {
  const r = await ideation.generateIdeas({ quantity: 2, currency: 'GEL' }, [pine, screws, brackets]);
  const shelf = r.ideas.find((i) => i.name === 'Bracket wall shelf');
  const plugs = shelf.missing.find((m) => /wall plug/i.test(m.name));
  assert.ok(plugs, 'wall plugs are genuinely missing');
  assert.equal(plugs.quantity, 8, '4 per unit × 2-unit test batch');
  assert.equal(shelf.nothingToBuy, false);
});

test('4 — free-text materials are reused, never bought', async () => {
  const r = await ideation.generateIdeas({ freeText: 'I have 4 wooden boards, 50 screws, 4 metal brackets and a drill', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok');
  const shelf = r.ideas.find((i) => i.name === 'Bracket wall shelf');
  assert.ok(!shelf.missing.some((m) => /screw|bracket/i.test(m.name)), JSON.stringify(shelf.missing));
  assert.ok(shelf.usesExisting.some((u) => u.inventoryName === 'metal brackets'));
});

test('4 — materials named without an amount are owned, not bought, and the model gets a numeric placeholder', async () => {
  mock.calls = [];
  const r = await ideation.generateIdeas({ freeText: 'some wooden boards, screws and metal brackets', quantity: 1, currency: 'GEL' }, []);
  const prompt = mock.calls.find((c) => c.messages[0].content.startsWith('You are the product-ideation engine')).messages.at(-1).content;
  assert.ok(!/not stated/.test(prompt), 'no string quantities — small models refuse on them');
  assert.match(prompt, /quantityAssumed/);
  const shelf = r.ideas.find((i) => i.name === 'Bracket wall shelf');
  assert.ok(!shelf.missing.some((m) => /screw|bracket/i.test(m.name)), JSON.stringify(shelf.missing));
});

test('3 — when the model proposes nothing, it is asked once more; a second empty answer is reported honestly', async () => {
  mode = 'empty';
  mock.calls = [];
  const r = await ideation.generateIdeas({ freeText: 'wooden boards and screws', currency: 'GEL' }, []);
  assert.equal(r.status, 'no_ideas');
  assert.deepEqual(r.ideas, []);
  assert.equal(mock.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine')).length, 2);
  mode = 'ok';
});

test('8 — model failure gives an honest, retryable error and no ideas', async () => {
  mode = 'down';
  await assert.rejects(ideation.generateIdeas({ freeText: 'wooden boards and screws', currency: 'GEL' }, []), (e) => e.retryable === true && e.code === 'ai_unavailable_temp');
  mode = 'ok';
});

test('grounding — an idea that uses nothing from the inventory is not shown', async () => {
  extraIdeas = [idea({ name: 'Scented candles', usesExisting: [{ inventoryName: 'Soy wax', quantityUsed: 0.2, unit: 'kg', use: 'candle' }], visualKind: 'candle_jar' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  assert.ok(!r.ideas.some((i) => i.name === 'Scented candles'), 'claims an inventory item the user does not have');
  assert.ok(r.rejected.some((x) => x.name === 'Scented candles' && x.reason), 'hidden with a reason');
});

test('grounding — a claim of more stock than the user owns becomes an exact shortage', async () => {
  extraIdeas = [idea({ name: 'Big bookcase', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 8, unit: 'pcs', use: 'sides and shelves' }], visualKind: 'bookshelf' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  const bookcase = r.ideas.find((i) => i.name === 'Big bookcase');
  const boards = bookcase.materials.find((m) => m.name === 'Pine boards');
  assert.equal(boards.status, 'insufficient');
  assert.equal(boards.shortage, 2, 'needs 8, owns 6');
  assert.equal(bookcase.verdict, 'short');
  assert.ok(bookcase.usesExisting.some((u) => /screw/i.test(u.inventoryName)), 'the joining screws come from stock');
});

test('grounding — missing tools are computed from the user’s tools, not taken from the model', async () => {
  extraIdeas = [idea({ name: 'Cut-out sign', toolsRequired: ['Jigsaw'], visualKind: 'sign' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  const sign = r.ideas.find((i) => i.name === 'Cut-out sign');
  assert.ok(sign.toolsMissing.includes('Saw'), 'boards need a saw: ' + JSON.stringify(sign.toolsMissing));
  assert.ok(!sign.toolsMissing.includes('Jigsaw'), 'a tool the model names is not trusted on its own');
  assert.equal(sign.verdict, 'tools');
  assert.ok(!r.ideas.find((i) => i.name === 'Plant stand').toolsMissing.includes('Drill / driver'), 'the drill is owned');
});

test('grounding — a product longer than the owned boards is flagged', async () => {
  extraIdeas = [idea({ name: 'Long bench', size: { length: 1500, width: 300, height: 450 }, visualKind: 'stool' })];
  const sized = { ...pine, dimensions: { length: 1000, width: 150, thickness: 18, unit: 'mm', status: 'user_confirmed' } };
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [sized, screws, brackets]);
  extraIdeas = [];
  const bench = r.ideas.find((i) => i.name === 'Long bench');
  assert.match(bench.sizeWarning, /1500 mm.*1000 mm/);
  assert.equal(bench.verdict, 'confirm');
});

test('parse — materials the text never mentions are dropped', async () => {
  const r = await ideation.generateIdeas({ freeText: 'I have 4 wooden boards and 50 screws and a drill', quantity: 1, currency: 'GEL' }, []);
  assert.ok(!r.parsed.materials.some((m) => /bracket/i.test(m.name)), 'the mock parser invents "metal brackets"');
  assert.ok(r.parsed.materials.some((m) => /board/i.test(m.name)));
});

test('grounding — an owned item the model also lists as "missing" is not bought on top of the stock', async () => {
  extraIdeas = [idea({ name: 'Shelf with screws twice', missing: [{ name: 'Pine boards', quantity: 1, unit: 'pcs', estUnitPrice: 8, why: 'shelf' }] })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  const s = r.ideas.find((i) => i.name === 'Shelf with screws twice');
  assert.deepEqual(s.missing, [], JSON.stringify(s.missing));
  assert.equal(s.verdict, 'ready');
});

test('near-duplicate ideas ("… (2nd)") are shown once', async () => {
  extraIdeas = [idea({ name: 'Plant stand (2nd)', visualKind: 'stand' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  assert.equal(r.ideas.filter((i) => /plant stand/i.test(i.name)).length, 1);
});

test('parse — an amount the text never gave is "unknown" (confirm), not a stated 1 to buy against', async () => {
  const r = await ideation.generateIdeas({ freeText: 'I have 4 wooden boards, screws and a drill', quantity: 1, currency: 'GEL' }, []);
  const screws = r.parsed.materials.find((m) => /screw/i.test(m.name));
  const boards = r.parsed.materials.find((m) => /board/i.test(m.name));
  assert.equal(screws.quantityStated, false, 'the mock parser claims 50 screws were stated');
  assert.equal(boards.quantityStated, true);
});

test('grounding — reusable equipment (a melting pot) is not multiplied by the batch or bought', async () => {
  const pot = { id: 'p', name: 'pot for melting', material: 'metal', quantity: 1, unit: 'pot' };
  extraIdeas = [idea({ name: 'Board display stand', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'base' }, { inventoryName: 'pot for melting', quantityUsed: 1, unit: 'pot', use: 'melting' }] })];
  const r = await ideation.generateIdeas({ quantity: 3, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets, pot]);
  extraIdeas = [];
  const s = r.ideas.find((i) => i.name === 'Board display stand');
  assert.ok(!s.missing.some((m) => /pot/.test(m.name)), JSON.stringify(s.missing));
  assert.ok(s.materials.find((m) => m.name === 'pot for melting').equipment);
});

test('feasibility — a load-bearing shelf from plastic bottles is rejected with a reason', async () => {
  const bottles = { id: 'pb', name: 'plastic bottles', material: 'plastic', quantity: 20, unit: 'pcs' };
  extraIdeas = [
    idea({ name: 'Bottle wall shelf', primaryMaterial: 'plastic bottles', usesExisting: [{ inventoryName: 'plastic bottles', quantityUsed: 6, unit: 'pcs', use: 'shelf' }], visualKind: 'wall_shelf' }),
    idea({ name: 'Bottle herb planter', primaryMaterial: 'plastic bottles', usesExisting: [{ inventoryName: 'plastic bottles', quantityUsed: 1, unit: 'pcs', use: 'planter body' }], toolsRequired: ['Scissors'], visualKind: 'bottle_planter' }),
  ];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Scissors'], currency: 'GEL' }, [bottles]);
  extraIdeas = [];
  assert.ok(!r.ideas.some((i) => i.name === 'Bottle wall shelf'));
  assert.match(r.rejected.find((x) => x.name === 'Bottle wall shelf').reason, /weight|wood or metal/);
  const planter = r.ideas.find((i) => i.name === 'Bottle herb planter');
  assert.ok(planter, 'a bottle planter suits bottles');
  assert.equal(planter.kind, 'bottle_planter');
});

test('feasibility — a fabric pouch without sewing tools says so; wood without a saw needs one', async () => {
  const denim = { id: 'dn', name: 'denim jeans', material: 'cotton', quantity: 2, unit: 'pcs' };
  extraIdeas = [idea({ name: 'Denim pouch', primaryMaterial: 'denim jeans', usesExisting: [{ inventoryName: 'denim jeans', quantityUsed: 1, unit: 'pcs', use: 'body' }], toolsRequired: [], visualKind: 'pouch' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: [], currency: 'GEL' }, [denim]);
  extraIdeas = [];
  const pouch = r.ideas.find((i) => i.name === 'Denim pouch');
  assert.ok(pouch.toolsMissing.includes('Needle or sewing machine'));
  assert.ok(pouch.toolsMissing.includes('Scissors'));
  const r2 = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver'], currency: 'GEL' }, [pine, screws, brackets]);
  assert.ok(r2.ideas.every((i) => i.toolsMissing.includes('Saw')), 'cutting boards needs a saw');
});

test('tools — tools the model names that don’t fit the materials are ignored; key parts it forgot are added', async () => {
  const bottles = { id: 'pb', name: 'plastic bottles', material: 'plastic', quantity: 20, unit: 'pcs' };
  extraIdeas = [
    idea({ name: 'Bottle pen holder', primaryMaterial: 'plastic bottles', usesExisting: [{ inventoryName: 'plastic bottles', quantityUsed: 1, unit: 'pcs', use: 'body' }], toolsRequired: ['Screwdriver', 'Tape gun', 'Scissors'], visualKind: 'bottle_organizer' }),
    idea({ name: 'Zipped bottle case', primaryMaterial: 'plastic bottles', usesExisting: [{ inventoryName: 'plastic bottles', quantityUsed: 2, unit: 'pcs', use: 'shell' }], toolsRequired: [], visualKind: 'pouch' }),
  ];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Scissors'], currency: 'GEL' }, [bottles]);
  extraIdeas = [];
  const holder = r.ideas.find((i) => i.name === 'Bottle pen holder');
  assert.deepEqual(holder.toolsMissing, [], JSON.stringify(holder.toolsMissing));
  assert.equal(holder.verdict, 'ready');
  const zipped = r.ideas.find((i) => i.name === 'Zipped bottle case');
  assert.ok(zipped.missing.some((m) => m.name === 'Zip'), JSON.stringify(zipped.missing));
});

test('supplies — an unknown amount of glue does not hold up a build; "100 screw" counts as pieces', async () => {
  const glue = { id: 'g', name: 'wood glue', material: 'adhesive', quantity: 1, unit: 'container', quantityUnknown: true };
  const screwsOdd = { id: 's2', name: 'wood screws', material: 'steel', quantity: 100, unit: 'screw' };
  extraIdeas = [idea({ name: 'Glued box', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'sides' }, { inventoryName: 'wood glue', quantityUsed: 0.1, unit: 'container', use: 'joints' }, { inventoryName: 'wood screws', quantityUsed: 8, unit: 'pcs', use: 'corners' }], visualKind: 'box' })];
  const r = await ideation.generateIdeas({ quantity: 2, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, glue, screwsOdd]);
  extraIdeas = [];
  const box = r.ideas.find((i) => i.name === 'Glued box');
  assert.deepEqual(box.confirmNotes, [], JSON.stringify(box.confirmNotes));
  assert.equal(box.verdict, 'ready');
});

test('supplies — glue the model lists as "to buy" but the user owns is covered without a confirmation', async () => {
  const glue = { id: 'g', name: 'wood glue', material: 'adhesive', quantity: 1, unit: 'container', quantityUnknown: true };
  extraIdeas = [idea({ name: 'Glued tray', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'base' }], missing: [{ name: 'wood glue', quantity: 0.1, unit: 'container', estUnitPrice: 5, why: 'joints' }, { name: 'Wood screws', quantity: 8, unit: 'pcs', estUnitPrice: 0.1, why: 'corners' }], visualKind: 'tray' })];
  const r = await ideation.generateIdeas({ quantity: 2, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, glue, screws]);
  extraIdeas = [];
  const tray = r.ideas.find((i) => i.name === 'Glued tray');
  assert.deepEqual(tray.missing, []);
  assert.deepEqual(tray.confirmNotes, [], JSON.stringify(tray.confirmNotes));
});

test('feasibility — joining depends on the material; weight-bearing names need structural material', async () => {
  const card = { id: 'cb', name: 'cardboard boxes', material: 'cardboard', quantity: 5, unit: 'pcs' };
  const bottles = { id: 'pb', name: 'plastic bottles', material: 'plastic', quantity: 20, unit: 'pcs' };
  extraIdeas = [
    idea({ name: 'Cardboard storage box', primaryMaterial: 'cardboard boxes', usesExisting: [{ inventoryName: 'cardboard boxes', quantityUsed: 1, unit: 'pcs', use: 'walls' }], visualKind: 'box' }),
    idea({ name: 'Bottle ladder', primaryMaterial: 'plastic bottles', usesExisting: [{ inventoryName: 'plastic bottles', quantityUsed: 10, unit: 'pcs', use: 'rungs' }], visualKind: 'vase' }),
  ];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Scissors'], currency: 'GEL' }, [card, bottles]);
  extraIdeas = [];
  const box = r.ideas.find((i) => i.name === 'Cardboard storage box');
  assert.ok(box.missing.some((m) => /glue or strong tape/i.test(m.name)), JSON.stringify(box.missing));
  assert.ok(!box.missing.some((m) => /screw/i.test(m.name)), 'no screws for cardboard');
  assert.match(r.rejected.find((x) => x.name === 'Bottle ladder').reason, /weight/);
});

test('feasibility — screws named as the main material do not decide what a wooden shelf is made of', async () => {
  extraIdeas = [idea({ name: 'Wooden shelf', primaryMaterial: 'Wood screws 4x40', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'shelf' }, { inventoryName: 'Wood screws 4x40', quantityUsed: 6, unit: 'pcs', use: 'fixing' }], visualKind: 'wall_shelf' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  assert.ok(r.ideas.some((i) => i.name === 'Wooden shelf'), JSON.stringify(r.rejected));
});

test('feasibility — a product named for a material it isn’t made of ("Cardboard box" from boards) is rejected', async () => {
  extraIdeas = [idea({ name: 'Cardboard box', primaryMaterial: 'Pine boards', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'sides' }], visualKind: 'box' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  assert.match(r.rejected.find((x) => x.name === 'Cardboard box').reason, /called cardboard/);
});

test('feasibility — what a product holds is not what it is made of ("stand for glass jars")', async () => {
  extraIdeas = [idea({ name: 'Wooden stand for glass jars', usesExisting: [{ inventoryName: 'Pine boards', quantityUsed: 1, unit: 'pcs', use: 'base' }], visualKind: 'stand' })];
  const r = await ideation.generateIdeas({ quantity: 1, tools: ['Drill / driver', 'Saw'], currency: 'GEL' }, [pine, screws, brackets]);
  extraIdeas = [];
  assert.ok(r.ideas.some((i) => i.name === 'Wooden stand for glass jars'), JSON.stringify(r.rejected));
});
