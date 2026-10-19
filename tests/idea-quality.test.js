// Idea quality cases A–F against a LOCAL MOCK of the Gemini API and a local stand-in for a search
// server. The mock plays the model — including typical mistakes (cutting without a cutting tool,
// drilling glass, renaming a jar as a vase, invented materials, repeats, vague steps); everything
// after it is the real pipeline: research → ONE structured idea call → quality gate, grounding,
// feasibility, duplicate filtering, ranking → the one-item unlock fallback. This checks
// ConstraintForge's logic, not Gemini's creativity (tests/live/gemini.test.js does that).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGeminiMock, useMock } from './gemini-mock.js';

const idea = (name, uses, o = {}) => ({
  name,
  summary: `${name}, made from ${uses.map((u) => u[0]).join(' and ')}.`,
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
  steps: [`Place the ${uses[0][0]} on a flat table.`, `Wrap the ${uses.at(-1)[0]} firmly three times around the middle.`, `Press the ends down and check that the ${name.toLowerCase()} stands steady.`],
  potentialUse: 'Everyday use at home.',
  sellable: { realistic: false, note: 'Better for your own use.' },
  sourceRefs: [],
  look: `A ${name.toLowerCase()} with ${uses.map((u) => u[0]).join(' and ')} visible.`,
  visualKind: 'generic',
  ...o,
});
const answer = (ideas, o = {}) => JSON.stringify({ ideas, enoughForStrongProjects: true, unlock: { item: '', why: '', estPrice: 0, ideas: [] }, notes: '', ...o });
const parsed = (materials, tools = []) => JSON.stringify({ recognized: true, unrecognizedReason: '', materials: materials.map(([name, material, quantity = 0]) => ({ name, material, quantity, quantityStated: quantity > 0, unit: 'pcs', size: null })), tools, skills: [], budget: null, currency: null, hoursPerWeek: null });

/* ------------------------- bottle + tape (cases A and B) ------------------------- */
const B1 = [ // the model's list is B1 + B2 in one answer (AI_MAX_IDEAS=12 here, so every bad idea reaches the gate)
  idea('Bottle rolling pin', [['plastic bottle'], ['tape', 1, 'grip']], { sourceRefs: [1, 99], steps: ['Fill the plastic bottle with cold water and screw the cap on tightly.', 'Wrap two turns of tape around the cap so it cannot open.', 'Roll dough with the bottle lying on its side.'] }),
  idea('Boot shaper', [['plastic bottle'], ['tape', 1, 'label']]),
  idea('Bottle cable reel', [['plastic bottle'], ['tape', 1, 'cable ends']]),
  idea('Bottle pencil holder', [['plastic bottle'], ['tape', 1, 'rim cover']], { steps: ['Place the empty bottle upright on a flat table.', 'Measure about 10 cm up from the bottom and cut around the bottle there.', 'Fold a strip of tape over the cut edge, half inside and half outside.', 'Stand several pens inside and check the base stays flat.'] }),
  idea('Bottle funnel', [['plastic bottle'], ['tape', 1, 'rim cover']], { steps: ['Hold the bottle on its side on the table.', 'Cut off the top third of the bottle just below the shoulder with scissors.', 'Tape over the cut rim so it is smooth.', 'Pour through the neck end to check it drains.'] }),
  idea('Bottle water container', [['plastic bottle']], { steps: ['Rinse the plastic bottle with clean water.', 'Fill the bottle with water and close the cap.'] }), // a renamed bottle
];
const B2 = [
  idea('Bottle pen organizer', [['plastic bottle'], ['tape', 1, 'rim cover']], { steps: B1[3].steps }), // the pencil holder again
  idea('Mystery gadget', [['plastic bottle'], ['tape']], { steps: ['Prepare the bottle.', 'Attach the tape.', 'Finish the organizer.'] }), // vague
  idea('Wooden bottle rack', [['pine board', 2], ['screws', 8]]), // materials the user never mentioned
  idea('Bottle scoop', [['plastic bottle'], ['tape', 1, 'handle grip']], { steps: ['Lay the bottle on its side with the handle up.', 'Cut away the bottom and one side below the handle in a curve.', 'Tape over all cut edges.', 'Scoop dry soil to check it holds.'] }),
  idea('Bird scarer', [['plastic bottle'], ['tape', 1, 'hanging loop']], { steps: ['Peel the label off the bottle so the plastic shines.', 'Make a 20 cm loop of tape, sticky sides together, and tape it to the cap.', 'Hang the bottle from a branch by the loop so it turns in the wind.'] }),
  idea('Boot shaper', [['plastic bottle'], ['tape', 1, 'label']]), // a repeat in the same list
];

