// WooCommerce REST API v3 (orders). The store owner creates a READ-only REST key in
// WooCommerce → Settings → Advanced → REST API and pastes it here; the key is verified
// against the store before the connection is marked connected.
import { row, save, failure, importSales, syncing, sinceDate } from './store.js';

const ID = 'woocommerce';

function storeBase(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw Object.assign(new Error('Enter your store address, e.g. https://shop.example.com'), { status: 400 });
  }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw Object.assign(new Error('The store must use https so your API key is not sent in plain text.'), { status: 400 });
  return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
}

const auth = (s) => ({ Authorization: `Basic ${Buffer.from(`${s.consumerKey}:${s.consumerSecret}`).toString('base64')}`, Accept: 'application/json' });

export const woocommerce = {
  id: ID,
  name: 'WooCommerce',
  kind: 'apikey',
  configured: () => true,
  setup: [],
  capabilities: ['Import orders (line items, refunds) as sales'],
  notCapable: ['Payment-gateway fees are not part of WooCommerce orders — add them per sale or as expenses'],

  async connect({ storeUrl, consumerKey, consumerSecret }) {
    if (!/^ck_\w+$/.test(consumerKey || '') || !/^cs_\w+$/.test(consumerSecret || '')) throw Object.assign(new Error('Paste the consumer key (ck_…) and consumer secret (cs_…) from WooCommerce.'), { status: 400 });
    const base = storeBase(storeUrl);
    const secret = { base, consumerKey, consumerSecret };
    let res;
    try {
      res = await fetch(`${base}/wp-json/wc/v3/orders?per_page=1`, { headers: auth(secret) });
    } catch {
      throw Object.assign(new Error('Could not reach the store. Check the address.'), { status: 502 });
    }
    if (res.status === 401) throw Object.assign(new Error('The store rejected these keys.'), { status: 400 });
    if (res.status === 403) {
      save(ID, { status: 'permissions_missing', account: base, meta: { error: 'The key needs Read permission.' } });
      throw Object.assign(new Error('The key needs “Read” permission.'), { status: 400 });
    }
    if (res.status === 404) throw Object.assign(new Error('No WooCommerce REST API at that address.'), { status: 400 });
    if (!res.ok) throw Object.assign(new Error(`The store answered with HTTP ${res.status}.`), { status: 502 });
    return save(ID, { status: 'connected', account: base, secret, scopes: 'read', connected_at: new Date().toISOString(), meta: null });
  },

  async importOrders({ sinceDays = 90 } = {}) {
    const r = row(ID);
    if (r?.status !== 'connected' || !r.secret?.base) throw Object.assign(new Error('WooCommerce is not connected.'), { status: 409 });
    return syncing(ID, 'WooCommerce', async () => {
      const rows = [];
      const after = sinceDate(sinceDays).toISOString();
      for (let page = 1; page <= 20; page++) {
        const res = await fetch(`${r.secret.base}/wp-json/wc/v3/orders?after=${encodeURIComponent(after)}&per_page=100&page=${page}`, { headers: auth(r.secret) });
        if (!res.ok) throw failure(ID, res, 'Importing WooCommerce orders');
        const orders = await res.json();
        for (const o of orders) {
          if (['cancelled', 'failed', 'pending', 'checkout-draft', 'trash'].includes(o.status)) continue;
          const refundTotal = Math.abs((o.refunds || []).reduce((s, x) => s + Number(x.total || 0), 0));
          const items = o.line_items || [];
          const orderTotal = items.reduce((s, li) => s + Number(li.total || 0), 0) || 1;
          for (const li of items) {
            const qty = Number(li.quantity) || 0;
            rows.push({
              externalId: `${o.id}:${li.id}`,
              date: o.date_created_gmt || o.date_created,
              title: li.name,
              quantity: qty,
              unitPrice: qty ? Number(li.total || 0) / qty : 0,
              currency: o.currency,
              // Order-level refunds are split across lines by value.
              refund: refundTotal * (Number(li.total || 0) / orderTotal),
            });
          }
        }
        if (orders.length < 100) break;
      }
      return importSales(ID, 'WooCommerce', rows);
    });
  },
};
