// Shared storage + import helpers for commerce connectors. Tokens/keys live only in
// the server database (integrations.secret) and are never returned to the browser.
import { randomBytes, createHash } from 'node:crypto';
import { get, run, all, now, uid, parseJSON, transaction, logActivity } from '../../db.js';
import { config } from '../../config.js';

export const callbackUrl = (id) => `${config.shopify.callbackBase}/api/integrations/${id}/callback`;

export function row(provider) {
  const r = get('SELECT * FROM integrations WHERE provider = ?', provider);
  return r ? { ...r, meta: parseJSON(r.meta, {}), secret: parseJSON(r.secret, r.secret) } : null;
}

export function save(provider, fields) {
  const cur = row(provider) || { status: 'not_connected', account: null, secret: null, scopes: null, meta: {}, connected_at: null };
  const next = { ...cur, ...fields, meta: { ...(cur.meta || {}), ...(fields.meta || {}) } };
  if (fields.meta === null) next.meta = {};
  run(
    `INSERT INTO integrations (provider, status, account, secret, scopes, meta, connected_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET status=excluded.status, account=excluded.account, secret=excluded.secret, scopes=excluded.scopes, meta=excluded.meta, connected_at=excluded.connected_at, updated_at=excluded.updated_at`,
    provider, next.status, next.account, next.secret == null ? null : typeof next.secret === 'string' ? next.secret : JSON.stringify(next.secret), next.scopes, JSON.stringify(next.meta || {}), next.connected_at, now()
  );
  return row(provider);
}

export function disconnect(provider) {
  save(provider, { status: 'not_connected', secret: null, scopes: null, connected_at: null, meta: null });
  logActivity('integration', `${provider} disconnected`);
}

/** OAuth state (CSRF) + optional PKCE pair, remembered until the callback. */
export function beginAuth(provider, { pkce = false } = {}) {
  const state = randomBytes(16).toString('hex');
  const meta = { state, startedAt: now() };
  let challenge = null;
  if (pkce) {
    meta.verifier = randomBytes(48).toString('base64url');
    challenge = createHash('sha256').update(meta.verifier).digest('base64url');
  }
  save(provider, { status: 'awaiting_authorization', meta });
  return { state, challenge };
}

export function checkState(provider, state) {
  const r = row(provider);
  if (!r || r.status !== 'awaiting_authorization' || !r.meta?.state || r.meta.state !== state) {
    throw Object.assign(new Error('The authorization could not be verified (state mismatch). Start the connection again.'), { status: 400 });
  }
  return r;
}

/** POST application/x-www-form-urlencoded and return JSON, with readable errors. */
export async function formPost(url, params, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers }, body: new URLSearchParams(params) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error_description || body.error || `Token request failed (${res.status})`), { status: 502, httpStatus: res.status });
  return body;
}

/** Map an API HTTP failure to a connection state. */
export function failure(provider, res, what) {
  if (res.status === 401) {
    save(provider, { status: 'error', meta: { error: 'Access was revoked or has expired. Reconnect the account.' } });
    return Object.assign(new Error(`${what}: access was revoked or expired — reconnect.`), { status: 502 });
  }
  if (res.status === 403) {
    save(provider, { status: 'permissions_missing', meta: { error: 'The account did not grant the permissions needed to read orders.' } });
    return Object.assign(new Error(`${what}: permission to read orders is missing.`), { status: 502 });
  }
  if (res.status === 429) return Object.assign(new Error(`${what}: the platform is rate-limiting requests. Try again later.`), { status: 429 });
  return Object.assign(new Error(`${what} failed (HTTP ${res.status}).`), { status: 502 });
}

/**
 * Normalised sales import (shared by every connector). rows: {externalId, date, title,
 * quantity, unitPrice, currency, fees, refund, returnedUnits}. Deduplicated by
 * provider + externalId; product titles are matched to project names when identical.
 */
export function importSales(provider, channel, rows) {
  const projects = all('SELECT id, name FROM projects WHERE is_example = 0');
  const match = (title) => projects.find((p) => p.name.toLowerCase() === String(title || '').toLowerCase())?.id || null;
  let imported = 0;
  let skipped = 0;
  transaction(() => {
    for (const r of rows) {
      const externalId = `${provider}:${r.externalId}`;
      if (get('SELECT id FROM sales WHERE external_id = ?', externalId)) { skipped += 1; continue; }
      if (!(r.quantity > 0) || !Number.isFinite(r.unitPrice)) { skipped += 1; continue; }
      run(
        'INSERT INTO sales (id, project_id, date, channel, quantity, unit_price, fees, shipping_cost, ad_cost, refund, returned_units, currency, note, source, external_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        uid(), match(r.title), r.date.slice(0, 10), channel, Math.round(r.quantity), Math.round(r.unitPrice * 100) / 100, Math.max(0, r.fees || 0), 0, 0, Math.max(0, r.refund || 0), Math.max(0, r.returnedUnits || 0), r.currency || null, String(r.title || '').slice(0, 200), provider, externalId, now()
      );
      imported += 1;
    }
  });
  return { imported, skipped };
}

/** Wrap an import so status shows "syncing" during and the last sync after. */
export async function syncing(provider, label, fn) {
  const before = row(provider);
  save(provider, { status: 'syncing' });
  try {
    const result = await fn();
    save(provider, { status: 'connected', meta: { lastSyncAt: now(), lastSyncImported: result.imported, error: null } });
    logActivity('integration', `${label}: imported ${result.imported} sale line(s), ${result.skipped} already present`);
    return result;
  } catch (err) {
    const cur = row(provider);
    if (cur.status === 'syncing') save(provider, { status: before?.status === 'connected' ? 'connected' : 'error', meta: { error: err.message } });
    throw err;
  }
}

export const sinceDate = (days) => new Date(Date.now() - days * 86400000);