/* ------------------------- glass jar + shoelace (case C) ------------------------- */
const JAR_LACE = [
  idea('Glass jar vase', [['glass jar'], ['shoelace', 1, 'decoration']], { steps: ['Tie the shoelace around the jar in a bow.', 'Fill the jar with water and add flowers.'], visualKind: 'vase' }), // renamed jar
  idea('Drilled jar lamp', [['glass jar'], ['shoelace']], { steps: ['Drill a hole in the jar near the rim.', 'Thread the shoelace through the hole.', 'Hang the jar from the lace.'] }), // unsafe
  idea('Hanging jar holder', [['glass jar'], ['shoelace', 1, 'hanger']], { steps: ['Tie the shoelace twice around the jar neck, just below the rim, and knot it tight.', 'Tie both free ends together about 20 cm above the jar to make a loop.', 'Hang the jar from the loop and check it sits level and does not slip.'] }),
  idea('Wire-handled jar carrier', [['glass jar'], ['shoelace', 1, 'grip']], { missing: [{ name: 'Garden wire', quantity: 1, unit: 'm', estUnitPrice: 2, why: 'a rigid handle' }], steps: ['Wrap the garden wire twice around the jar neck and twist it tight.', 'Bend the free wire into an arch over the jar and twist its end on the far side.', 'Wind the shoelace around the arch as a soft grip.'] }),
  idea('Wall jar hanger', [['glass jar'], ['shoelace']], { missing: [{ name: 'Garden wire', quantity: 1, unit: 'm', estUnitPrice: 2, why: 'to hang it' }], steps: ['Wrap the garden wire twice around the jar neck and twist it tight.', 'Twist a 3 cm loop into the wire behind the jar.', 'Hang the loop on a wall hook.'] }),
];

/* ------------------------- glass jar + tape + glue (case D) ------------------------- */
const JAR_TAPE = [
  idea('Jar vase', [['glass jar'], ['glue']], { steps: ['Glue a ring of tape around the jar rim.', 'Fill the jar with water and flowers.'], visualKind: 'vase' }), // renamed
  idea('Taped wall jar holder', [['glass jar'], ['tape', 1, 'fixing']], { steps: ['Clean the wall and the jar.', 'Stick the jar to the wall with three strips of tape.', 'Press each strip for 30 seconds.'] }), // tape holds glass up
  idea('Cut jar candle holder', [['glass jar'], ['glue']], { steps: ['Score the glass jar 5 cm from the base.', 'Break off the top of the jar.', 'Glue tape over the edge.'] }), // cutting glass
  idea('Hanging jar herb pot', [['glass jar'], ['glue', 1, 'twine fixing']], { visualKind: 'plant_pot', missing: [{ name: 'Twine', quantity: 1, unit: 'roll', estUnitPrice: 3, why: 'to hang it' }], steps: ['Glue the end of the twine under the jar rim.', 'Wind the twine three times around the neck and knot it.', 'Tie a hanging loop 25 cm above the jar.'] }),
  idea('Twine-handled jar carrier', [['glass jar'], ['glue', 1, 'fixing']], { missing: [{ name: 'Twine', quantity: 1, unit: 'roll', estUnitPrice: 3, why: 'the handle' }], steps: ['Wind twine three times around the jar neck and glue the end.', 'Braid three 40 cm lengths of twine into a handle.', 'Knot the handle ends to the neck ring on opposite sides.'] }),
];
const JAR_TAPE_UNLOCK = { item: 'a ball of twine', why: 'Twine turns the jar into a hanging herb pot or a carrier you can hold.', estPrice: 3, ideas: [{ name: 'Hanging jar herb pot', summary: 'A hanging pot.', uses: ['glass jar', 'twine', 'glue'] }] };

