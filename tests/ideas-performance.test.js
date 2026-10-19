// /api/ideas speed and timeouts, against a LOCAL MOCK of the Gemini API and a local search stand-in:
// one structured idea call (low thinking), research capped at a few seconds and never blocking,
// a total time budget with stage-specific timeout errors and no doomed retries, [perf] timings,
// and no image generation inside /api/ideas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGeminiMock, useMock } from './gemini-mock.js';

const idea = (name, uses, steps, o = {}) => ({
  name, summary: `${name}.`, whyFeasible: `Uses ${uses.join(' and ')}.`, category: 'Home', primaryMaterial: uses[0],
  usesExisting: uses.map((inventoryName) => ({ inventoryName, quantityUsed: 1, unit: 'pcs', use: 'part' })),
  missing: [], toolsRequired: [], difficulty: 'beginner', estProductionMinutes: 15, size: { length: 100, width: 80, height: 120 },
  safetyNote: '', dependsOnMeasurements: [], steps, potentialUse: 'At home.', sellable: { realistic: false, note: '' }, sourceRefs: [], look: `${name} made of ${uses.join(' and ')}.`, visualKind: 'generic', ...o,
});
const answer = (ideas, o = {}) => JSON.stringify({ ideas, enoughForStrongProjects: true, unlock: { item: '', why: '', estPrice: 0, ideas: [] }, notes: '', ...o });
const parsed = (materials) => JSON.stringify({ recognized: true, unrecognizedReason: '', materials: materials.map(([name, material]) => ({ name, material, quantity: 1, quantityStated: true, unit: 'pcs', size: null })), tools: [], skills: [], budget: null, currency: null, hoursPerWeek: null });

const BOTTLE = [
  idea('Bottle pen holder', ['plastic bottle', 'tape'], ['Place the bottle upright on a flat table.', 'Cut around the bottle 10 cm from the bottom.', 'Fold tape over the cut edge, half inside and half outside.']),
  idea('Bottle funnel', ['plastic bottle', 'tape'], ['Hold the bottle on its side on the table.', 'Cut off the top third just below the shoulder.', 'Tape over the cut rim so it is smooth.']),
  idea('Bottle scoop', ['plastic bottle', 'tape'], ['Lay the bottle on its side with the handle up.', 'Cut away the bottom and one side below the handle.', 'Tape over all cut edges.']),
  idea('Bottle rolling pin', ['plastic bottle', 'tape'], ['Fill the bottle with cold water and screw the cap on.', 'Wrap two turns of tape around the cap.', 'Roll dough with the bottle on its side.']),
];
const JAR = [
  idea('Glass jar vase', ['glass jar', 'shoelace'], ['Tie the shoelace around the jar in a bow.', 'Fill the jar with water and add flowers.'], { visualKind: 'vase' }),
  idea('Hanging jar holder', ['glass jar', 'shoelace'], ['Tie the shoelace twice around the jar neck and knot it.', 'Knot both ends together 20 cm above the jar as a loop.', 'Hang the jar from the loop and check it sits level.']),
];

let searchDelay = 0;
let mock;
let searx;
let ideation;
let app;
const perfLines = [];

before(async () => {
  searx = http.createServer((req, res) => setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [{ url: 'https://example.org/bottle-crafts', title: 'Bottle crafts', content: 'Pen holders, funnels and scoops.' }] }));
  }, searchDelay));
  await new Promise((r) => searx.listen(0, '127.0.0.1', r));
  mock = await startGeminiMock((call) => {
    const sys = call.messages[0].content;
    const user = call.messages.at(-1).content;
    if (sys.startsWith('You extract a structured inventory')) {
      if (/plastic bottle/.test(user)) return parsed([['plastic bottle', 'plastic'], ['tape', 'adhesive']]);
      if (/glass jar/.test(user)) return parsed([['glass jar', 'glass'], ['shoelace', 'cotton']]);
      return parsed([]);
    }
    if (/glass jar/.test(user)) return answer(JAR, { enoughForStrongProjects: false, unlock: { item: 'a small S-hook', why: 'Hangs the tied jar safely from a rail.', estPrice: 1, ideas: [{ name: 'Rail-hung jar holder', summary: 'Hangs from a kitchen rail.', uses: ['glass jar', 'shoelace', 'S-hook'] }] } });
    return answer(BOTTLE);
  });
  // A small time budget and research limit, so the limits can be tested quickly.
  useMock(mock, { SEARCH_PROVIDER: 'searxng', SEARXNG_URL: `http://127.0.0.1:${searx.address().port}`, AI_IDEAS_BUDGET_MS: '3000', AI_RESEARCH_TIMEOUT_MS: '500' });
  const log = console.log;
  console.log = (...args) => {
    if (String(args[0]).startsWith('[perf]')) perfLines.push(String(args[0]));
    log(...args);
  };
  ideation = await import('../server/services/ideation.js');
  app = (await import('../server/app.js')).default;
});
after(() => {
  mock.close();
  searx.close();
});

