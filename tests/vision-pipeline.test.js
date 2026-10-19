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