/* ------------------------- woodworking (case E) ------------------------- */
const woodSteps = (thing) => [`Mark ${thing} on one pine board with a pencil and square.`, 'Cut the parts along the marks with the hand saw and sand every edge smooth.', 'Spread wood glue on the joints and hold them with tape until dry.'];
const WOOD = [
  idea('Pine wall shelf', [['pine boards', 1, 'shelf'], ['wood glue', 1, 'joints']], { visualKind: 'wall_shelf', steps: woodSteps('a 600 mm shelf and two 150 mm brackets'), toolsRequired: ['Hand saw'] }),
  idea('Pine serving tray', [['pine boards', 1, 'base and rims'], ['wood glue', 1, 'joints']], { visualKind: 'tray', steps: woodSteps('a 400 mm base and four rims') }),
  idea('Pine phone stand', [['pine boards', 0.25, 'stand'], ['wood glue', 1, 'joint']], { visualKind: 'stand', steps: woodSteps('a 120 mm back and a 100 mm base') }),
  idea('Pine bookends', [['pine boards', 0.5, 'bookends'], ['wood glue', 1, 'joints']], { steps: woodSteps('four 150 mm pieces') }),
  idea('Screwed pine crate', [['pine boards', 2, 'sides'], ['screws', 16, 'corners']], { visualKind: 'crate', steps: ['Cut four 300 mm sides and a base from two boards with the hand saw.', 'Join each corner with 4 screws.', 'Sand all edges smooth.'] }), // a hammer can't drive screws
  idea('Pine coaster set', [['pine boards', 0.25, 'coasters'], ['sandpaper', 1, 'finish']], { visualKind: 'coaster', steps: woodSteps('four 90 mm squares') }),
];
const WOOD2 = [
  idea('Wooden wall shelf', [['pine boards', 1, 'shelf'], ['wood glue', 1, 'joints']], { visualKind: 'wall_shelf', steps: woodSteps('a shelf') }), // repeat
  idea('Drilled pegboard', [['pine boards', 1, 'board']], { toolsRequired: ['Drill / driver'], steps: ['Drill 6 mm holes every 50 mm in one pine board.', 'Sand the holes smooth with sandpaper.', 'Lean the board against the wall.'] }), // power tool
  idea('Giant bookcase', [['pine boards', 6, 'carcass'], ['wood glue', 1]], { visualKind: 'bookshelf', steps: woodSteps('two 1800 mm sides') }), // more boards than owned
  idea('Pine key holder', [['pine boards', 0.5, 'backboard'], ['wood glue', 1, 'pegs']], { steps: woodSteps('a 300 mm backboard and four 40 mm pegs') }),
  idea('Pine plant riser', [['pine boards', 0.5, 'top and legs'], ['wood glue', 1, 'joints']], { steps: woodSteps('a 250 mm top and four 100 mm legs') }),
];

