// eBay — OAuth 2.0 authorization code grant + Sell Fulfillment API (orders, with
// marketplace fees). Requires an eBay developer keyset and a RuName (redirect URL name).
import { row, save, beginAuth, checkState, formPost, failure, importSales, syncing, sinceDate } from './store.js';

const ID = 'ebay';
const env = () => {
  const sandbox = process.env.EBAY_ENV === 'sandbox';
  return {
    clientId: process.env.EBAY_CLIENT_ID || '',
    clientSecret: process.env.EBAY_CLIENT_SECRET || '',
    ruName: process.env.EBAY_RUNAME || '',
    authBase: process.env.EBAY_AUTH_BASE || (sandbox ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com'),
    apiBase: process.env.EBAY_API_BASE || (sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'),
  };
};
const SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';
const basic = () => `Basic ${Buffer.from(`${env().clientId}:${env().clientSecret}`).toString('base64')}`;

async function accessToken() {
  const t = row(ID)?.secret;
  if (!t?.access_token) throw Object.assign(new Error('eBay is not connected.'), { status: 409 });
  if (Date.now() < (t.expires_at || 0) - 60000) return t;
  const fresh = await formPost(`${env().apiBase}/identity/v1/oauth2/token`, { grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: SCOPES }, { Authorization: basic() });
  const next = { ...t, ...fresh, expires_at: Date.now() + (fresh.expires_in || 7200) * 1000 };
  save(ID, { secret: next });
  return next;
}

export const ebay = {
  id: ID,
  name: 'eBay',
  kind: 'oauth',
  configured: () => Boolean(env().clientId && env().clientSecret && env().ruName),
  setup: ['Create a keyset at developer.ebay.com', 'Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RUNAME in the server .env', 'Set the RuName’s “auth accepted URL” to <SHOPIFY_CALLBACK_BASE>/api/integrations/ebay/callback'],
  capabilities: ['Import orders (line items, marketplace fees, refunds) as sales'],
  notCapable: [],

  authorizeUrl() {
    const { state } = beginAuth(ID);
    const p = new URLSearchParams({ client_id: env().clientId, redirect_uri: env().ruName, response_type: 'code', scope: SCOPES, state });
    return `${env().authBase}/oauth2/authorize?${p}`;
  },

  async handleCallback(q) {
    if (q.error) throw Object.assign(new Error(q.error === 'access_denied' ? 'Authorization was declined on eBay.' : `eBay returned: ${q.error}`), { status: 400 });
    checkState(ID, q.state);
    const tok = await formPost(`${env().apiBase}/identity/v1/oauth2/token`, { grant_type: 'authorization_code', code: q.code, redirect_uri: env().ruName }, { Authorization: basic() });
    save(ID, { status: 'connected', account: 'eBay seller account', secret: { ...tok, expires_at: Date.now() + (tok.expires_in || 7200) * 1000 }, scopes: SCOPES, connected_at: new Date().toISOString(), meta: { state: null } });
  },

  async importOrders({ sinceDays = 90 } = {}) {
    if (row(ID)?.status !== 'connected') throw Object.assign(new Error('eBay is not connected.'), { status: 409 });
    return syncing(ID, 'eBay', async () => {
      const t = await accessToken();
      const rows = [];
      const filter = encodeURIComponent(`creationdate:[${sinceDate(sinceDays).toISOString()}..]`);
      for (let offset = 0; offset < 5000; offset += 200) {
        const res = await fetch(`${env().apiBase}/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`, { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } });
        if (!res.ok) throw failure(ID, res, 'Importing eBay orders');
        const data = await res.json();
        for (const o of data.orders || []) {
          if (o.cancelStatus?.cancelState === 'CANCELED') continue;
          const lines = o.lineItems || [];
          const total = lines.reduce((s, li) => s + Number(li.lineItemCost?.value || 0), 0) || 1;
          const fee = Number(o.totalMarketplaceFee?.value || 0);
          const refunds = (o.paymentSummary?.refunds || []).reduce((s, x) => s + Number(x.amount?.value || 0), 0);
          for (const li of lines) {
            const value = Number(li.lineItemCost?.value || 0);
            const share = value / total;
            rows.push({ externalId: `${o.orderId}:${li.lineItemId}`, date: o.creationDate, title: li.title, quantity: Number(li.quantity) || 0, unitPrice: li.quantity ? value / li.quantity : 0, currency: li.lineItemCost?.currency, fees: fee * share, refund: refunds * share });
          }
        }
        if (!data.next || (data.orders || []).length < 200) break;
      }
      return importSales(ID, 'eBay', rows);
    });
  },
};
