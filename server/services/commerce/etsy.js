// Etsy Open API v3 — OAuth 2.0 authorization code flow with PKCE, receipts import.
// Requires an Etsy app (https://www.etsy.com/developers): keystring (+ shared secret).
import { row, save, beginAuth, checkState, formPost, failure, importSales, syncing, sinceDate, callbackUrl } from './store.js';

const ID = 'etsy';
const env = () => ({
  key: process.env.ETSY_KEYSTRING || '',
  secret: process.env.ETSY_SHARED_SECRET || '',
  authBase: process.env.ETSY_AUTH_BASE || 'https://www.etsy.com',
  tokenUrl: process.env.ETSY_TOKEN_URL || 'https://api.etsy.com/v3/public/oauth/token',
  apiBase: process.env.ETSY_API_BASE || 'https://openapi.etsy.com',
});
const SCOPES = 'transactions_r shops_r';
// Etsy identifies the app with x-api-key; newer apps send "keystring:shared_secret".
const apiKey = () => (env().secret ? `${env().key}:${env().secret}` : env().key);

async function accessToken() {
  const r = row(ID);
  const t = r?.secret;
  if (!t?.access_token) throw Object.assign(new Error('Etsy is not connected.'), { status: 409 });
  if (Date.now() < (t.expires_at || 0) - 60000) return t;
  const fresh = await formPost(env().tokenUrl, { grant_type: 'refresh_token', client_id: env().key, refresh_token: t.refresh_token });
  const next = { ...t, ...fresh, expires_at: Date.now() + (fresh.expires_in || 3600) * 1000 };
  save(ID, { secret: next });
  return next;
}

async function api(path) {
  const t = await accessToken();
  const res = await fetch(`${env().apiBase}${path}`, { headers: { 'x-api-key': apiKey(), Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } });
  if (!res.ok) throw failure(ID, res, 'Etsy');
  return res.json();
}

export const etsy = {
  id: ID,
  name: 'Etsy',
  kind: 'oauth',
  configured: () => Boolean(env().key),
  setup: ['Create an app at etsy.com/developers', 'Set ETSY_KEYSTRING (and ETSY_SHARED_SECRET) in the server .env', 'Register the callback URL: <SHOPIFY_CALLBACK_BASE>/api/integrations/etsy/callback'],
  capabilities: ['Import shop receipts (orders) as sales'],
  notCapable: ['Etsy fees come from the payments ledger and are not imported yet — add them per sale or as expenses'],

  authorizeUrl() {
    const { state, challenge } = beginAuth(ID, { pkce: true });
    const p = new URLSearchParams({ response_type: 'code', client_id: env().key, redirect_uri: callbackUrl(ID), scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
    return `${env().authBase}/oauth/connect?${p}`;
  },

  async handleCallback(q) {
    if (q.error) throw Object.assign(new Error(q.error === 'access_denied' ? 'Authorization was declined on Etsy.' : `Etsy returned: ${q.error}`), { status: 400 });
    const r = checkState(ID, q.state);
    const tok = await formPost(env().tokenUrl, { grant_type: 'authorization_code', client_id: env().key, redirect_uri: callbackUrl(ID), code: q.code, code_verifier: r.meta.verifier });
    const userId = String(tok.access_token || '').split('.')[0];
    save(ID, { status: 'connected', secret: { ...tok, user_id: userId, expires_at: Date.now() + (tok.expires_in || 3600) * 1000 }, scopes: SCOPES, connected_at: new Date().toISOString(), meta: { state: null, verifier: null } });
    try {
      const shop = await api(`/v3/application/users/${userId}/shops`);
      const s = shop.results?.[0] || shop;
      save(ID, { account: s.shop_name || `Etsy user ${userId}`, meta: { shopId: s.shop_id } });
    } catch (err) {
      save(ID, { status: 'error', meta: { error: `Connected, but the shop could not be read: ${err.message}` } });
    }
  },

  async importOrders({ sinceDays = 90 } = {}) {
    const r = row(ID);
    if (!['connected', 'error'].includes(r?.status) || !r.meta?.shopId) throw Object.assign(new Error('Etsy is not connected.'), { status: 409 });
    return syncing(ID, 'Etsy', async () => {
      const rows = [];
      const minCreated = Math.floor(sinceDate(sinceDays).getTime() / 1000);
      for (let offset = 0; offset < 2000; offset += 100) {
        const data = await api(`/v3/application/shops/${r.meta.shopId}/receipts?min_created=${minCreated}&limit=100&offset=${offset}`);
        for (const rc of data.results || []) {
          const refunds = (rc.refunds || []).reduce((s, x) => s + (x.amount ? x.amount.amount / x.amount.divisor : 0), 0);
          const txs = rc.transactions || [];
          const total = txs.reduce((s, t) => s + (t.price.amount / t.price.divisor) * t.quantity, 0) || 1;
          for (const t of txs) {
            const unit = t.price.amount / t.price.divisor;
            rows.push({ externalId: `${rc.receipt_id}:${t.transaction_id}`, date: new Date(rc.create_timestamp * 1000).toISOString(), title: t.title, quantity: t.quantity, unitPrice: unit, currency: t.price.currency_code, refund: refunds * ((unit * t.quantity) / total) });
          }
        }
        if ((data.results || []).length < 100) break;
      }
      return importSales(ID, 'Etsy', rows);
    });
  },
};
