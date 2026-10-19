// Card pictures against a LOCAL MOCK of Google's Interactions API (POST /v1beta/interactions).
// Checks the request ConstraintForge sends, caching, the daily cap, and that an account without
// image access (Google's image models have no free tier) degrades quietly — never failing ideas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGeminiMock, useMock, MOCK_KEY } from './gemini-mock.js';

let mock;
let images;
let config;
const shelf = {
  name: 'Pine wall shelf',
  summary: 'A small shelf for books, glued from one pine board.',
  kind: 'wall_shelf',
  usesExisting: [{ inventoryName: 'pine boards', use: 'shelf and brackets' }, { inventoryName: 'wood glue', use: 'joints' }],
  missing: [],
  size: { length: 600, width: 150, height: 150 },
};

before(async () => {
  mock = await startGeminiMock(() => '{}');
  useMock(mock);
  images = await import('../server/ai/images.js');
  ({ config } = await import('../server/config.js'));
});
after(() => mock.close());

test('a picture of THIS idea: official Interactions request, the idea’s own materials in the prompt, key only in the header', async () => {
  mock.imageCalls = [];
  const r = await images.ideaImage(shelf);
  assert.match(r.src, /^data:image\/jpeg;base64,\/9j\//, 'a JPEG data URL');
  assert.equal(r.model, 'gemini-nano-banana-2.1');
  assert.equal(r.cached, false);
  assert.equal(mock.imageCalls.length, 1);
  const body = mock.imageCalls[0];
  assert.equal(body.model, 'gemini-nano-banana-2.1');
  assert.deepEqual(body.response_format, { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '4:3', image_size: '1K' });
  assert.match(body.input, /^Create a photorealistic image of the finished DIY object "Pine wall shelf"/);
  assert.match(body.input, /exactly these materials, and nothing else: pine boards \(shelf and brackets\); wood glue \(joints\)/);
  assert.match(body.input, /about 60 × 15 × 15 cm/);
  assert.match(body.input, /Do not show any [^\n]*screws, nails, bolts or brackets[^\n]*tape/, 'materials the shelf does not use are forbidden');
  assert.ok(!/Do not show any [^\n]*\bwood,/.test(body.input), 'its own material is not forbidden');
  assert.match(body.input, /Do not make it look factory manufactured/);
  assert.match(body.input, /No text, logos, captions, diagrams, labels/);
  assert.equal(mock.lastKey, MOCK_KEY);
  assert.ok(!JSON.stringify(body).includes(MOCK_KEY), 'the key is never in the body');
});

test('visual spec from the card itself: bottle + tape only → wood, screws, rope, glue, electronics and fabric are forbidden; look and steps are used', () => {
  const bottle = {
    name: 'Plastic bottle desk organizer',
    summary: 'A pen cup cut from a bottle, its rim covered with tape.',
    look: 'The bottom 10 cm of a clear bottle, its cut rim wrapped in a band of tape.',
    usesExisting: [{ inventoryName: 'plastic bottle', quantityUsed: 1, unit: 'pcs', use: 'organizer body' }, { inventoryName: 'tape', quantityUsed: 1, unit: 'roll', use: 'rim cover' }],
    steps: ['Place the bottle upright on a flat table.', 'Cut around the bottle 10 cm from the bottom (use your scissors).', 'Fold tape over the cut edge, half inside and half outside.'],
  };
  const v = images.visualSpec(bottle);
  assert.equal(v.projectName, 'Plastic bottle desk organizer');
  assert.deepEqual(v.visibleMaterials, ['1 pcs plastic bottle (organizer body)', '1 roll tape (rim cover)']);
  assert.equal(v.finalShape, bottle.look);
  assert.match(v.constructionMethod, /Cut around the bottle 10 cm from the bottom\./, 'the "(use your scissors)" note is not drawn');
  for (const f of ['wood', 'screws, nails, bolts or brackets', 'metal parts', 'rope, cord, string or laces', 'glue blobs', 'wires, LEDs or electronics', 'fabric']) assert.ok(v.forbiddenMaterials.includes(f), f);
  assert.ok(!v.forbiddenMaterials.includes('tape') && !v.forbiddenMaterials.includes('plastic bottles'));
  assert.ok(v.importantVisualDetails.includes('believable hand-cut edges'));
  const prompt = images.imagePrompt(bottle);
  assert.match(prompt, /The bottom 10 cm of a clear bottle/);
  assert.match(prompt, /the picture must match this construction/);
  assert.notEqual(images.imageKey(bottle), images.imageKey({ ...bottle, steps: ['Wrap tape around the whole bottle.', 'Stand it on the desk.'] }), 'a different build is a different picture');
});

test('a transient failure is retried once; the second answer is used', async () => {
  let n = 0;
  mock.onImage = () => (++n === 1 ? { status: 500, error: 'Internal error' } : null);
  mock.imageCalls = [];
  const r = await images.ideaImage({ ...shelf, name: 'Pine shoe rack', summary: 'A low rack for shoes.' });
  assert.equal(mock.imageCalls.length, 2);
  assert.match(r.src, /^data:image\/jpeg;base64,/);
  mock.onImage = () => null;
});

test('the same idea is never generated (or paid for) twice; a different idea gets its own picture', async () => {
  mock.imageCalls = [];
  const again = await images.ideaImage({ ...shelf });
  assert.equal(again.cached, true);
  assert.equal(mock.imageCalls.length, 0);
  await images.ideaImage({ ...shelf, name: 'Pine phone stand', summary: 'Holds a phone on a desk.' });
  assert.equal(mock.imageCalls.length, 1);
  assert.notEqual(images.imageKey(shelf), images.imageKey({ ...shelf, name: 'Pine phone stand' }));
});

test('daily cap: no new pictures past AI_IMAGE_DAILY_LIMIT (cached ones still show)', async () => {
  const saved = config.ai.images.dailyLimit;
  config.ai.images.dailyLimit = images.imageStatus().usedToday;
  mock.imageCalls = [];
  await assert.rejects(images.ideaImage({ ...shelf, name: 'Pine coaster set' }), (e) => e.code === 'daily_limit');
  assert.equal(mock.imageCalls.length, 0);
  assert.equal((await images.ideaImage(shelf)).cached, true);
  config.ai.images.dailyLimit = saved;
});

test('no image access (no free tier): a clear reason, later pictures are not attempted, and the route answers 503 with a code', async () => {
  mock.onImage = () => ({ status: 400, error: 'Image generation is not available in the free tier. Please enable billing for this API key. (FAILED_PRECONDITION)' });
  mock.imageCalls = [];
  await assert.rejects(images.ideaImage({ ...shelf, name: 'Pine tray' }), (e) => e.code === 'needs_billing' && /paid Gemini API plan/.test(e.message));
  const s = images.imageStatus();
  assert.equal(s.state, 'needs_billing');
  assert.match(s.reason, /no free tier/);
  await assert.rejects(images.ideaImage({ ...shelf, name: 'Pine box' }), (e) => e.code === 'needs_billing');
  assert.equal(mock.imageCalls.length, 1, 'not retried for every card');

  const app = (await import('../server/app.js')).default;
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/ideas/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idea: { name: 'Pine bookends', summary: 'Two bookends.' } }) });
  const json = await res.json();
  assert.equal(res.status, 503);
  assert.equal(json.code, 'images_needs_billing');
  const health = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/health`)).json();
  assert.equal(health.ai.images.state, 'needs_billing');
  assert.equal(health.ai.images.model, 'gemini-nano-banana-2.1');
  assert.equal(health.ai.enabled, true, 'text AI is unaffected');
  srv.close();
});