/** POST /api/ideas the way the browser does (streamed), returning the final event and the progress. */
async function streamIdeas(body) {
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/ideas`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(body) });
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  srv.close();
  return { final: lines.at(-1), progress: lines.filter((l) => l.type === 'progress') };
}

test('production-like: plastic bottle + tape + scissors → cards from ONE idea call, no image calls, [perf] timings for every stage', async () => {
  searchDelay = 0;
  mock.calls = [];
  mock.imageCalls = [];
  perfLines.length = 0;
  const t0 = Date.now();
  const { final, progress } = await streamIdeas({ freeText: 'plastic bottle, tape', tools: ['Scissors'], quantity: 1 });
  assert.equal(final.type, 'result', JSON.stringify(final));
  assert.equal(final.data.status, 'ok');
  assert.ok(final.data.ideas.length >= 3, final.data.ideas.map((i) => i.name).join(', '));
  assert.ok(final.data.ideas.every((i) => i.steps.filter((s) => /\bcut\b(?!\s+(edge|rim))/i.test(s)).every((s) => /scissors/i.test(s))), 'the quality gate still runs');
  assert.equal(mock.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine')).length, 1, 'one idea call');
  assert.equal(mock.calls.length, 2, 'parse + ideas — nothing else');
  assert.equal(mock.imageCalls.length, 0, 'pictures are never generated inside /api/ideas');
  assert.deepEqual([...new Set(progress.map((p) => p.stage))], ['parsing', 'researching', 'ideas', 'checking']);
  for (const stage of ['research', 'inventory parse', 'Gemini ideas', 'validation', 'total ideas pipeline', 'total /api/ideas']) assert.ok(perfLines.some((l) => l.startsWith(`[perf] ${stage}`)), `missing [perf] ${stage}: ${perfLines.join(' | ')}`);
  assert.ok(Date.now() - t0 < 2500);
});

test('production-like: glass jar + shoelace → the vase rename is rejected, one tied holder card, ONE item suggested; no image calls', async () => {
  mock.imageCalls = [];
  const { final } = await streamIdeas({ freeText: 'glass jar, shoelace', quantity: 1 });
  assert.equal(final.type, 'result');
  assert.deepEqual(final.data.ideas.map((i) => i.name), ['Hanging jar holder']);
  assert.match(final.data.rejected.find((x) => x.name === 'Glass jar vase').reason, /same object/);
  assert.equal(final.data.unlock.item, 'a small S-hook');
  assert.equal(mock.imageCalls.length, 0);
});

test('slow search never holds up the ideas: whatever arrived within the research limit is used, then Gemini starts', async () => {
  searchDelay = 5000;
  (await import('../server/services/ideaResearch.js')).resetResearchCache();
  mock.calls = [];
  const t0 = Date.now();
  const r = await ideation.generateIdeas({ freeText: 'plastic bottle, tape', tools: ['Scissors'], quantity: 1, currency: 'GEL' }, []);
  const ms = Date.now() - t0;
  searchDelay = 0;
  assert.equal(r.status, 'ok');
  assert.ok(ms < 1500, `took ${ms} ms despite a 5 s search`);
  assert.match(r.research.error, /took too long/);
});

test('a Gemini answer slower than the time budget: one timeout naming the stage, no doomed retry, diagnostic in /api/health', async () => {
  mock.delayMs = 4500; // longer than the 3 s budget
  mock.calls = [];
  const t0 = Date.now();
  const inventory = [{ id: 'b', name: 'plastic bottle', material: 'plastic', quantity: 2, unit: 'pcs' }, { id: 't', name: 'tape', material: 'adhesive', quantity: 1, unit: 'roll' }];
  await assert.rejects(ideation.generateIdeas({ tools: ['Scissors'], quantity: 1, currency: 'GEL' }, inventory), (e) => e.code === 'ai_timeout' && e.stage === 'product ideas' && /while designing products/.test(e.message) && e.retryable === true);
  const ms = Date.now() - t0;
  mock.delayMs = 0;
  assert.ok(ms < 4000, `gave up after ${ms} ms (budget 3000)`);
  assert.equal(mock.calls.length, 1, 'no second attempt that could not finish in time');
  const { aiStatus } = await import('../server/ai/client.js');
  assert.equal(aiStatus().lastTimeout.stage, 'product ideas');
});
