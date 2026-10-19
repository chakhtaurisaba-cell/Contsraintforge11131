// Idea quality cases A–E against a LOCAL MOCK of the Gemini API and a local stand-in for a search
// server. The mock plays the model — including its typical mistakes (invented materials, tools
// the user lacks, repeats under similar names, vague steps); everything after it is the real
// pipeline: research → two parallel idea calls → grounding, feasibility, duplicate filtering,
// ranking → the one-item unlock fallback. This checks ConstraintForge's logic, not Gemini's
// creativity (that is what tests/live/gemini.test.js is for).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGeminiMock, useMock } from './gemini-mock.js';

const idea = (name, uses, o = {}) => ({
  name,
  summary: `${name} made from what you have.`,
  whyFeasible: `It only needs ${uses.map((u) => u[0]).join(' and ')}, which you have.`,
  category: 'Home',
  primaryMaterial: uses[0][0],
  usesExisting: uses.map(([inventoryName, quantityUsed = 1, use = 'body']) => ({ inventoryName, quantityUsed, unit: 'pcs', use })),
  missing: [],
  toolsRequired: [],
  difficulty: 'beginner',
  estProductionMinutes: 20,
  size: { length: 200, width: 100, height: 100 },
  safetyNote: '',
  dependsOnMeasurements: [],
  steps: [`Clean and dry the ${uses[0][0]} before you start.`, `Wrap the ${uses.at(-1)[0]} firmly around the middle three times.`, `Check that the ${name.toLowerCase()} stands steady on a flat table.`],
  potentialUse: 'Everyday use at home.',
  sellable: { realistic: false, note: 'Better for your own use.' },
  sourceRefs: [],
  visualKind: 'generic',
  ...o,
});
const answer = (ideas, o = {}) => JSON.stringify({ ideas, enoughForStrongProjects: true, unlock: { item: '', why: '', estPrice: 0, ideas: [] }, notes: '', ...o });
const parsed = (materials, tools = []) => JSON.stringify({ recognized: true, unrecognizedReason: '', materials: materials.map(([name, material, quantity = 0]) => ({ name, material, quantity, quantityStated: quantity > 0, unit: 'pcs', size: null })), tools, skills: [], budget: null, currency: null, hoursPerWeek: null });
const CUT = ['Cut the bottle 8 cm below the neck with a knife.', 'Tape over the cut edge so it is not sharp.', 'Stand the pens in the bottom half.'];

/* ----------------------------- the model's answers per case ----------------------------- */

const CASE_A = [ // first designer: at most 6 (half of AI_MAX_IDEAS)
  idea('Bottle rolling pin', [['plastic bottle'], ['tape', 1, 'grip']], { sourceRefs: [1, 99], steps: ['Fill the plastic bottle with cold water and screw the cap on tightly.', 'Wrap two turns of tape around the cap so it cannot open.', 'Roll dough with the bottle on its side.'] }),
  idea('Boot shaper', [['plastic bottle'], ['tape', 1, 'label']]),
  idea('Bottle cable reel', [['plastic bottle'], ['tape', 1, 'cable ends']]),
  idea('Water-filled bottle door stop', [['plastic bottle'], ['tape', 1, 'non-slip band']]),
  idea('Bottle pencil holder', [['plastic bottle'], ['tape', 1, 'edge']], { steps: CUT }),
  idea('Mystery gadget', [['plastic bottle'], ['tape']], { steps: ['Assemble the materials.', 'Construct the product.'] }), // vague
];
const CASE_A_B = [ // second designer (other purposes) — partly repeats the first
  idea('Bottle pen organizer', [['plastic bottle'], ['tape', 1, 'edge']], { steps: CUT }), // the pencil holder again
  idea('Wooden bottle rack', [['pine board', 2], ['screws', 8]]), // materials the user never mentioned
  idea('Bottle exercise weight', [['plastic bottle'], ['tape', 1, 'handle']]),
  idea('Bird scarer', [['plastic bottle'], ['tape', 1, 'hanging loop']]),
  idea('Boot shaper', [['plastic bottle'], ['tape', 1, 'label']]), // proposed by both
];

