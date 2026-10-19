// JSON handling for model replies: lenient extraction and repair, and the conversion of zod's
// JSON Schema to the subset Gemini's structured output accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { extractJSON, conformToSchema, toGeminiSchema } from '../server/ai/json.js';
import { ScanResult, ProductIdea } from '../server/ai/schemas.js';

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

test('toGeminiSchema: nullable types, const and unsupported keywords', () => {
  const g = toGeminiSchema(js);
  assert.equal(g.$schema, undefined);
  const item = g.properties.ideas.items;
  assert.deepEqual(item.properties.note.type, ['string', 'null'], 'anyOf [string, null] becomes a nullable type');
  assert.deepEqual(item.properties.level.enum, ['beginner', 'advanced']);
  assert.deepEqual(item.required.sort(), ['count', 'level', 'name', 'note', 'size', 'tags']);
  assert.deepEqual(toGeminiSchema({ const: 'x', pattern: '^a', type: 'string' }), { enum: ['x'], type: 'string' });
});

test('toGeminiSchema: the app schemas only use keywords Gemini supports', () => {
  const allowed = new Set(['type', 'title', 'description', 'properties', 'required', 'additionalProperties', 'enum', 'format', 'minimum', 'maximum', 'items', 'prefixItems', 'minItems', 'maxItems', 'anyOf', '$ref', '$defs']);
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (path.endsWith('.properties') || path.endsWith('.$defs')) walk(v, `${path}.${k}`);
      else {
        assert.ok(allowed.has(k), `unsupported keyword ${k} at ${path}`);
        if (typeof v === 'object') walk(v, `${path}.${k}`);
      }
    }
  };
  for (const s of [ScanResult, ProductIdea]) {
    const raw = z.toJSONSchema(s);
    delete raw.$schema;
    walk(toGeminiSchema(raw), '$');
  }
});
