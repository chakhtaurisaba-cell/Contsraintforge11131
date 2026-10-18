// Commerce connector registry. Adding a platform = adding a module with the same
// interface (configured, setup, capabilities, authorizeUrl/handleCallback or connect,
// importOrders) and listing it here. Status is always derived from stored facts —
// a platform is "connected" only after its authorization or key check succeeded.
import { get, parseJSON } from '../../db.js';
import { shopifyConfigured } from '../../config.js';
import { woocommerce } from './woocommerce.js';
import { etsy } from './etsy.js';
import { ebay } from './ebay.js';
import { amazon } from './amazon.js';

export const CONNECTORS = { woocommerce, etsy, ebay, amazon };

export const STATUS_LABELS = {
  not_connected: 'Not connected',
  needs_setup: 'Setup needed',
  awaiting_authorization: 'Awaiting authorization',
  connected: 'Connected',
  syncing: 'Syncing',
  error: 'Connection error',
  permissions_missing: 'Permissions missing',
  unavailable: 'Not available yet',
  available: 'Available',
};

function stored(provider) {
  const r = get('SELECT status, account, scopes, meta, connected_at FROM integrations WHERE provider = ?', provider);
  return r ? { ...r, meta: parseJSON(r.meta, {}) } : null;
}
const imported = (source) => get('SELECT COUNT(*) AS c FROM sales WHERE source = ?', source).c;

function view(id, def, r, configured) {
  let status = r?.status || 'not_connected';
  if (status === 'disconnected') status = 'not_connected';
  if (status === 'pending') status = 'awaiting_authorization';
  if (!configured && !['connected', 'syncing', 'error', 'permissions_missing'].includes(status)) status = 'needs_setup';
  const meta = { ...(r?.meta || {}) };
  delete meta.state;
  delete meta.verifier;
  return {
    id,
    name: def.name,
    kind: def.kind,
    configured,
    status,
    statusLabel: STATUS_LABELS[status],
    account: r?.account || null,
    scopes: r?.scopes || null,
    connectedAt: r?.connected_at || null,
    lastSyncAt: meta.lastSyncAt || null,
    lastSyncImported: meta.lastSyncImported ?? null,
    error: ['error', 'permissions_missing'].includes(status) ? meta.error || null : null,
    setup: configured ? [] : def.setup || [],
    capabilities: def.capabilities || [],
    notCapable: def.notCapable || [],
    importedRecords: imported(id),
  };
}

export function listIntegrations() {
  const shop = stored('shopify');
  const shopView = view('shopify', {
    name: 'Shopify',
    kind: 'oauth',
    setup: ['Create a Shopify app (Partner Dashboard / Dev Dashboard)', 'Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET in the server .env', 'Set the app redirect URL to <SHOPIFY_CALLBACK_BASE>/api/integrations/shopify/callback'],
    capabilities: ['Import orders (line items) as sales', 'Create draft products from a listing'],
    notCapable: ['Shopify fees and payouts are not imported'],
  }, shop, shopifyConfigured());
  if (shopView.status === 'connected' && shop?.scopes && !/read_orders/.test(shop.scopes)) {
    shopView.status = 'permissions_missing';
    shopView.statusLabel = STATUS_LABELS.permissions_missing;
    shopView.error = 'The store did not grant read_orders. Reconnect and approve order access.';
  }
  return [
    shopView,
    ...Object.entries(CONNECTORS).map(([id, def]) => view(id, def, stored(id), def.configured())),
    {
      id: 'tiktok',
      name: 'TikTok Shop',
      kind: 'unavailable',
      configured: false,
      status: 'unavailable',
      statusLabel: STATUS_LABELS.unavailable,
      setup: ['TikTok Shop’s API requires an approved TikTok Shop Partner Center app and signed requests; this connector is not built yet.', 'Until then: export orders from TikTok Shop Seller Center and use CSV import below.'],
      capabilities: [],
      notCapable: ['No automatic order import'],
      importedRecords: imported('tiktok'),
    },
    { id: 'csv', name: 'CSV import', kind: 'file', configured: true, status: 'available', statusLabel: STATUS_LABELS.available, setup: [], capabilities: ['Import sales exported from any platform or spreadsheet'], notCapable: [], importedRecords: imported('csv') },
  ];
}
