// Minimal local mock of the Ollama HTTP API (/api/version, /api/show, streamed /api/chat).
// It lets the tests exercise everything ConstraintForge controls — request shape, image
// encoding, schema-constrained output, validation, retries and error mapping — without a
// real model. It says nothing about the real model's quality.
import http from 'node:http';

/**
 * @param {(body, req) => string | {status:number, error:string} | {content?:string, tool_calls?:[], done_reason?:string}} onChat
 */
export function startOllamaMock(onChat, { capabilities = ['completion', 'vision', 'tools'], model = 'test-model:1b' } = {}) {
  const state = { calls: [], capabilities, modelInstalled: true, model };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status, json) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'GET' && req.url === '/api/version') return send(200, { version: '0.0.0-mock' });
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/api/show') {
        if (!state.modelInstalled || body.model !== state.model) return send(404, { error: `model '${body.model}' not found` });
        return send(200, { capabilities: state.capabilities, details: { family: 'mock' } });
      }
      if (req.url !== '/api/chat') return send(404, { error: 'not found' });
      state.calls.push(body);
      if (!state.modelInstalled) return send(404, { error: `model '${body.model}' not found` });
      const r = onChat(body, state);
      if (r && typeof r === 'object' && r.status) return send(r.status, { error: r.error });
      const msg = typeof r === 'string' ? { content: r } : r;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      // Split the content over two chunks, like a real stream.
      const content = msg.content || '';
      const half = Math.floor(content.length / 2);
      res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: content.slice(0, half) }, done: false })}\n`);
      res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: content.slice(half), ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) }, done: false })}\n`);
      res.end(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: msg.done_reason || 'stop', eval_count: 10 })}\n`);
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
  process.env.OLLAMA_HOST = state.url;
  process.env.OLLAMA_MODEL = state.model;
  process.env.SEARCH_PROVIDER = 'off';
  process.env.DB_PATH = process.env.DB_PATH || `${process.env.TMP || '/tmp'}/cf-test-${process.pid}.db`;
  Object.assign(process.env, extraEnv);
}
