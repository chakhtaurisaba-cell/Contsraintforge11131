import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware.js';
import { config } from '../config.js';
import { all, get, run, now } from '../db.js';
import { getProject } from '../services/projects.js';
import * as shopify from '../services/shopify.js';
import { listIntegrations, CONNECTORS } from '../services/commerce/registry.js';
import { disconnect as disconnectConnector } from '../services/commerce/store.js';

export const integrations = Router();

// Status of every connector, derived from stored facts (see services/commerce/registry.js).
integrations.get('/integrations', (_req, res) => res.json(listIntegrations()));

/* ---------- Shopify ---------- */
integrations.get('/integrations/shopify/install', (req, res) => {
  try {
    res.redirect(shopify.buildInstallUrl(String(req.query.shop || '').trim()));
  } catch (err) {
    res.redirect(`${config.appUrl}/app/integrations?shopify_error=${encodeURIComponent(err.message)}`);
  }
});

integrations.get('/integrations/shopify/callback', async (req, res) => {
  try {
    await shopify.handleCallback(req.query);
    res.redirect(`${config.appUrl}/app/integrations?shopify=connected`);
  } catch (err) {
    res.redirect(`${config.appUrl}/app/integrations?shopify_error=${encodeURIComponent(err.message)}`);
  }
});

integrations.post('/integrations/shopify/disconnect', (_req, res) => {
  shopify.disconnect();
  res.json(shopify.publicStatus());
});

integrations.post('/integrations/shopify/import', validate(z.object({ sinceDays: z.number().int().min(1).max(365).default(90) })), async (req, res) => {
  // Map Shopify product ids to projects that were published from ConstraintForge.
  const map = {};
  for (const p of all('SELECT id, strategy FROM projects')) {
    const pid = JSON.parse(p.strategy || '{}').shopifyProductId;
    if (pid) map[pid] = p.id;
  }
  const result = await shopify.importOrders({ sinceDays: req.body.sinceDays, projectMap: map });
  const r = get('SELECT meta FROM integrations WHERE provider = ?', 'shopify');
  run('UPDATE integrations SET meta = ? WHERE provider = ?', JSON.stringify({ ...JSON.parse(r?.meta || '{}'), lastSyncAt: now(), lastSyncImported: result.imported }), 'shopify');
  res.json(result);
});

integrations.post('/integrations/shopify/publish', validate(z.object({ projectId: z.string(), confirm: z.literal(true), title: z.string().min(1).max(255), description: z.string().max(20000), tags: z.array(z.string().max(60)).max(50).default([]), price: z.number().positive() })), async (req, res) => {
  const p = getProject(req.body.projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html = req.body.description.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('');
  const result = await shopify.publishDraft({ title: req.body.title, descriptionHtml: html, tags: req.body.tags, price: req.body.price });
  run('UPDATE projects SET strategy = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify({ ...(p.strategy || {}), shopifyProductId: result.productId }), 'listed', now(), p.id);
  res.json(result);
});

/* ---------- other connectors (WooCommerce, Etsy, eBay, Amazon) ---------- */
const connector = (req) => {
  const c = CONNECTORS[req.params.id];
  if (!c) throw Object.assign(new Error('Unknown integration'), { status: 404 });
  return c;
};
const back = (params) => `${config.appUrl}/app/integrations?${new URLSearchParams(params)}`;

// OAuth start: redirect the browser to the platform's consent page.
integrations.get('/integrations/:id/connect', (req, res) => {
  try {
    const c = connector(req);
    if (c.kind !== 'oauth') throw Object.assign(new Error('This integration connects with an API key.'), { status: 400 });
    if (!c.configured()) throw Object.assign(new Error(`${c.name} isn't set up on this server yet.`), { status: 503 });
    res.redirect(c.authorizeUrl());
  } catch (err) {
    res.redirect(back({ integration_error: err.message, id: req.params.id }));
  }
});

integrations.get('/integrations/:id/callback', async (req, res) => {
  try {
    await connector(req).handleCallback(req.query);
    res.redirect(back({ connected: req.params.id }));
  } catch (err) {
    res.redirect(back({ integration_error: err.message, id: req.params.id }));
  }
});

// Key-based connection (WooCommerce): the key is verified against the store first.
integrations.post('/integrations/:id/connect', validate(z.object({ storeUrl: z.string().max(300), consumerKey: z.string().max(200), consumerSecret: z.string().max(200) })), async (req, res) => {
  const c = connector(req);
  if (c.kind !== 'apikey') return res.status(400).json({ error: 'This integration connects through the platform’s sign-in page.' });
  await c.connect(req.body);
  res.json(listIntegrations().find((i) => i.id === c.id));
});

integrations.post('/integrations/:id/import', validate(z.object({ sinceDays: z.number().int().min(1).max(365).default(90) })), async (req, res) => {
  res.json(await connector(req).importOrders({ sinceDays: req.body.sinceDays }));
});

integrations.post('/integrations/:id/disconnect', (req, res) => {
  disconnectConnector(connector(req).id);
  res.json(listIntegrations().find((i) => i.id === req.params.id));
});