/* ------------------------- rich inventory ------------------------- */
const RICH = [
  ['Pine boards', 'Pine wood', 6], ['Plywood sheet', 'Plywood', 1], ['Wood screws', 'Steel', 100], ['Wood glue', 'PVA', 1], ['Glass jars', 'Glass', 8], ['Jute twine', 'Jute', 1],
  ['Cotton fabric', 'Cotton', 2], ['Cardboard sheets', 'Cardboard', 5], ['Plastic bottles', 'PET', 10], ['Acrylic paint', 'Paint', 3], ['Sandpaper', 'Abrasive', 5], ['LED string lights', 'Electronics', 2],
].map(([name, material, quantity], i) => ({ id: `r${i}`, name, material, quantity, unit: 'pcs', dimensions: null }));
const RICH1 = [
  idea('Pine wall shelf', [['Pine boards', 1], ['Wood screws', 6], ['Wood glue', 1]], { visualKind: 'wall_shelf', steps: ['Mark a 600 mm shelf on one pine board.', 'Cut it with the saw and sand the edges.', 'Drill pilot holes and drive 6 wood screws with the drill.'] }),
  idea('Hanging jar lanterns', [['Glass jars', 3], ['Jute twine', 1], ['LED string lights', 1]], { visualKind: 'lamp', steps: ['Coil one LED string inside each glass jar.', 'Tie jute twine twice around each jar neck and knot a hanging loop.', 'Hang the jars from the loops and switch the lights on.'] }),
  idea('Fabric-lined storage box', [['Cardboard sheets', 1], ['Cotton fabric', 1], ['Wood glue', 1]], { visualKind: 'box', steps: ['Mark a 30 × 20 cm base and four 10 cm walls on a cardboard sheet.', 'Cut the outline with the scissors and fold the walls up.', 'Glue the cotton fabric inside and fold it over the rim.'] }),
  idea('Bottle herb planter', [['Plastic bottles', 1], ['Acrylic paint', 1]], { visualKind: 'bottle_planter', steps: ['Cut one plastic bottle in half with the scissors.', 'Paint the outside of the bottom half and let it dry.', 'Poke four drain holes in the base with the scissors.'] }),
  idea('Plywood serving tray', [['Plywood sheet', 0.25], ['Pine boards', 0.5], ['Wood glue', 1], ['Sandpaper', 1]], { visualKind: 'tray', steps: ['Mark a 400 × 250 mm plywood base and four pine rims with a pencil.', 'Cut along the marks with the saw.', 'Glue the parts together and let them dry for an hour.'] }),
  idea('Painted jar pen holder', [['Glass jars', 1], ['Acrylic paint', 1]], { visualKind: 'jar' }), // a renamed jar
];
const RICH2 = [
  idea('Jar pencil cup', [['Glass jars', 1], ['Acrylic paint', 1]], { visualKind: 'jar' }), // renamed again
  idea('Twine-wrapped bottle vase', [['Plastic bottles', 1], ['Jute twine', 1], ['Wood glue', 1]], { visualKind: 'vase', steps: ['Cut the top off one bottle with the scissors 15 cm above the base.', 'Glue the jute twine around the bottle in tight rows from bottom to top.', 'Tuck and glue the twine end inside the rim.'] }),
  idea('Pine key rack', [['Pine boards', 0.5], ['Wood screws', 6], ['Acrylic paint', 1]], { visualKind: 'key_rack', steps: ['Cut a 300 mm backboard with the saw.', 'Paint it and let it dry.', 'Drive 6 wood screws halfway in with the drill as key pegs.'] }),
  idea('Cardboard drawer organizer', [['Cardboard sheets', 2], ['Wood glue', 1]], { visualKind: 'organizer', steps: ['Cut one cardboard sheet into 6 cm strips with the scissors.', 'Slot and glue the strips into a grid.', 'Let the glue dry for an hour.'] }),
  idea('Fabric cable wrap', [['Cotton fabric', 0.25], ['Wood glue', 1]], { steps: ['Cut a 30 × 5 cm strip of cotton fabric with the scissors.', 'Fold it lengthwise and glue the long edge.', 'Wrap it around a bundle of cables.'] }),
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
      if (/plastic bottle, tape/.test(user)) return parsed([['plastic bottle', 'plastic', 1], ['tape', 'adhesive']]);
      if (/glass jar, shoelace/.test(user)) return parsed([['glass jar', 'glass', 1], ['shoelace', 'cotton', 1]]);
      if (/glass jar, tape and glue/.test(user)) return parsed([['glass jar', 'glass', 1], ['tape', 'adhesive'], ['glue', 'adhesive']]);
      if (/pine boards/.test(user)) return parsed([['pine boards', 'wood', 3], ['screws', 'steel'], ['wood glue', 'adhesive'], ['sandpaper', 'abrasive']], ['hammer', 'hand saw']);
      if (/one shoelace/.test(user)) return parsed([['shoelace', 'cotton', 1]]);
      return parsed([]);
    }
    if (!sys.startsWith('You are the product-ideation engine')) return '{}';
    if (mode === 'bottle') return answer([...B1, ...B2]);
    if (mode === 'jar-lace') return answer(JAR_LACE, { enoughForStrongProjects: false, unlock: { item: 'garden wire', why: 'Wire makes a rigid handle or a hanger that holds the jar safely.', estPrice: 2, ideas: [] } });
    if (mode === 'jar-tape') return answer(JAR_TAPE, { enoughForStrongProjects: false, unlock: JAR_TAPE_UNLOCK });
    if (mode === 'wood') return answer([...WOOD, ...WOOD2]);
    if (mode === 'rich') return answer([...RICH1, ...RICH2]);
    if (mode === 'lace') return answer([idea('Shoelace keychain', [['shoelace']], { steps: ['Prepare the shoelace.', 'Finish the keychain.'] })], { enoughForStrongProjects: false, unlock: { item: 'a handful of wooden beads', why: 'Beads threaded on the lace make a bracelet, a zip pull or a lanyard.', estPrice: 2, ideas: [{ name: 'Beaded bracelet', summary: 'Beads knotted on the lace.', uses: ['shoelace', 'wooden beads'] }, { name: 'Beaded zip pull', summary: 'A short beaded loop for a zip.', uses: ['shoelace', 'wooden beads'] }] } });
    if (mode === 'lace-owned') return answer([], { enoughForStrongProjects: false, unlock: { item: 'shoelace', why: 'More laces.', estPrice: 0, ideas: [] } });
    return answer([]);
  });
  useMock(mock, { SEARCH_PROVIDER: 'searxng', SEARXNG_URL: `http://127.0.0.1:${searx.address().port}`, AI_MAX_IDEAS: '12' });
  ideation = await import('../server/services/ideation.js');
});
after(() => {
  mock.close();
  searx.close();
});