const CASE_B = [
  idea('Twine-wrapped jar vase', [['glass jar'], ['glue', 1, 'twine fixing']], { visualKind: 'vase', missing: [{ name: 'Twine', quantity: 1, unit: 'roll', estUnitPrice: 3, why: 'wrapped around the jar' }] }),
  idea('Hanging jar herb pot', [['glass jar'], ['tape']], { visualKind: 'plant_pot', missing: [{ name: 'Twine', quantity: 1, unit: 'roll', estUnitPrice: 3, why: 'to hang it' }] }),
];
const CASE_B_UNLOCK = { item: 'a ball of twine', why: 'Twine turns a plain jar into a hanging pot, a wrapped vase or a lantern.', estPrice: 3, ideas: [{ name: 'Twine-wrapped jar vase', summary: 'A rustic vase.' }, { name: 'Hanging jar herb pot', summary: 'A hanging pot.' }] };

const woodSteps = (thing) => [`Mark ${thing} on one pine board with a pencil and square.`, 'Cut the parts with the hand saw and sand the edges smooth.', 'Glue the joints with wood glue and hold them with tape until dry.'];
const CASE_C = [
  idea('Pine wall shelf', [['pine boards', 1, 'shelf'], ['wood glue', 1, 'joints'], ['screws', 4, 'fixing']], { visualKind: 'wall_shelf', steps: woodSteps('a 600 mm shelf and two 150 mm brackets'), toolsRequired: ['Hand saw'] }),
  idea('Pine serving tray', [['pine boards', 1, 'base and rims'], ['wood glue', 1, 'joints']], { visualKind: 'tray', steps: woodSteps('a 400 mm base and four rims') }),
  idea('Pine phone stand', [['pine boards', 0.25, 'stand'], ['wood glue', 1, 'joint']], { visualKind: 'stand', steps: woodSteps('a 120 mm back and a 100 mm base') }),
  idea('Pine bookends', [['pine boards', 0.5, 'bookends'], ['wood glue', 1, 'joints']], { steps: woodSteps('four 150 mm pieces') }),
  idea('Pine storage box', [['pine boards', 2, 'sides and base'], ['wood glue', 1, 'joints'], ['screws', 12, 'corners']], { visualKind: 'box', steps: woodSteps('four sides and a base') }),
  idea('Pine coaster set', [['pine boards', 0.25, 'coasters'], ['sandpaper', 1, 'finish']], { visualKind: 'coaster', steps: woodSteps('four 90 mm squares') }),
  idea('Wooden wall shelf', [['pine boards', 1, 'shelf'], ['wood glue', 1, 'joints']], { visualKind: 'wall_shelf', steps: woodSteps('a shelf') }), // repeat
  idea('Drilled pegboard', [['pine boards', 1, 'board']], { toolsRequired: ['Drill / driver'], steps: ['Drill 6 mm holes every 50 mm in one pine board.', 'Sand the holes smooth.', 'Fix the board to the wall.'] }), // needs a power tool
  idea('Giant bookcase', [['pine boards', 6, 'carcass'], ['screws', 40]], { visualKind: 'bookshelf', steps: woodSteps('two 1800 mm sides') }), // more boards than owned
];

