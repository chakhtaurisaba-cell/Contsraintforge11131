// Research honesty (requirement tests 6, 7): links the model invents never reach the user,
// and page reading cannot be pointed at the local machine or private networks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGeminiMock, useMock } from './gemini-mock.js';

let reply = '';
let mock;
let client;
let search;

before(async () => {
  mock = await startGeminiMock(() => reply);
  useMock(mock);
  client = await import('../server/ai/client.js');
  search = await import('../server/ai/search.js');
  await client.probeAI();
});
after(() => mock.close());

test('page reading only allows public http(s) hosts', () => {
  for (const bad of ['http://localhost:8787/api/settings', 'http://127.0.0.1/', 'http://192.168.1.10/', 'http://10.0.0.5/x', 'http://[::1]/', 'file:///C:/Windows/win.ini', 'http://router.local/']) {
    assert.equal(search.isPublicUrl(bad), false, bad);
  }
  assert.equal(search.isPublicUrl('https://www.instructables.com/Simple-Shelf/'), true);
});

test('assistant: an invented link is removed; a link from the app’s own research data is kept', async () => {
  reply = 'Follow this guide: https://made-up-guide.example/shelf and see [the source](https://www.familyhandyman.com/project/how-to-build-a-shelf/).';
  const appData = '<app_data>{"research":{"sources":[{"url":"https://www.familyhandyman.com/project/how-to-build-a-shelf/"}]}}</app_data>';
  const r = await client.chatWithResearch({ system: 'test', messages: [{ role: 'user', content: `Find a tutorial\n\n${appData}` }] });
  assert.ok(!r.text.includes('made-up-guide.example'), r.text);
  assert.match(r.text, /link removed/);
  assert.deepEqual(r.sources.map((s) => s.url), ['https://www.familyhandyman.com/project/how-to-build-a-shelf/']);
  assert.equal(r.searched, false, 'search is off in tests, so it never claims to have searched');
});

test('URL check keeps the query: a different video on the same site is not "verified"', () => {
  const n = client.normalizeUrl;
  assert.notEqual(n('https://www.youtube.com/watch?v=7azDDgpdpa0'), n('https://www.youtube.com/watch?v=Goc-cI8Ofvg'));
  assert.equal(n('https://www.example.com/guide/?utm_source=x&id=2'), n('https://example.com/guide?id=2'), 'tracking params and www are ignored');
});

test('assistant: a link to another page on a searched site is still removed', async () => {
  reply = 'Watch https://www.youtube.com/watch?v=7azDDgpdpa0';
  const r = await client.chatWithResearch({ system: 'test', messages: [{ role: 'user', content: 'see https://www.youtube.com/watch?v=Goc-cI8Ofvg' }] });
  assert.ok(!r.text.includes('7azDDgpdpa0'), r.text);
});

test('web research refuses to run without a search provider instead of answering from memory', async () => {
  await assert.rejects(client.webResearch({ system: 's', prompt: 'p' }), (e) => e.code === 'search_not_configured');
});