const ideaCalls = () => mock.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine'));
const names = (r) => r.ideas.map((i) => i.name);
const reasonFor = (r, name) => r.rejected.find((x) => x.name === name)?.reason || '';
const CUTS = /\b(cut|cuts|cutting|trim|snip)\b(?!\s+(edges?|ends?|rims?))/i;

test('CASE A — 1 plastic bottle + tape, NO tools: no cutting at all, several different real projects, nothing invented', async () => {
  mode = 'bottle';
  mock.calls = [];
  mock.delayMs = 120;
  SEARCH_RESULTS = [
    { url: 'https://www.example-diy.com/bottle-rolling-pin', title: 'Plastic bottle rolling pin hack', content: 'Fill a bottle with cold water to roll pastry.' },
    { url: 'https://crafts.example.org/bottle-ideas', title: '25 things to make from plastic bottles', content: 'Planters, scoops, bird scarers…' },
  ];
  const r = await ideation.generateIdeas({ freeText: '1 plastic bottle, tape', quantity: 1, currency: 'GEL' }, []);
  mock.delayMs = 0;
  assert.equal(r.status, 'ok', r.message);
  assert.deepEqual(names(r).sort(), ['Bird scarer', 'Boot shaper', 'Bottle cable reel', 'Bottle rolling pin']);
  for (const i of r.ideas) {
    assert.ok(!i.steps.some((s) => CUTS.test(s)), `${i.name} cuts without a cutting tool: ${i.steps}`);
    assert.ok(!i.steps.some((s) => /scissors|knife/i.test(s)), 'no scissors magically invented');
    assert.ok(i.usesExisting.every((u) => /plastic bottle|tape/.test(u.inventoryName)), `${i.name}: ${JSON.stringify(i.usesExisting)}`);
    assert.deepEqual(i.missing, []);
  }
  for (const n of ['Bottle funnel', 'Bottle scoop']) assert.match(reasonFor(r, n), /needs Scissors/, n);
  const penHolders = r.rejected.filter((x) => /Bottle pen(cil)? (holder|organizer)/.test(x.name));
  assert.equal(penHolders.length, 1, 'the repeated idea (pencil holder / pen organizer) is listed once');
  assert.match(penHolders[0].reason, /needs Scissors/);
  assert.match(reasonFor(r, 'Bottle water container'), /same object under a new name/);
  assert.match(reasonFor(r, 'Mystery gadget'), /vague/);
  assert.match(reasonFor(r, 'Wooden bottle rack'), /doesn’t use any of your materials/);
  assert.equal(names(r).filter((n) => n === 'Boot shaper').length, 1, 'repeated in the list, shown once');
  assert.equal(r.unlock, null, 'four strong projects → no purchase suggestion');
  // ONE idea call, with the research in its prompt; only real sources become links.
  const calls = ideaCalls();
  assert.equal(calls.length, 1, 'one structured Gemini call for all the ideas');
  assert.match(calls[0].messages.at(-1).content, /\[1\] Plastic bottle rolling pin hack/);
  assert.equal(mock.calls.length, 1, 'the typed inventory is parsed on the server — the ideas call is the only Gemini call');
  assert.equal(calls[0].model, 'gemini-2.5-flash-lite');
  assert.equal(calls[0].raw.generationConfig.thinkingConfig, undefined, 'Gemini 2.5 rejects thinkingLevel: no thinking setting is sent (Flash-Lite does not think by default)');
  assert.ok(calls[0].raw.generationConfig.responseJsonSchema && calls[0].raw.generationConfig.responseMimeType === 'application/json', 'structured output is used as before');
  assert.deepEqual(r.ideas.find((i) => i.name === 'Bottle rolling pin').inspiration, [{ url: SEARCH_RESULTS[0].url, title: SEARCH_RESULTS[0].title }], 'source 99 does not exist');
  assert.ok(/without extra materials/.test(r.research.queries.join(' | ')), 'with no tools, research looks for projects that need nothing else');
});

