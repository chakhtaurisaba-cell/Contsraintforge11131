// Robust JSON handling for models without structured outputs (Ollama Cloud).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { extractJSON, conformToSchema, schemaPrompt } from '../server/ai/json.js';

test('extractJSON: prose, code fences, think blocks, trailing commas, smart quotes', () => {
  assert.deepEqual(extractJSON('Sure! Here you go:\n```json\n{"a": 1, "b": [1, 2,],}\n```\nHope it helps.'), { a: 1, b: [1, 2] });
  assert.deepEqual(extractJSON('<think>let me think {not json}</think>{"ok": true}'), { ok: true });
  assert.deepEqual(extractJSON('Result: {“name”: “Shelf”}'), { name: 'Shelf' });
  assert.deepEqual(extractJSON('text {"s": "has } brace and { inside", "n": 2} more {"x":1}'), { s: 'has } brace and { inside', n: 2 });
  assert.deepEqual(extractJSON('[{"name":"a"}]'), [{ name: 'a' }]);
  assert.equal(extractJSON('no json here'), null);
  assert.equal(extractJSON(''), null);
});

const Idea = z.object({ name: z.string(), count: z.number(), level: z.enum(['beginner', 'advanced']), tags: z.array(z.string()), size: z.object({ length: z.number() }), note: z.string().nullable() });
const Result = z.object({ ideas: z.array(Idea), notes: z.string() });
const js = z.toJSONSchema(Result);

test('conformToSchema: numbers as strings, missing fields, enum case, bare array', () => {
  const messy = [{ name: 'Shelf', count: '3 pcs', level: 'Beginner', tags: 'wood', size: { length: '600 mm' } }];
  const fixed = conformToSchema(messy, js);
  const r = Result.safeParse(fixed);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data.ideas[0], { name: 'Shelf', count: 3, level: 'beginner', tags: ['wood'], size: { length: 600 }, note: null });
  assert.equal(r.data.notes, '');
});

test('conformToSchema: an answer wrapped one level deep is unwrapped', () => {
  const r = Result.safeParse(conformToSchema({ result: { ideas: [], notes: 'x' } }, js));
  assert.ok(r.success);
  assert.equal(r.data.notes, 'x');
});

test('schemaPrompt describes every key and enum', () => {
  const p = schemaPrompt(js);
  assert.match(p, /ONE JSON object/);
  assert.match(p, /"level":"beginner\|advanced"/);
  assert.match(p, /"size":\{"length":0\}/);
});
