// Vision pipeline tests (requirement tests A, B, C, H) against a LOCAL MOCK of the
// Gemini API. This verifies everything ConstraintForge controls — request shape, image
// encoding, schema-constrained output, validation, retries, calibration and error
// mapping — but NOT the real model's recognition quality.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGeminiMock, useMock, MOCK_KEY } from './gemini-mock.js';

let mode = 'basic';
const scene = (overrides = {}) => ({
  objects: [
    {
      name: 'Pine board', material: 'Pine wood', category: 'timber', quantity: 3, quantityCountable: true, unit: 'pcs', condition: 'good', confidence: 0.92,
      visibleMarkings: '', potentialUses: ['shelf'], reusableComponents: [], isReferenceObject: false, boundingBox: { x: 0.1, y: 0.2, w: 0.6, h: 0.2 },
      imageIndex: 0, seenInImages: [0, 1], shapeDescription: 'flat planed plank', orientation: 'lying flat',
      dimensions: { length: 1000, width: 140, height: null, diameter: null, thickness: null, unit: 'mm', method: 'ai_inferred', uncertaintyPct: 40, reasoning: 'typical plank proportions' },
      requiresInspection: false, missingInfo: ['thickness'],
    },
    {
      name: 'Wood screws', material: 'Steel', category: 'fastener', quantity: 25, quantityCountable: true, unit: 'pcs', condition: 'new', confidence: 0.8,
      visibleMarkings: '4x40', potentialUses: [], reusableComponents: [], isReferenceObject: false, boundingBox: null, imageIndex: 0, seenInImages: [0],
      shapeDescription: 'countersunk screws', orientation: 'loose',
      dimensions: { length: 40, width: null, height: null, diameter: 4, thickness: null, unit: 'mm', method: 'visible_marking', uncertaintyPct: 2, reasoning: 'printed on box' },
      requiresInspection: false, missingInfo: [],
    },
  ],
  referenceObjectFound: false,
  referenceDescription: '',
  scaleStatus: 'markings_only',
  overallNotes: '',
  questionsForUser: ['How thick are the boards?'],
  additionalViews: [{ view: 'side view of the boards', reason: 'thickness is not visible', forObject: 'Pine board' }],
  measurementRequests: [{ objectName: 'Pine board', dimension: 'length', reason: 'no scale reference in the photo' }],
  ...overrides,
});

let mock;
let vision;
let client;
const jpeg = () => ({ mimetype: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]) });

before(async () => {
  mock = await startGeminiMock((_call, state) => {
    if (mode === 'crash') return { status: 500, error: 'backend exploded' };
    if (mode === 'rate_limited') return { status: 429, error: 'Resource has been exhausted (e.g. check quota).' };
    if (mode === 'always_invalid') return '{"objects": [ {"name": "broken"';
    if (mode === 'reject_config' && _call.raw.generationConfig?.responseJsonSchema) return { status: 400, error: "Invalid JSON payload received. Unknown name \"x\" at 'generation_config.response_json_schema'" };
    if (mode === 'always_400') return { status: 400, error: 'Request contains an invalid argument.' };
    if (mode === 'invalid_then_ok' && state.calls.length === 1) return '{"objects": [ {"name": "broken"';
    if (mode === 'reference') {
      return JSON.stringify(scene({
        referenceObjectFound: true, referenceDescription: 'tape measure along the board', scaleStatus: 'reference_found', additionalViews: [], measurementRequests: [],
        objects: [{ ...scene().objects[0], dimensions: { length: 1200, width: 150, height: null, diameter: null, thickness: 18, unit: 'mm', method: 'reference_calibrated', uncertaintyPct: 5, reasoning: 'read against the tape graduations' } }],
      }));
    }
    return JSON.stringify(scene());
  });
  useMock(mock);
  client = await import('../server/ai/client.js');
  vision = await import('../server/services/vision.js');
});
after(() => mock.close?.());

test('configuration: the Gemini key and model are detected and the startup probe reports ready', async () => {
  const s = await client.probeAI();
  assert.equal(s.configured, true);
  assert.equal(s.state, 'ready');
  assert.equal(s.provider, 'gemini');
  assert.equal(s.model, 'gemini-3.8-flash');
  assert.equal(s.credentialSource, 'GEMINI_API_KEY (server-side)');
  assert.ok(!JSON.stringify(s).includes(MOCK_KEY), 'the status never contains the key');
});

