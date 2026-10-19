// Gemini request count and rate limits on /api/ideas, against a LOCAL MOCK of the Gemini API:
// one Gemini call per request (the typed inventory is parsed on the server, research uses no
// Gemini), a 429 stops everything with one clean answer and Retry-After, nothing is sent to Gemini
// until the wait is over, DuckDuckGo blocking (403) fails fast, and AI_IMAGES=off means no images.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGeminiMock, useMock } from './gemini-mock.js';

const IDEAS = JSON.stringify({
  inputRecognized: true, unrecognizedReason: '', enoughForStrongProjects: true, unlock: { item: '', why: '', estPrice: 0, ideas: [] }, notes: '',
  ideas: [['Bottle pen holder', 'Cut around the bottle 10 cm from the bottom.'], ['Bottle funnel', 'Cut off the top third just below the shoulder.'], ['Bottle scoop', 'Cut away the bottom and one side below the handle.']].map(([name, cut]) => ({
    name, summary: `${name}.`, whyFeasible: 'Bottle, tape and scissors are enough.', category: 'Home', primaryMaterial: 'plastic bottle',
    usesExisting: [{ inventoryName: 'plastic bottle', quantityUsed: 1, unit: 'pcs', use: 'body' }, { inventoryName: 'tape', quantityUsed: 1, unit: 'roll', use: 'edges' }],
    missing: [], toolsRequired: ['Scissors'], difficulty: 'beginner', estProductionMinutes: 15, size: { length: 80, width: 80, height: 100 }, safetyNote: '', dependsOnMeasurements: [],
    steps: ['Place the bottle on a flat table.', cut, 'Fold tape over the cut edge, half inside and half outside.'], potentialUse: 'At home.', sellable: { realistic: false, note: '' }, sourceRefs: [], look: `${name} from a clear bottle with taped edges.`, visualKind: 'generic',
  })),
});

let mode = 'ok';
let mock;
let app;
let srv;
let base;
let ddgRequests = 0;
const perfLines = [];
const realFetch = globalThis.fetch;

before(async () => {
  mock = await startGeminiMock(() => (mode === '429' ? { status: 429, error: 'Resource has been exhausted (e.g. check quota).', retryDelay: '2s' } : IDEAS));
  useMock(mock, { SEARCH_PROVIDER: 'duckduckgo', AI_IMAGES: 'off' });
  // DuckDuckGo blocks this "server" (as it often blocks cloud IPs): every request gets a 403.
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('duckduckgo.com')) {
      ddgRequests += 1;
      return new Response('Forbidden', { status: 403 });
    }
    return realFetch(url, init);
  };
  const log = console.log;
  console.log = (...args) => {
    if (String(args[0]).startsWith('[perf]')) perfLines.push(String(args[0]));
    log(...args);
  };
  app = (await import('../server/app.js')).default;
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
});
after(() => {
  globalThis.fetch = realFetch;
  srv.close();
  mock.close();
});

const postIdeas = () => realFetch(`${base}/ideas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ freeText: 'plastic bottle, tape', tools: ['Scissors'], quantity: 1 }) });
const lastTotal = () => perfLines.filter((l) => l.startsWith('[perf] total /api/ideas')).at(-1);

test('a normal /api/ideas makes exactly ONE Gemini call; a DuckDuckGo 403 fails fast and research is skipped afterwards', async () => {
  mode = 'ok';
  mock.calls = [];
  const t0 = Date.now();
  const res = await postIdeas();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(body.ideas.length >= 3);
  assert.equal(mock.calls.length, 1, 'one Gemini request');
  assert.match(lastTotal(), /Gemini API calls: 1$/);
  assert.match(body.research.error || '', /own reasoning/, 'search failed, ideas came anyway');
  assert.ok(Date.now() - t0 < 2000, 'the 403 did not hold anything up');
  const after403 = ddgRequests;
  assert.ok(after403 >= 1 && after403 <= 2);
  // The next request does not knock on DuckDuckGo again.
  await (await postIdeas()).json();
  assert.equal(ddgRequests, after403, 'no further DuckDuckGo requests while it is blocking this server');
});

test('a 429 stops the pipeline: one Gemini call, one clean busy answer with Retry-After — no retry', async () => {
  mode = '429';
  mock.calls = [];
  const res = await postIdeas();
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, 'ai_rate_limited');
  assert.equal(body.retryable, true);
  assert.equal(body.retryAfter, 2);
  assert.equal(res.headers.get('retry-after'), '2', 'Google’s retryDelay is passed on');
  assert.match(body.error, /busy/);
  assert.equal(mock.calls.length, 1, 'not retried');
  // The final [perf] line is written for the 429 too: research time, retryAfter, Gemini calls.
  assert.match(lastTotal(), /error: ai_rate_limited\) · research: (\d+ ms|skipped) · retryAfter: 2 s · Gemini API calls: 1$/);
});

test('during the wait, /api/ideas answers at once without sending anything to Gemini; afterwards it works again', async () => {
  mode = 'ok';
  mock.calls = [];
  const res = await postIdeas();
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, 'ai_rate_limited');
  assert.ok(body.retryAfter >= 1 && body.retryAfter <= 2);
  assert.equal(mock.calls.length, 0, 'no Gemini request while rate-limited');
  assert.match(lastTotal(), /research: skipped · retryAfter: [12] s · Gemini API calls: 0$/, 'stopped before research and before Gemini');
  const health = await (await realFetch(`${base}/health`)).json();
  assert.equal(health.ai.status.state, 'rate_limited');
  assert.ok(health.ai.status.retryAt);
  await new Promise((r) => setTimeout(r, 2100));
  const again = await postIdeas();
  assert.equal(again.status, 200);
  assert.equal(mock.calls.length, 1);
});

test('AI_IMAGES=off: the image endpoint answers "off" and never calls Gemini', async () => {
  mock.imageCalls = [];
  const res = await realFetch(`${base}/ideas/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idea: { name: 'Bottle pen holder' } }) });
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, 'images_off');
  assert.equal(mock.imageCalls.length, 0);
  const health = await (await realFetch(`${base}/health`)).json();
  assert.equal(health.ai.images.state, 'off', 'the browser reads this and does not ask for pictures');
});
