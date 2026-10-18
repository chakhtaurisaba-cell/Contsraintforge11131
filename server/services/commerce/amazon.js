// Amazon Selling Partner API — website authorization workflow (Login with Amazon) and
// the Orders API. Requires a registered SP-API developer application; access tokens go
// in the x-amz-access-token header. Fees live in the Finances API and are not imported.
import { row, save, beginAuth, checkState, formPost, failure, importSales, syncing, sinceDate, callbackUrl } from './store.js';

const ID = 'amazon';
const env = () => ({
  appId: process.env.AMAZON_SPAPI_APP_ID || '',
  clientId: process.env.AMAZON_LWA_CLIENT_ID || '',
  clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
  sellerCentral: process.env.AMAZON_SELLER_CENTRAL_URL || 'https://sellercentral.amazon.com',
  endpoint: process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com',
  tokenUrl: process.env.AMAZON_LWA_TOKEN_URL || 'https://api.amazon.com/auth/o2/token',
  marketplaces: (process.env.AMAZON_MARKETPLACE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  draft: process.env.AMAZON_APP_DRAFT === 'true',
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function accessToken() {
  const t = row(ID)?.secret;
  if (!t?.refresh_token) throw Object.assign(new Error('Amazon is not connected.'), { status: 409 });
  if (t.access_token && Date.now() < (t.expires_at || 0) - 60000) return t;
  const fresh = await formPost(env().tokenUrl, { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: env().clientId, client_secret: env().clientSecret });
  const next = { ...t, ...fresh, expires_at: Date.now() + (fresh.expires_in || 3600) * 1000 };
  save(ID, { secret: next });
  return next;
}

async function api(path) {
  const t = await accessToken();
  const res = await fetch(`${env().endpoint}${path}`, { headers: { 'x-amz-access-token': t.access_token, Accept: 'application/json' } });
  if (!res.ok) throw failure(ID, res, 'Amazon SP-API');
  return res.json();
}

export const amazon = {
  id: ID,
  name: 'Amazon Seller Central',
  kind: 'oauth',
  configured: () => Boolean(env().appId && env().clientId && env().clientSecret && env().marketplaces.length),
  setup: [
    'Register as an SP-API developer in Seller Central / Solution Provider Portal and create an app with the Orders role',
    'Set AMAZON_SPAPI_APP_ID, AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET and AMAZON_MARKETPLACE_IDS in the server .env (plus the region’s AMAZON_SELLER_CENTRAL_URL / AMAZON_SPAPI_ENDPOINT if not North America)',
    'Add <SHOPIFY_CALLBACK_BASE>/api/integrations/amazon/callback as the app’s OAuth redirect URI',
  ],
  capabilities: ['Import orders and order items as sales'],
  notCapable: ['Amazon fees (Finances API) are not imported — add them per sale or as expenses', 'Imports are limited to 50 orders per run because of SP-API rate limits'],

  authorizeUrl() {
    const { state } = beginAuth(ID);
    const p = new URLSearchParams({ application_id: env().appId, state, redirect_uri: callbackUrl(ID) });
    if (env().draft) p.set('version', 'beta');
    return `${env().sellerCentral}/apps/authorize/consent?${p}`;
  },

  async handleCallback(q) {
    checkState(ID, q.state);
    if (!q.spapi_oauth_code) throw Object.assign(new Error('Amazon did not return an authorization code.'), { status: 400 });
    const tok = await formPost(env().tokenUrl, { grant_type: 'authorization_code', code: q.spapi_oauth_code, client_id: env().clientId, client_secret: env().clientSecret, redirect_uri: callbackUrl(ID) });
    save(ID, { status: 'connected', account: q.selling_partner_id ? `Seller ${q.selling_partner_id}` : 'Amazon seller', secret: { ...tok, expires_at: Date.now() + (tok.expires_in || 3600) * 1000 }, scopes: 'orders', connected_at: new Date().toISOString(), meta: { state: null } });
  },

  async importOrders({ sinceDays = 90 } = {}) {
    if (row(ID)?.status !== 'connected') throw Object.assign(new Error('Amazon is not connected.'), { status: 409 });
    return syncing(ID, 'Amazon', async () => {
      const rows = [];
      const created = sinceDate(sinceDays).toISOString();
      const data = await api(`/orders/v0/orders?MarketplaceIds=${encodeURIComponent(env().marketplaces.join(','))}&CreatedAfter=${encodeURIComponent(created)}&MaxResultsPerPage=50`);
      for (const o of data.payload?.Orders || []) {
        if (['Canceled', 'Pending'].includes(o.OrderStatus)) continue;
        const items = await api(`/orders/v0/orders/${encodeURIComponent(o.AmazonOrderId)}/orderItems`);
        for (const it of items.payload?.OrderItems || []) {
          const qty = Number(it.QuantityOrdered) || 0;
          rows.push({ externalId: `${o.AmazonOrderId}:${it.OrderItemId}`, date: o.PurchaseDate, title: it.Title, quantity: qty, unitPrice: qty ? Number(it.ItemPrice?.Amount || 0) / qty : 0, currency: it.ItemPrice?.CurrencyCode });
        }
        await pause(Number(process.env.AMAZON_ITEMS_DELAY_MS ?? 2100)); // getOrderItems allows ~0.5 requests/second
      }
      return importSales(ID, 'Amazon', rows);
    });
  },
};