test('A — basic scan: images are sent as base64 inlineData with a JSON schema and parsed', async () => {
  mode = 'basic';
  mock.calls = [];
  const r = await vision.analyseImages([jpeg()], { goal: 'identify' });
  assert.equal(mock.calls.length, 1);
  const req = mock.calls[0];
  assert.equal(req.model, 'gemini-3.8-flash');
  assert.equal(mock.lastKey, MOCK_KEY, 'the key travels in the server-side request header');
  assert.equal(req.responseMimeType, 'application/json');
  assert.equal(req.format.type, 'object');
  assert.ok(req.format.properties.objects, 'the ScanResult schema constrains the output');
  assert.ok(!JSON.stringify(req.format).includes('"$schema"'), 'only Gemini-supported schema keywords are sent');
  const user = req.messages.find((m) => m.role === 'user');
  assert.equal(user.images.length, 1);
  assert.equal(user.mimeTypes[0], 'image/jpeg');
  assert.equal(Buffer.from(user.images[0], 'base64')[0], 0xff, 'raw image bytes, base64-encoded');
  assert.equal(r.objects.length, 2);
  assert.equal(r.objects[0].name, 'Pine board');
});

test('C — no scale: estimates stay labelled as AI estimates and a measurement is requested', async () => {
  mode = 'basic';
  mock.calls = [];
  const r = await vision.analyseImages([jpeg()], { goal: 'dimensions' });
  assert.equal(r.objects[0].dimensions.method, 'ai_inferred');
  assert.ok(r.objects[0].dimensions.uncertaintyPct >= 25);
  assert.equal(r.measurementRequests[0].objectName, 'Pine board');
  assert.equal(r.objects[1].dimensions.method, 'visible_marking', 'printed sizes keep their own provenance');
  assert.match(mock.calls[0].messages.at(-1).content, /estimate real dimensions/i, 'goal is passed to the model');
});

test('B — calibrated: reference scaling from the model, and a user measurement rescales the same photo', async () => {
  mode = 'reference';
  const r = await vision.analyseImages([jpeg(), jpeg(), jpeg()], { goal: 'dimensions' });
  assert.equal(r.scaleStatus, 'reference_found');
  assert.equal(r.objects[0].dimensions.method, 'reference_calibrated');
  assert.equal(r.objects[0].dimensions.thickness, 18);

  mode = 'basic';
  const k = await vision.analyseImages([jpeg(), jpeg()], { goal: 'dimensions', known: { objectName: 'Pine board', dimension: 'length', value: 1200, unit: 'mm' } });
  assert.equal(k.knownMeasurementApplied, true);
  assert.equal(k.objects[0].dimensions.length, 1200);
  assert.equal(k.objects[0].dimensions.width, 168, 'other dims of the measured item scale too (140 × 1.2)');
  assert.equal(k.objects[0].dimensions.method, 'reference_calibrated', 'width is derived, so not "user confirmed"');
  assert.equal(k.objects[1].dimensions.method, 'visible_marking', 'a printed size is never overwritten by scaling');
});

test('malformed model output is retried once, then succeeds', async () => {
  mode = 'invalid_then_ok';
  mock.calls = [];
  const r = await vision.analyseImages([jpeg()]);
  assert.equal(mock.calls.length, 2);
  assert.ok(mock.calls[1].messages.length > mock.calls[0].messages.length, 'the retry adds a corrective turn');
  assert.equal(r.objects.length, 2);
});

test('Gemini 3.8 request: no deprecated sampling parameters; thinking only as a valid level', async () => {
  mode = 'basic';
  mock.calls = [];
  await vision.analyseImages([jpeg()]);
  const gc = mock.calls[0].raw.generationConfig;
  for (const k of ['temperature', 'topP', 'topK', 'candidateCount', 'presencePenalty', 'frequencyPenalty']) assert.ok(!(k in gc), `${k} must not be sent`);
  assert.ok(!gc.thinkingConfig?.thinkingBudget, 'no thinking_budget');
  if (gc.thinkingConfig) assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(gc.thinkingConfig.thinkingLevel), 'MINIMAL is rejected by gemini-3.8-flash');
});

test('systemInstruction is sent in the REST form, without a role', async () => {
  mode = 'basic';
  mock.calls = [];
  await vision.analyseImages([jpeg()]);
  const si = mock.calls[0].raw.systemInstruction;
  assert.ok(si.parts[0].text.length > 20);
  assert.equal(si.role, undefined);
});

