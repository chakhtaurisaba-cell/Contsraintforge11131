// The project page's build guide (generatePlan) against a LOCAL MOCK of the Gemini API: it is
// generated for the exact card the user chose (its steps and look), with exactly the user's tools;
// a guide with vague steps is asked for once more; steps using a tool the user lacks are flagged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGeminiMock, useMock } from './gemini-mock.js';

const step = (instructions, o = {}) => ({ title: instructions.split(' ').slice(0, 3).join(' '), objective: 'progress', components: ['body'], tools: [], measurements: [], instructions, orientation: 'upright', connections: '', alignmentCheck: 'Looks even all round.', commonMistakes: [], expectedResult: 'Done as described.', sourceRefs: [], ...o });
const plan = (steps) => JSON.stringify({
  summary: 'Pen holder from a bottle.',
  overall: { length: 80, width: 80, height: 100, unit: 'mm' },
  designConstraints: [], tolerances: [], assumptions: [],
  components: [{ id: 'body', name: 'Bottle base', material: 'PET', quantity: 1, cutLength: null, cutWidth: null, thickness: null, role: 'body', fromInventory: 'plastic bottle', instances: [] }],
  bom: [{ name: 'plastic bottle', quantity: 1, unit: 'pcs', material: 'PET', spec: '', unitPrice: 0, role: 'body', essential: true, inventoryItem: 'plastic bottle', adaptation: null, substitutes: [], whyNeeded: 'body' }],
  tools: ['Scissors'], safety: [], riskFlags: [], steps,
  toolNotes: [], finalInspection: [], suggestedPrice: 0, packagingPerUnit: 0, laborMinutesPerUnit: 15,
});
const VAGUE = [step('Prepare the bottle.'), step('Assemble the components.'), step('Finish the organizer.')];
const CLEAR = [
  step('Place the empty plastic bottle upright on a flat table with the cap facing up.'),
  step('Measure 10 cm up from the bottom and mark a line all the way round with a pen.'),
  step('Cut along the line with your scissors, keeping the bottom part as the holder body.'),
  step('Drill a small hole in the base so water can drain out.'), // the user has no drill
  step('Fold a strip of tape over the cut rim, half inside and half outside, and press it down all round.'),
];

let mock;
let ideation;
let answers = [];
before(async () => {
  mock = await startGeminiMock(() => answers.shift() || plan(CLEAR));
  useMock(mock);
  ideation = await import('../server/services/ideation.js');
});
after(() => mock.close());

const project = {
  id: 'p1',
  name: 'Bottle pen holder',
  idea: {
    engine: 'ai', name: 'Bottle pen holder', summary: 'A pen cup cut from a bottle.', look: 'The bottom 10 cm of a clear bottle with a taped rim.',
    whyFeasible: 'One bottle and tape; the scissors cut it.', steps: ['Cut around the bottle 10 cm from the bottom (use your scissors).', 'Fold tape over the cut edge.'],
    usesExisting: [{ inventoryName: 'plastic bottle', quantityUsed: 1, unit: 'pcs', use: 'body' }, { inventoryName: 'tape', quantityUsed: 1, unit: 'roll', use: 'rim' }],
    userTools: ['Scissors'],
  },
};
const inventory = [{ id: 'b', name: 'plastic bottle', material: 'PET', quantity: 1, unit: 'pcs' }, { id: 't', name: 'tape', material: 'adhesive', quantity: 1, unit: 'roll' }];

test('the guide is built for the chosen card (its steps and look) with the complete tool list; vague guides are asked for again', async () => {
  answers = [plan(VAGUE), plan(CLEAR)];
  mock.calls = [];
  const p = await ideation.generatePlan(project, inventory, 'GEL');
  assert.equal(mock.calls.length, 2, 'one more request because the first guide was vague');
  const first = mock.calls[0].messages.at(-1).content;
  assert.match(first, /The chosen card's design — build EXACTLY this object/);
  assert.match(first, /The bottom 10 cm of a clear bottle with a taped rim/);
  assert.match(first, /Cut around the bottle 10 cm from the bottom/);
  assert.match(first, /the COMPLETE list; no other tool may appear in any step: \["Scissors"\]/);
  assert.match(mock.calls[1].messages.at(-1).content, /vague step\(s\) 1, 2, 3/);
  assert.equal(p.steps.length, 5);
  assert.match(p.steps[2].instructions, /scissors/);
});

test('a guide step that uses a tool the user does not own is flagged at the top of the guide', async () => {
  answers = [plan(CLEAR)];
  const p = await ideation.generatePlan(project, inventory, 'GEL');
  assert.ok(p.sizeIssues.some((n) => /Step 4 uses Drill \/ driver, which isn’t in your tools/.test(n)), JSON.stringify(p.sizeIssues));
  assert.equal(p.dimensionsValidated, false);
});

test('with no tools at all, the prompt says so explicitly', async () => {
  answers = [plan(CLEAR.filter((s) => !/Cut|Drill/.test(s.instructions)))];
  mock.calls = [];
  await ideation.generatePlan({ ...project, idea: { ...project.idea, userTools: [] } }, inventory, 'GEL');
  assert.match(mock.calls[0].messages.at(-1).content, /none \(no cutting, drilling or sawing is possible\)/);
});
