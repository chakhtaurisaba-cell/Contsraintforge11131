// The generation flow in prompt mode (AI_JSON_MODE=prompt — the Ollama Cloud default), against a
// stand-in server that behaves like a model WITHOUT structured outputs: it ignores `format`,
// wraps JSON in prose and fences, sends numbers as strings, omits fields, or answers only in
// its reasoning. Everything after the model is the real application code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startOllamaMock, useMock } from './ollama-mock.js';

let mode = 'messy';
let mock;
let ideation;

const parseReply = JSON.stringify({ recognized: true, unrecognizedReason: '', materials: [{ name: 'pine boards', material: 'wood', quantity: 6, quantityStated: true, unit: 'pcs' }, { name: 'wood screws', material: 'steel', quantity: 100, quantityStated: true, unit: 'pcs' }], tools: ['saw', 'drill'], skills: [], budget: null, currency: null, hoursPerWeek: null });
// Deliberately sloppy: string numbers, "Beginner", a missing size/safetyNote/visualKind, prose around it.
const sloppyIdeas = 'Here are some ideas for you!\n```json\n' + JSON.stringify({
  ideas: [
    { name: 'Wall shelf', summary: 'A small wall shelf.', category: 'Home', primaryMaterial: 'pine boards', usesExisting: [{ inventoryName: 'pine boards', quantityUsed: '1', unit: 'pcs', use: 'shelf' }, { inventoryName: 'wood screws', quantityUsed: '8', unit: 'pcs', use: 'fixing' }], missing: [], toolsRequired: ['Saw'], difficulty: 'Beginner', estProductionMinutes: '45 minutes', dependsOnMeasurements: [] },
    { name: 'Wooden box', summary: 'A box for small things.', category: 'Storage', primaryMaterial: 'pine boards', usesExisting: [{ inventoryName: 'pine boards', quantityUsed: 1, unit: 'pcs', use: 'sides' }], missing: [], toolsRequired: [], difficulty: 'easy', estProductionMinutes: 60, size: { length: '300', width: 200, height: 150 }, safetyNote: '', dependsOnMeasurements: [], visualKind: 'box' },
  ],
  notes: '',
}, null, 2) + '\n```\nLet me know if you want more!';

before(async () => {
  mock = await startOllamaMock((body, state) => {
    const sys = body.messages[0].content;
    if (sys.startsWith('You extract a structured inventory')) return mode === 'thinking' ? { content: '', thinking: parseReply } : `Sure: ${parseReply}`;
    if (sys.startsWith('You are the product-ideation engine')) {
      if (mode === 'retry') {
        const ideaCalls = state.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine')).length;
        if (ideaCalls === 1) return 'I would suggest a wall shelf and a box, they are both great options.';
      }
      if (mode === 'garbage') return 'Sorry, I cannot help with that.';
      return sloppyIdeas;
    }
    return '{}';
  });
  useMock(mock, { AI_JSON_MODE: 'prompt' });
  ideation = await import('../server/services/ideation.js');
});
after(() => mock.close());

const lastIdeaCall = () => mock.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine')).at(-1);

test('prompt mode: no `format` is sent; the JSON shape is in the instructions', async () => {
  mode = 'messy';
  mock.calls = [];
  await ideation.generateIdeas({ freeText: 'I have 6 pine boards, 100 wood screws, a saw and a drill', quantity: 1, currency: 'GEL' }, []);
  const call = lastIdeaCall();
  assert.equal(call.format, undefined, 'no structured-output schema is sent');
  assert.match(call.messages[0].content, /OUTPUT FORMAT — reply with ONE JSON object/);
  assert.ok(call.messages[0].content.includes('"difficulty":"beginner|intermediate|advanced"'));
});

test('prompt mode: a sloppy reply (prose, fences, string numbers, missing fields) still gives ideas', async () => {
  mode = 'messy';
  const r = await ideation.generateIdeas({ freeText: 'I have 6 pine boards, 100 wood screws, a saw and a drill', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok', r.message);
  const shelf = r.ideas.find((i) => i.name === 'Wall shelf');
  assert.ok(shelf, JSON.stringify(r.rejected));
  assert.equal(shelf.difficulty, 'beginner');
  assert.equal(shelf.estProductionMinutes, 45);
  assert.ok(r.ideas.find((i) => i.name === 'Wooden box'));
});

test('prompt mode: an answer left in the reasoning (empty content) is still read', async () => {
  mode = 'thinking';
  const r = await ideation.generateIdeas({ freeText: 'I have 6 pine boards, 100 wood screws, a saw and a drill', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok');
  assert.ok(r.parsed.materials.some((m) => m.name === 'pine boards'));
});

test('prompt mode: a reply without JSON is retried once with a correction, then succeeds', async () => {
  mode = 'retry';
  mock.calls = [];
  const r = await ideation.generateIdeas({ freeText: 'I have 6 pine boards, 100 wood screws, a saw and a drill', quantity: 1, currency: 'GEL' }, []);
  assert.equal(r.status, 'ok');
  const ideaCalls = mock.calls.filter((c) => c.messages[0].content.startsWith('You are the product-ideation engine'));
  assert.equal(ideaCalls.length, 2, 'exactly one retry');
  assert.ok(ideaCalls[1].messages.some((m) => m.role === 'user' && /Reply again with ONLY the JSON object/.test(m.content)), 'the retry carries a correction');
  assert.equal(ideaCalls[1].messages.at(-1).role, 'assistant', 'the reply is prefilled so the model writes its first idea');
  assert.ok(ideaCalls[1].messages.at(-1).content.startsWith('{"ideas": ['));
});

test('prompt mode: two unusable replies give the honest retryable error', async () => {
  mode = 'garbage';
  await assert.rejects(
    ideation.generateIdeas({ freeText: 'I have 6 pine boards, 100 wood screws, a saw and a drill', quantity: 1, currency: 'GEL' }, []),
    (e) => e.code === 'ai_invalid_output' && e.retryable === true,
  );
  mode = 'messy';
});