const RICH = [
  ['Pine boards', 'Pine wood', 6], ['Plywood sheet', 'Plywood', 1], ['Wood screws', 'Steel', 100], ['Wood glue', 'PVA', 1], ['Glass jars', 'Glass', 8], ['Jute twine', 'Jute', 1],
  ['Cotton fabric', 'Cotton', 2], ['Cardboard boxes', 'Cardboard', 5], ['Plastic bottles', 'PET', 10], ['Acrylic paint', 'Paint', 3], ['Sandpaper', 'Abrasive', 5], ['LED string lights', 'Electronics', 2],
].map(([name, material, quantity], i) => ({ id: `r${i}`, name, material, quantity, unit: 'pcs', dimensions: null }));
const CASE_D = [
  idea('Pine wall shelf', [['Pine boards', 1], ['Wood screws', 6], ['Wood glue', 1]], { visualKind: 'wall_shelf', steps: woodSteps('a shelf') }),
  idea('Hanging jar lanterns', [['Glass jars', 3], ['Jute twine', 1], ['LED string lights', 1]], { visualKind: 'lamp' }),
  idea('Fabric-lined storage box', [['Cardboard boxes', 1], ['Cotton fabric', 1], ['Wood glue', 1]], { visualKind: 'box', steps: ['Measure the inside of one cardboard box.', 'Cut the cotton fabric 2 cm larger than each side with scissors.', 'Glue the fabric inside and fold the edges over the rim.'] }),
  idea('Bottle herb planter', [['Plastic bottles', 1], ['Acrylic paint', 1]], { visualKind: 'bottle_planter', steps: ['Cut one plastic bottle in half with the scissors.', 'Paint the outside of the bottom half and let it dry.', 'Poke four drain holes in the base with the scissors.'] }),
  idea('Plywood serving tray', [['Plywood sheet', 0.25], ['Pine boards', 0.5], ['Wood glue', 1], ['Sandpaper', 1]], { visualKind: 'tray', steps: woodSteps('a plywood base and pine rims') }),
  idea('Painted jar pen holder', [['Glass jars', 1], ['Acrylic paint', 1]], { visualKind: 'jar' }),
  idea('Jar pencil cup', [['Glass jars', 1], ['Acrylic paint', 1]], { visualKind: 'jar' }), // repeat of the pen holder
  idea('Twine-wrapped bottle vase', [['Plastic bottles', 1], ['Jute twine', 1], ['Wood glue', 1]], { visualKind: 'vase' }),
  idea('Pine key rack', [['Pine boards', 0.5], ['Wood screws', 6], ['Acrylic paint', 1]], { visualKind: 'key_rack', steps: woodSteps('a 300 mm backboard') }),
  idea('Cardboard drawer organizer', [['Cardboard boxes', 2], ['Wood glue', 1]], { visualKind: 'organizer', steps: ['Cut one cardboard box into 6 cm strips with scissors.', 'Slot and glue the strips into a grid.', 'Let the glue dry for an hour.'] }),
];

let SEARCH_RESULTS = [];
let searchStatusCode = 200;
let mode = '';
let mock;
let searx;
let ideation;

before(async () => {
  searx = http.createServer((req, res) => {
    res.writeHead(searchStatusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: SEARCH_RESULTS }));
  });
  await new Promise((r) => searx.listen(0, '127.0.0.1', r));
  mock = await startGeminiMock((call) => {
    const sys = call.messages[0].content;
    const user = call.messages.at(-1).content;
    if (sys.startsWith('You extract a structured inventory')) {
      if (/plastic bottle, tape/.test(user)) return parsed([['plastic bottle', 'plastic'], ['tape', 'adhesive']]);
      if (/glass jar, tape and glue/.test(user)) return parsed([['glass jar', 'glass'], ['tape', 'adhesive'], ['glue', 'adhesive']]);
      if (/pine boards/.test(user)) return parsed([['pine boards', 'wood', 3], ['screws', 'steel'], ['wood glue', 'adhesive'], ['sandpaper', 'abrasive']], ['hammer', 'hand saw']);
      if (/bottle cap/.test(user)) return parsed([['bottle cap', 'plastic', 1]]);
      return parsed([]);
    }
    if (!sys.startsWith('You are the product-ideation engine')) return '{}';
    const second = /OTHER purposes/.test(user);
    if (mode === 'A') return answer(second ? CASE_A_B : CASE_A);
    if (mode === 'B') return answer(second ? [] : CASE_B, { enoughForStrongProjects: false, unlock: CASE_B_UNLOCK });
    if (mode === 'C') return answer(second ? CASE_C.slice(3) : CASE_C);
    if (mode === 'D') return answer(second ? CASE_D.slice(5) : CASE_D.slice(0, 7));
    if (mode === 'E') return answer([], { enoughForStrongProjects: false, unlock: { item: 'a small round magnet', why: 'Glued into the cap it becomes a fridge magnet or a pin catcher.', estPrice: 1, ideas: [{ name: 'Bottle cap fridge magnet', summary: 'Holds notes on the fridge.' }, { name: 'Magnetic pin catcher', summary: 'Keeps pins in one place.' }] } });
    if (mode === 'E-owned') return answer([], { enoughForStrongProjects: false, unlock: { item: 'bottle cap', why: 'More caps.', estPrice: 0, ideas: [] } });
    return answer([]);
  });
  useMock(mock, { SEARCH_PROVIDER: 'searxng', SEARXNG_URL: `http://127.0.0.1:${searx.address().port}` });
  ideation = await import('../server/services/ideation.js');
});
after(() => {
  mock.close();
  searx.close();
});

const ideaCalls = () => mock.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine'));
const names = (r) => r.ideas.map((i) => i.name);

