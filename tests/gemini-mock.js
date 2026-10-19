// Minimal local mock of the Gemini REST API (the endpoints @google/genai calls:
// GET /v1beta/models/{m}, POST …:generateContent, POST …:streamGenerateContent?alt=sse).
// It lets the tests exercise everything ConstraintForge controls — request shape, image
// encoding, schema-constrained output, validation, retries and error mapping — without a
// real model. It says nothing about the real model's quality.
//
// Each request is also recorded in a simplified, provider-neutral shape so assertions stay
// readable: { model, stream, messages: [{ role, content, images }], format, tools, raw }.
import http from 'node:http';

export const MOCK_KEY = 'test-key-not-a-real-secret';
// A few bytes that start like a JPEG — enough for the app, which never decodes the picture.
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]).toString('base64');

function normalise(model, stream, body) {
  const messages = [];
  const sys = body.systemInstruction?.parts?.map((p) => p.text || '').join('') || '';
  if (sys) messages.push({ role: 'system', content: sys });
  for (const c of body.contents || []) {
    const parts = c.parts || [];
    const role = parts.some((p) => p.functionResponse) ? 'tool' : c.role === 'model' ? 'assistant' : 'user';
    messages.push({
      role,
      content: parts.map((p) => p.text || '').join(''),
      images: parts.filter((p) => p.inlineData).map((p) => p.inlineData.data),
      mimeTypes: parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType),
    });
  }
  return {
    model,
    stream,
    messages,
    format: body.generationConfig?.responseJsonSchema,
    responseMimeType: body.generationConfig?.responseMimeType,
    tools: body.tools?.flatMap((t) => t.functionDeclarations || []) || [],
    raw: body,
  };
}

const STATUS_NAME = { 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 503: 'UNAVAILABLE' };

/**
 * @param {(call, state) => string | {status:number, error:string} | {text?:string, functionCalls?:[], finishReason?:string}} onGenerate
 */
export function startGeminiMock(onGenerate, { model = 'gemini-3.5-flash-lite' } = {}) {
  const state = { calls: [], imageCalls: [], onImage: () => null, delayMs: 0, model, modelAvailable: true, keyValid: true, lastKey: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      // retryDelay: Google's RetryInfo in the body ("17s"); retryAfter: a Retry-After header (seconds).
      const sendError = (status, message, { retryDelay, retryAfter } = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...(retryAfter != null ? { 'retry-after': String(retryAfter) } : {}) });
        const details = retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : undefined;
        res.end(JSON.stringify({ error: { code: status, message, status: STATUS_NAME[status] || 'UNKNOWN', ...(details ? { details } : {}) } }));
      };
      state.lastKey = req.headers['x-goog-api-key'] || null;
      if (!state.keyValid || state.lastKey !== MOCK_KEY) return sendError(400, 'API key not valid. Please pass a valid API key.');
      // Image generation (Interactions API): POST /v1beta/interactions.
      if (req.method === 'POST' && req.url.startsWith('/v1beta/interactions')) {
        const body = raw ? JSON.parse(raw) : {};
        state.imageCalls.push(body);
        const r = state.onImage(body, state);
        if (r && r.status) return sendError(r.status, r.error);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: `int-${state.imageCalls.length}`, status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: r?.data || TINY_JPEG }] }] }));
      }
      const m = req.url.match(/^\/v1beta\/models\/([^:?/]+)(?::(generateContent|streamGenerateContent))?/);
      if (!m) return sendError(404, 'not found');
      const [, name, action] = m;
      if (!state.modelAvailable || name !== state.model) return sendError(404, `models/${name} is not found for API version v1beta`);
      if (req.method === 'GET' && !action) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ name: `models/${name}`, displayName: 'Mock Gemini', supportedGenerationMethods: ['generateContent'] }));
      }
      const stream = action === 'streamGenerateContent';
      const call = normalise(name, stream, raw ? JSON.parse(raw) : {});
      call.receivedAt = Date.now();
      state.calls.push(call);
      // Optional latency, to show that independent calls overlap.
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      call.answeredAt = Date.now();
      const r = onGenerate(call, state);
      if (r && typeof r === 'object' && r.status) return sendError(r.status, r.error, r);
      const msg = typeof r === 'string' ? { text: r } : r || {};
      const usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 };
      const finishReason = msg.finishReason || 'STOP';
      const fcParts = (msg.functionCalls || []).map((fc) => ({ functionCall: fc }));
      const text = msg.text || '';
      if (!stream) {
        const parts = [...(text ? [{ text }] : []), ...fcParts];
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason }], usageMetadata }));
      }
      // Split the text over two SSE chunks, like a real stream.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const half = Math.floor(text.length / 2);
      const chunk = (parts, extra = {}) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, ...extra }], usageMetadata })}\r\n\r\n`;
      res.write(chunk([{ text: text.slice(0, half) }]));
      res.end(chunk([{ text: text.slice(half) }, ...fcParts], { finishReason }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      state.url = `http://127.0.0.1:${server.address().port}`;
      state.close = () => server.close();
      resolve(state);
    })
  );
}

/** Points the app at the mock. Call before importing any server module. */
export function useMock(state, extraEnv = {}) {
  process.env.GEMINI_API_KEY = MOCK_KEY;
  process.env.GEMINI_BASE_URL = state.url;
  process.env.GEMINI_MODEL = state.model;
  process.env.SEARCH_PROVIDER = 'off';
  process.env.DB_PATH = process.env.DB_PATH || `${process.env.TMP || '/tmp'}/cf-test-${process.pid}.db`;
  Object.assign(process.env, extraEnv);
}
