// Shopify integration: OAuth authorization-code flow + GraphQL Admin API.
// The access token is stored server-side only and never sent to the browser.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, shopifyConfigured } from '../config.js';
import { get, run, now, uid, parseJSON, logActivity, transaction } from '../db.js';

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function integrationRow(provider) {
  return get('SELECT * FROM integrations WHERE provider = ?', provider);
}

function upsert(provider, fields) {
  const existing = integrationRow(provider);
  const merged = { status: 'disconnected', account: null, secret: null, scopes: null, meta: '{}', connected_at: null, ...(existing || {}), ...fields, updated_at: now() };
  run(
    `INSERT INTO integrations (provider, status, account, secret, scopes, meta, connected_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET status=excluded.status, account=excluded.account, secret=excluded.secret, scopes=excluded.scopes, meta=excluded.meta, connected_at=excluded.connected_at, updated_at=excluded.updated_at`,
    provider, merged.status, merged.account, merged.secret, merged.scopes, merged.meta, merged.connected_at, merged.updated_at
  );
}

export function publicStatus() {
  const row = integrationRow('shopify');
  return {
    provider: 'shopify',
    configured: shopifyConfigured(),
    status: row?.status || 'disconnected',
    account: row?.account || null,
    scopes: row?.scopes || null,
    connectedAt: row?.connected_at || null,
    meta: (() => {
      const m = parseJSON(row?.meta, {});
      delete m.state;
      return m;
    })(),
  };
}

export function buildInstallUrl(shop) {
  if (!shopifyConfigured()) throw Object.assign(new Error('Shopify app credentials are not configured on the server (SHOPIFY_API_KEY / SHOPIFY_API_SECRET).'), { status: 503 });
  if (!SHOP_RE.test(shop || '')) throw Object.assign(new Error('Enter your store domain in the form your-store.myshopify.com'), { status: 400 });
  const state = randomBytes(16).toString('hex');
  upsert('shopify', { status: 'pending', account: shop.toLowerCase(), secret: null, meta: JSON.stringify({ state, startedAt: now() }) });
  const params = new URLSearchParams({
    client_id: config.shopify.apiKey,
    scope: config.shopify.scopes,
    redirect_uri: `${config.shopify.callbackBase}/api/integrations/shopify/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

export function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest).sort().map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`).join('&');
  const digest = createHmac('sha256', config.shopify.apiSecret).update(message).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(hmac), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleCallback(query) {
  const row = integrationRow('shopify');
  const meta = parseJSON(row?.meta, {});
  if (!row || row.status !== 'pending' || !meta.state || meta.state !== query.state) throw Object.assign(new Error('OAuth state mismatch. Start the connection again.'), { status: 400 });
  if (!SHOP_RE.test(query.shop || '') || query.shop.toLowerCase() !== row.account) throw Object.assign(new Error('Unexpected shop domain in callback.'), { status: 400 });
  if (!verifyHmac(query)) throw Object.assign(new Error('Shopify request signature could not be verified.'), { status: 400 });
  const res = await fetch(`https://${query.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: config.shopify.apiKey, client_secret: config.shopify.apiSecret, code: query.code }),
  });
  if (!res.ok) {
    upsert('shopify', { status: 'error', meta: JSON.stringify({ error: `Token exchange failed (${res.status})` }) });
    throw Object.assign(new Error('Shopify token exchange failed.'), { status: 502 });
  }
  const body = await res.json();
  upsert('shopify', { status: 'connected', secret: body.access_token, scopes: body.scope, connected_at: now(), meta: JSON.stringify({}) });
  logActivity('integration', `Shopify store ${row.account} connected`);
}

export function disconnect() {
  // Removes the token locally. To fully revoke, uninstall the app from the Shopify admin.
  upsert('shopify', { status: 'disconnected', secret: null, scopes: null, connected_at: null, meta: JSON.stringify({}) });
  logActivity('integration', 'Shopify disconnected');
}

async function gql(query, variables = {}) {
  const row = integrationRow('shopify');
  if (row?.status !== 'connected' || !row.secret) throw Object.assign(new Error('Shopify is not connected.'), { status: 409 });
  const res = await fetch(`https://${row.account}/admin/api/${config.shopify.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': row.secret },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    upsert('shopify', { status: 'error', meta: JSON.stringify({ error: 'Access was revoked or scopes are insufficient. Reconnect the store.' }) });
    throw Object.assign(new Error('Shopify rejected the access token. Reconnect the store.'), { status: 502 });
  }
  const body = await res.json();
  if (body.errors?.length) throw Object.assign(new Error(`Shopify API error: ${body.errors[0].message}`), { status: 502 });
  return body.data;
}

const ORDERS_QUERY = `query Orders($q: String!, $after: String) {
  orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name createdAt
      lineItems(first: 50) { edges { node {
        id title quantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        product { id }
      } } }
    } }
  }
}`;

/** Imports order line items as sales. Fees and shipping costs are not available from this query and are imported as 0 (editable afterwards). */
export async function importOrders({ sinceDays = 90, projectMap = {} }) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  let after = null;
  let imported = 0;
  let skipped = 0;
  for (let page = 0; page < 20; page++) {
    const data = await gql(ORDERS_QUERY, { q: `created_at:>=${since}`, after });
    const edges = data.orders.edges;
    transaction(() => {
      for (const { node: order } of edges) {
        for (const { node: li } of order.lineItems.edges) {
          const externalId = `${order.id}:${li.id}`;
          if (get('SELECT id FROM sales WHERE external_id = ?', externalId)) { skipped++; continue; }
          const projectId = projectMap[li.product?.id] || null;
          run(
            'INSERT INTO sales (id, project_id, date, channel, quantity, unit_price, currency, note, source, external_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            uid(), projectId, order.createdAt.slice(0, 10), 'Shopify', li.quantity, Number(li.originalUnitPriceSet.shopMoney.amount), li.originalUnitPriceSet.shopMoney.currencyCode, `${order.name} · ${li.title}`, 'shopify', externalId, now()
          );
          imported++;
        }
      }
    });
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  logActivity('integration', `Imported ${imported} Shopify order line(s)`);
  return { imported, skipped, note: 'Shopify fees, shipping and payment costs are not included in this import; add them per sale or as expenses.' };
}

/** Creates a DRAFT product so nothing goes live without the merchant reviewing it in Shopify. */
export async function publishDraft({ title, descriptionHtml, tags, price }) {
  const created = await gql(
    `mutation Create($product: ProductCreateInput!) { productCreate(product: $product) { product { id handle variants(first: 1) { edges { node { id } } } } userErrors { field message } } }`,
    { product: { title, descriptionHtml, tags, status: 'DRAFT' } }
  );
  const errs = created.productCreate.userErrors;
  if (errs?.length) throw Object.assign(new Error(`Shopify: ${errs.map((e) => e.message).join('; ')}`), { status: 422 });
  const product = created.productCreate.product;
  const variantId = product.variants.edges[0]?.node.id;
  if (variantId && price) {
    const upd = await gql(
      `mutation Price($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`,
      { productId: product.id, variants: [{ id: variantId, price: String(price) }] }
    );
    if (upd.productVariantsBulkUpdate.userErrors?.length) throw Object.assign(new Error('Product created but price could not be set.'), { status: 422 });
  }
  logActivity('integration', `Created Shopify draft product "${title}"`);
  return { productId: product.id, handle: product.handle, status: 'DRAFT' };
}