test('CASE A — plastic bottle + tape: several distinct, buildable ideas; nothing invented, repeats merged, research used', async () => {
  mode = 'A';
  mock.calls = [];
  mock.delayMs = 120;
  SEARCH_RESULTS = [
    { url: 'https://www.example-diy.com/bottle-rolling-pin', title: 'Plastic bottle rolling pin hack', content: 'Fill a bottle with cold water to roll pastry.' },
    { url: 'https://crafts.example.org/bottle-ideas', title: '25 things to make from plastic bottles', content: 'Planters, scoops, bird feeders…' },
  ];
  const r = await ideation.generateIdeas({ freeText: 'plastic bottle, tape', quantity: 1, currency: 'GEL' }, []);
  mock.delayMs = 0;
  assert.equal(r.status, 'ok', r.message);
  assert.equal(r.ideas.length, 6, `expected the 6 buildable ideas, got ${names(r)}`);
  // Nothing that needs a material or tool they don't have becomes a card.
  for (const i of r.ideas) {
    assert.ok(['ready', 'confirm'].includes(i.verdict), `${i.name}: ${i.verdict}`);
    assert.ok(i.usesExisting.every((u) => /plastic bottle|tape/.test(u.inventoryName)), `${i.name} uses ${JSON.stringify(i.usesExisting)}`);
    assert.equal(i.missing.length, 0);
    assert.ok(i.steps.length >= 2);
  }
  assert.ok(!names(r).includes('Wooden bottle rack'), 'invented wood and screws are never assumed');
  assert.ok(!names(r).includes('Mystery gadget'), 'vague instructions are not a project');
  assert.match(r.rejected.find((x) => x.name === 'Mystery gadget').reason, /vague/);
  assert.match(r.rejected.find((x) => /Bottle pen(cil)? (holder|organizer)/.test(x.name)).reason, /knife or scissors/, 'cutting needs a cutting tool they lack');
  assert.equal(r.rejected.filter((x) => /Bottle pen(cil)? (holder|organizer)/.test(x.name)).length, 1, 'the repeated idea is listed once');
  assert.equal(names(r).filter((n) => n === 'Boot shaper').length, 1, 'both designers proposed it; shown once');
  assert.match(r.rejected.find((x) => x.name === 'Wooden bottle rack').reason, /doesn’t use any of your materials/, 'it claims only wood and screws they never mentioned');
  assert.equal(r.unlock, null, 'enough strong projects → no purchase suggestion');
  // Research: real results reach the prompt as evidence; only real result numbers become links.
  const calls = ideaCalls();
  assert.equal(calls.length, 2, 'two designers');
  assert.ok(calls.every((c) => /Web research results/.test(c.messages.at(-1).content) && /\[1\] Plastic bottle rolling pin hack/.test(c.messages.at(-1).content)));
  assert.notEqual(calls[0].messages.at(-1).content.match(/Your share: .*/)?.[0], calls[1].messages.at(-1).content.match(/Your share: .*/)?.[0], 'complementary angles');
  assert.ok(calls[1].receivedAt < calls[0].answeredAt && calls[0].receivedAt < calls[1].answeredAt, 'the two calls run at the same time');
  const pin = r.ideas.find((i) => i.name === 'Bottle rolling pin');
  assert.deepEqual(pin.inspiration, [{ url: SEARCH_RESULTS[0].url, title: SEARCH_RESULTS[0].title }], 'source 99 does not exist and is dropped');
  assert.equal(r.research.sources.length, 2);
});

test('CASE A — search failing: ideas still come from the model’s own reasoning, and that is said', async () => {
  mode = 'A';
  searchStatusCode = 500;
  (await import('../server/services/ideaResearch.js')).resetResearchCache();
  const r = await ideation.generateIdeas({ freeText: 'plastic bottle, tape', quantity: 1, currency: 'GEL' }, []);
  searchStatusCode = 200;
  assert.equal(r.status, 'ok');
  assert.ok(r.ideas.length >= 4);
  assert.match(r.research.error, /own reasoning/);
});