test('a 400 from Gemini: features are removed one at a time; the invalid one is identified and stays off', async () => {
  mode = 'reject_config';
  mock.calls = [];
  const r = await vision.analyseImages([jpeg()]);
  assert.equal(mock.calls.length, 2);
  const retry = mock.calls[1].raw;
  assert.equal(retry.generationConfig.responseMimeType, 'application/json', 'only the invalid feature is removed');
  assert.ok(!retry.generationConfig.responseJsonSchema);
  assert.ok(retry.generationConfig.maxOutputTokens, 'features that were fine are kept');
  assert.match(mock.calls[1].messages[0].content, /JSON Schema exactly/, 'the schema moves into the instructions');
  assert.equal(retry.contents[0].parts.filter((p) => p.inlineData).length, 1, 'the photo is sent again');
  assert.equal(r.objects.length, 2, 'the reply is still validated and used');
  const s = client.aiStatus();
  assert.equal(s.invalidArgument.feature, 'responseJsonSchema');
  assert.equal(s.invalidArgument.call, 'scan photos');
  assert.deepEqual(s.requestAdjustments, ['responseJsonSchema']);
  mock.calls = [];
  await vision.analyseImages([jpeg()]);
  assert.equal(mock.calls.length, 1, 'later calls skip the invalid feature directly');
});

test('a 400 that persists: every optional feature removed once, then an honest error', async () => {
  mode = 'always_400';
  mock.calls = [];
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_bad_request' && !/invalid argument/.test(e.message));
  // schema is already off; then maxOutputTokens, systemInstruction, responseMimeType → 4 requests, never more.
  assert.equal(mock.calls.length, 4);
  const last = mock.calls.at(-1).raw;
  assert.equal(last.systemInstruction, undefined);
  assert.match(last.contents[0].parts[0].text, /^Instructions:/, 'instructions move into the user turn');
  assert.ok(!last.generationConfig?.responseMimeType);
  assert.match(client.aiStatus().lastRejection.message, /invalid argument/, 'Google’s reason is visible in /api/health for the maintainer');
  assert.ok(!JSON.stringify(client.aiStatus()).includes(MOCK_KEY));
  mode = 'basic';
});

test('invalid output twice: a retryable error, never a fabricated result', async () => {
  mode = 'always_invalid';
  mock.calls = [];
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_invalid_output' && e.retryable === true);
  assert.equal(mock.calls.length, 2, 'exactly one retry');
});

test('H — Gemini server error: clean, retryable error without internal details', async () => {
  mode = 'crash';
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_unavailable_temp' && e.retryable === true && !/backend exploded/i.test(e.message));
});

test('H — rate limit (429): retryable "busy" error', async () => {
  mode = 'rate_limited';
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_rate_limited' && e.retryable === true);
  assert.equal(client.aiStatus().state, 'rate_limited');
  mode = 'basic';
  assert.equal((await client.probeAI()).state, 'rate_limited', 'a metadata probe does not prove the quota is back');
  await vision.analyseImages([jpeg()]);
  assert.equal(client.aiStatus().state, 'ready', 'a successful generation clears it');
});

test('H — model not available: generic user message, maintainer hint names the model, AI marked unavailable', async () => {
  mode = 'basic';
  mock.modelAvailable = false;
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_unavailable' && !/not found|404/.test(e.message));
  const s = client.aiStatus();
  assert.equal(s.state, 'model_unavailable');
  assert.match(s.maintainerHint, /gemini-3\.8-flash/);
  mock.calls = [];
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_unavailable', 'no further calls once the model is known missing');
  assert.equal(mock.calls.length, 0);
  mock.modelAvailable = true;
  assert.equal((await client.probeAI()).state, 'ready', 'a later re-probe picks the model up again');
});

test('H — invalid API key: generic message, maintainer hint names GEMINI_API_KEY', async () => {
  mock.keyValid = false;
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_unauthorized' && !/api key/i.test(e.message));
  const s = client.aiStatus();
  assert.equal(s.state, 'unauthorized');
  assert.match(s.maintainerHint, /GEMINI_API_KEY/);
  mock.keyValid = true;
  assert.equal((await client.probeAI()).state, 'ready');
});

test('non-image bytes are rejected before any AI call', async () => {
  mock.calls = [];
  await assert.rejects(vision.analyseImages([{ mimetype: 'image/jpeg', buffer: Buffer.from('this is not an image at all') }]), (e) => e.code === 'bad_image');
  assert.equal(mock.calls.length, 0);
});

test('H — Gemini unreachable: retryable "could not be reached" error', async () => {
  mock.close();
  await assert.rejects(vision.analyseImages([jpeg()]), (e) => e.code === 'ai_unreachable' && e.retryable === true);
  assert.equal(client.aiStatus().state, 'unreachable');
  assert.match(client.aiStatus().maintainerHint, /could not be reached/);
});