test('CASE B — the same bottle + tape WITH scissors: cut projects become cards and every cut names the scissors', async () => {
  mode = 'bottle';
  const r = await ideation.generateIdeas({ freeText: '1 plastic bottle, tape', tools: ['Scissors'], quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok');
  for (const n of ['Bottle funnel', 'Bottle scoop', 'Bottle rolling pin']) assert.ok(names(r).includes(n), `${n} missing from ${names(r)}`);
  const penHolder = r.ideas.find((i) => /Bottle pen(cil)? (holder|organizer)/.test(i.name));
  assert.ok(penHolder, 'the cut pen holder is now buildable');
  assert.ok(r.ideas.length >= 7, names(r).join(', '));
  for (const i of r.ideas) for (const s of i.steps.filter((x) => CUTS.test(x))) assert.match(s, /scissors/i, `${i.name}: "${s}"`);
  assert.equal(names(r).filter((n) => /Bottle pen(cil)? (holder|organizer)/.test(n)).length, 1, 'still one pen holder');
  assert.match(penHolder.safetyNote, /sharp/i, 'cut plastic gets a short, relevant warning');
  assert.ok(/scissors/.test(r.research.queries.join(' | ')), 'research uses the tools');
});

test('CASE C — glass jar + shoelace: no "vase" rename, no drilled glass; a tied holder is allowed with a warning; ONE item unlocks more', async () => {
  mode = 'jar-lace';
  const r = await ideation.generateIdeas({ freeText: 'glass jar, shoelace', quantity: 1, currency: 'GEL' }, []);
  assert.ok(!names(r).some((n) => /vase/i.test(n)), names(r).join(', '));
  assert.match(reasonFor(r, 'Glass jar vase'), /same object under a new name/);
  assert.match(reasonFor(r, 'Drilled jar lamp'), /cut or drill glass/);
  assert.deepEqual(names(r), ['Hanging jar holder']);
  assert.match(r.ideas[0].safetyNote, /hang it low/i);
  assert.equal(r.status, 'ok');
  assert.equal(r.unlock.item, 'Garden wire', 'one item — not a shopping list');
  assert.equal(r.unlock.checked, true);
  assert.deepEqual(r.unlock.ideas.map((i) => i.name).sort(), ['Wall jar hanger', 'Wire-handled jar carrier']);
});

test('CASE D — glass jar + tape + glue: renames and unsafe glass rejected → honest message and ONE item with what it unlocks', async () => {
  mode = 'jar-tape';
  const r = await ideation.generateIdeas({ freeText: 'glass jar, tape and glue', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'unlock');
  assert.deepEqual(r.ideas, [], 'no fake project');
  assert.equal(r.message, 'I couldn’t find a strong, realistic project using only these materials.');
  assert.match(reasonFor(r, 'Jar vase'), /same object/);
  assert.match(reasonFor(r, 'Taped wall jar holder'), /tape can’t safely hold up a glass/);
  assert.match(reasonFor(r, 'Cut jar candle holder'), /cut or drill glass/);
  assert.match(r.unlock.item, /twine/i);
  assert.equal(r.unlock.ideas.length, 2);
  assert.ok(r.unlock.ideas.every((i) => i.usesExisting.some((u) => u.inventoryName === 'glass jar') && /twine/i.test(i.missing[0].name)), 'each unlocked project says what it uses');
  assert.equal(r.unlock.why, JAR_TAPE_UNLOCK.why);
});

test('CASE E — 3 pine boards, screws, glue, sandpaper + hammer, hand saw: many real woodworking ideas; no power tools; screws need a screwdriver', async () => {
  mode = 'wood';
  const r = await ideation.generateIdeas({ freeText: '3 pine boards, screws, wood glue, sandpaper, hammer, hand saw', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok', r.message);
  assert.ok(r.ideas.length >= 6, names(r).join(', '));
  for (const i of r.ideas) {
    const boards = i.usesExisting.filter((u) => /pine/i.test(u.inventoryName)).reduce((s, u) => s + u.quantityUsed, 0);
    assert.ok(boards <= 3, `${i.name} uses ${boards} boards`);
    assert.ok(!i.toolsRequired.some((t) => /drill|driver|jigsaw|sander/i.test(t)), `${i.name}: ${i.toolsRequired}`);
    assert.ok(i.steps.length >= 3 && i.steps.every((s) => s.split(' ').length >= 6), 'detailed steps');
  }
  assert.match(reasonFor(r, 'Drilled pegboard'), /Drill/);
  assert.match(reasonFor(r, 'Screwed pine crate'), /Screwdriver/, 'a hammer does not drive screws');
  assert.ok(!names(r).includes('Giant bookcase'), 'needs more boards than the 3 owned');
  assert.equal(names(r).filter((n) => /wall shelf/i.test(n)).length, 1);
});

test('CASE F — one shoelace: no nonsense project, exactly one addition and what it unlocks', async () => {
  mode = 'lace';
  const r = await ideation.generateIdeas({ freeText: 'one shoelace', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'unlock');
  assert.deepEqual(r.ideas, []);
  assert.match(reasonFor(r, 'Shoelace keychain'), /vague/);
  assert.equal(r.unlock.item, 'a handful of wooden beads');
  assert.equal(r.unlock.checked, false, 'the model’s suggestion, labelled as not yet checked');
  assert.ok(r.unlock.ideas.length >= 2 && r.unlock.ideas.every((i) => i.uses.includes('wooden beads')));
});

test('CASE F — an "addition" the user already owns is never suggested; the answer stays honest', async () => {
  mode = 'lace-owned';
  const r = await ideation.generateIdeas({ freeText: 'one shoelace', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'no_ideas');
  assert.equal(r.unlock, null);
});

test('rich inventory: different subsets, high diversity, renamed jars dropped, no near-duplicate cards', async () => {
  mode = 'rich';
  const r = await ideation.generateIdeas({ tools: ['Saw', 'Drill / driver', 'Scissors', 'Hot-glue gun'], quantity: 1, currency: 'GEL' }, RICH);
  assert.equal(r.status, 'ok', r.message);
  assert.ok(r.ideas.length >= 8, names(r).join(', '));
  assert.ok(!names(r).some((n) => /jar (pen holder|pencil cup)/i.test(n)), 'a painted jar is still just a jar');
  const subsets = new Set(r.ideas.map((i) => i.usesExisting.map((u) => u.inventoryName).sort().join('+')));
  assert.ok(subsets.size >= 7, 'different combinations of items');
  assert.ok(new Set(r.ideas.flatMap((i) => i.usesExisting.map((u) => u.inventoryName))).size >= 9, 'most items are used somewhere');
  assert.ok(r.ideas.some((i) => i.usesExisting.length <= 2) && r.ideas.some((i) => i.usesExisting.length >= 3), 'small and larger subsets');
  for (const a of r.ideas) for (const b of r.ideas) if (a !== b) assert.ok(!ideation.isNearDuplicate(a.name, b.name), `${a.name} ~ ${b.name}`);
});

test('search failing: ideas still come from the model’s own reasoning, and that is said', async () => {
  mode = 'bottle';
  searchStatusCode = 500;
  (await import('../server/services/ideaResearch.js')).resetResearchCache();
  const r = await ideation.generateIdeas({ freeText: '1 plastic bottle, tape', quantity: 1, currency: 'GEL' }, []);
  searchStatusCode = 200;
  assert.equal(r.status, 'ok');
  assert.ok(r.ideas.length >= 4);
  assert.match(r.research.error, /own reasoning/);
});

test('research variety: different query angles, at most 3 results per site', async () => {
  const research = await import('../server/services/ideaResearch.js');
  research.resetResearchCache();
  SEARCH_RESULTS = [1, 2, 3, 4, 5].map((n) => ({ url: `https://one-site.example/p${n}`, title: `Project ${n}`, content: '' })).concat([{ url: 'https://other.example/x', title: 'Other', content: '' }]);
  const r = await research.researchIdeas({ text: 'glass jar, twine', tools: ['scissors'] });
  assert.equal(r.sources.filter((s) => s.url.includes('one-site.example')).length, 3);
  assert.ok(r.sources.some((s) => s.url.includes('other.example')));
  assert.equal(new Set(r.queries).size, r.queries.length);
  assert.ok(r.queries.some((q) => /scissors/.test(q)) && r.queries.some((q) => /^DIY projects/.test(q)));
});