test('CASE B — glass jar + tape + glue: no strong project → honest message and exactly ONE item that unlocks projects', async () => {
  mode = 'B';
  const r = await ideation.generateIdeas({ freeText: 'glass jar, tape and glue', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'unlock');
  assert.deepEqual(r.ideas, [], 'no fake project');
  assert.equal(r.message, 'I couldn’t find a strong, realistic project using only these materials.');
  assert.equal(typeof r.unlock.item, 'string');
  assert.match(r.unlock.item, /twine/i);
  assert.equal(r.unlock.checked, true, 'computed from ideas whose only gap is that item');
  assert.equal(r.unlock.ideas.length, 2, 'the projects it unlocks');
  assert.ok(r.unlock.ideas.every((i) => i.missing.length === 1 && /twine/i.test(i.missing[0].name)));
  assert.equal(r.unlock.why, CASE_B_UNLOCK.why, 'the model’s explanation is used when it names the same item');
  assert.ok(r.unlock.estPrice > 0);
});

test('CASE C — pine boards, screws, glue, sandpaper + hammer, hand saw: many woodworking ideas, real quantities, no power tools', async () => {
  mode = 'C';
  const r = await ideation.generateIdeas({ freeText: '3 pine boards, screws, wood glue, sandpaper, hammer, hand saw', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok', r.message);
  assert.ok(r.ideas.length >= 5, names(r).join(', '));
  for (const i of r.ideas) {
    const boards = i.usesExisting.filter((u) => /pine/i.test(u.inventoryName)).reduce((s, u) => s + u.quantityUsed, 0);
    assert.ok(boards <= 3, `${i.name} uses ${boards} boards`);
    assert.ok(!i.toolsRequired.some((t) => /drill|driver|jigsaw|sander/i.test(t)), `${i.name}: ${i.toolsRequired}`);
    assert.ok(i.steps.length >= 3 && i.steps.every((s) => s.split(' ').length >= 5), 'detailed steps');
  }
  assert.ok(!names(r).includes('Drilled pegboard'));
  assert.match(r.rejected.find((x) => x.name === 'Drilled pegboard').reason, /Drill/);
  assert.ok(!names(r).includes('Giant bookcase'), 'needs more boards than the 3 owned');
  assert.equal(names(r).filter((n) => /wall shelf/i.test(n)).length, 1, 'one wall shelf, not two');
});

test('CASE D — rich inventory: different subsets, high diversity, no near-duplicate cards', async () => {
  mode = 'D';
  const r = await ideation.generateIdeas({ tools: ['Saw', 'Drill / driver', 'Scissors', 'Hot-glue gun'], quantity: 1, currency: 'GEL' }, RICH);
  assert.equal(r.status, 'ok', r.message);
  assert.ok(r.ideas.length >= 7, names(r).join(', '));
  const subsets = new Set(r.ideas.map((i) => i.usesExisting.map((u) => u.inventoryName).sort().join('+')));
  assert.ok(subsets.size >= 6, 'ideas use different combinations of items');
  const used = new Set(r.ideas.flatMap((i) => i.usesExisting.map((u) => u.inventoryName)));
  assert.ok(used.size >= 9, `${used.size} of 12 items are used across the ideas`);
  assert.ok(r.ideas.some((i) => i.usesExisting.length <= 2) && r.ideas.some((i) => i.usesExisting.length >= 3), 'small and larger subsets');
  const { isNearDuplicate } = ideation;
  for (const a of r.ideas) for (const b of r.ideas) if (a !== b) assert.ok(!isNearDuplicate(a.name, b.name), `${a.name} ~ ${b.name}`);
  assert.ok(!(names(r).includes('Painted jar pen holder') && names(r).includes('Jar pencil cup')));
  assert.ok(new Set(r.ideas.map((i) => i.kind)).size >= 6, 'different kinds of products');
});

test('CASE E — minimal inventory: honest answer and exactly one high-value addition, then what it unlocks', async () => {
  mode = 'E';
  const r = await ideation.generateIdeas({ freeText: 'one bottle cap', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'unlock');
  assert.deepEqual(r.ideas, []);
  assert.match(r.message, /couldn’t find a strong, realistic project/);
  assert.equal(r.unlock.item, 'a small round magnet');
  assert.equal(r.unlock.checked, false, 'the model’s suggestion, labelled as not yet checked');
  assert.ok(r.unlock.ideas.length >= 2 && r.unlock.ideas.every((i) => i.name && i.summary));
  assert.equal(ideaCalls().length >= 2, true);
});

test('CASE E — an "addition" the user already owns is not suggested; the answer stays honest', async () => {
  mode = 'E-owned';
  const r = await ideation.generateIdeas({ freeText: 'one bottle cap', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'no_ideas');
  assert.equal(r.unlock, null);
});
