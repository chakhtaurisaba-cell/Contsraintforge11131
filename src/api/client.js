// Fetch wrapper for the ConstraintForge API. Errors carry the server's message.
export class ApiError extends Error {
  constructor(message, status, code, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function request(method, path, body, { isForm = false, signal } = {}) {
  const opts = { method, headers: {}, signal };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the ConstraintForge server. Check your connection and try again.', 0, 'network', true);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code, Boolean(data?.retryable));
  return data;
}

/**
 * POST that reads a line-delimited JSON stream: `onEvent` gets each progress event; resolves
 * with the final result or throws the server's error. Aborting `signal` cancels the request
 * (the server then stops the model).
 */
async function stream(path, body, { signal, onEvent } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(body ?? {}), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the ConstraintForge server. Check your connection and try again.', 0, 'network', true);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code, Boolean(data?.retryable));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let final = null;
  const handle = (line) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line);
    if (ev.type === 'progress') onEvent?.(ev);
    else if (ev.type === 'result') final = { data: ev.data };
    else if (ev.type === 'error') final = { error: new ApiError(ev.error, ev.status, ev.code, ev.retryable) };
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handle);
    }
    handle(buf);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('The connection to the server broke off. Please try again.', 0, 'network', true);
  }
  if (final?.error) throw final.error;
  if (!final) throw new ApiError('The server ended the response early. Please try again.', 0, 'network', true);
  return final.data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, formData, o = {}) => request('POST', p, formData, { ...o, isForm: true }),
  stream,
};
