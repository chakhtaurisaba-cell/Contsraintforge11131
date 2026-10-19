// Assistant function calling against a LOCAL MOCK of the Gemini API and a local stand-in for
// a SearXNG search server: Gemini asks for web_search, the app runs the search for real, the
// model's turn goes back unchanged and the result is returned as a functionResponse. Links
// that the search returned survive; invented ones are removed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGeminiMock, useMock } from './gemini-mock.js';

const TUTORIAL = 'https://www.familyhandyman.com/project/how-to-build-a-shelf/';
let mock;
let searx;
let client;

before(async () => {
  searx = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [{ url: TUTORIAL, title: 'How to build a shelf', content: 'Step-by-step pine shelf.' }] }));
  });
  await new Promise((r) => searx.listen(0, '127.0.0.1', r));
  mock = await startGeminiMock((call) => {
    // First turn: ask for a search. Second turn (after the tool result): answer with links.
    if (!call.messages.some((m) => m.role === 'tool')) return { functionCalls: [{ name: 'web_search', args: { query: 'pine shelf tutorial' } }] };
    return `Try this guide: ${TUTORIAL} — or https://invented.example/shelf`;
  });
  useMock(mock, { SEARCH_PROVIDER: 'searxng', SEARXNG_URL: `http://127.0.0.1:${searx.address().port}` });
  client = await import('../server/ai/client.js');
  await client.probeAI();
});
after(() => {
  mock.close();
  searx.close();
});

test('assistant: Gemini function call → real search → functionResponse → verified links only', async () => {
  const r = await client.chatWithResearch({ system: 'test', messages: [{ role: 'user', content: 'Find me a shelf tutorial' }] });
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(mock.calls[0].tools.map((t) => t.name), ['web_search', 'web_fetch'], 'tools are declared to Gemini');
  const second = mock.calls[1].raw.contents;
  assert.ok(second.some((c) => c.role === 'model' && c.parts.some((p) => p.functionCall?.name === 'web_search')), 'the model turn is sent back');
  const fr = second.at(-1).parts[0].functionResponse;
  assert.equal(fr.name, 'web_search');
  assert.match(fr.response.result, /familyhandyman/, 'the real search result is returned to the model');
  assert.equal(r.searched, true);
  assert.ok(r.text.includes(TUTORIAL));
  assert.ok(!r.text.includes('invented.example'), r.text);
  assert.deepEqual(r.sources.map((s) => s.url), [TUTORIAL]);
});
