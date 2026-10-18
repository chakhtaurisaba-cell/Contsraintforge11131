import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plug, Store, FileSpreadsheet, PenLine, Link2Off, Download, Upload, CheckCircle2, XCircle, Clock, Ban } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Card, Button, Badge, Banner, Field, Modal, LoadingBlock, ErrorState } from '../components/ui.jsx';
import { parseCSV, relTime } from '../utils/format.js';

const ICONS = { shopify: Store, csv: FileSpreadsheet, manual: PenLine, marketplaces: Ban };
const STATUS = {
  connected: ['ok', CheckCircle2, 'Connected'],
  pending: ['warn', Clock, 'Authorization pending'],
  error: ['danger', XCircle, 'Error'],
  disconnected: ['', Link2Off, 'Not connected'],
  available: ['ok', CheckCircle2, 'Available'],
  not_available: ['', Ban, 'Not available'],
};

const TARGETS = [
  ['date', 'Date *'], ['channel', 'Channel'], ['quantity', 'Quantity *'], ['unitPrice', 'Unit price *'], ['total', 'Order total (if no unit price)'],
  ['fees', 'Fees'], ['shippingCost', 'Shipping cost'], ['refund', 'Refund'], ['product', 'Product name'],
];
const GUESS = { date: /date|created/i, channel: /channel|source|platform/i, quantity: /qty|quantity|units/i, unitPrice: /unit.?price|price/i, total: /total|amount/i, fees: /fee/i, shippingCost: /ship/i, refund: /refund/i, product: /product|item|title/i };

function normDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // day-first (common outside US)
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const numOf = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

function CsvImport({ projects, onDone }) {
  const { toast } = useApp();
  const { busy, run } = useAction(toast);
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [defaults, setDefaults] = useState({ channel: 'CSV import', projectId: '' });
  const file = useRef(null);
  const header = rows?.[0] || [];

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('CSV too large (max 5 MB).', 'error');
    const parsed = parseCSV(await f.text());
    if (parsed.length < 2) return toast('The file has no data rows.', 'error');
    setRows(parsed);
    const m = {};
    for (const [k] of TARGETS) {
      const idx = parsed[0].findIndex((h) => GUESS[k].test(h) && !Object.values(m).includes(parsed[0].indexOf(h)));
      if (idx >= 0) m[k] = idx;
    }
    setMap(m);
  }

  const mapped = useMemo(() => {
    if (!rows) return { ok: [], bad: 0 };
    const ok = [];
    let bad = 0;
    for (const r of rows.slice(1)) {
      const get = (k) => (map[k] != null ? r[map[k]] : undefined);
      const quantity = Math.round(numOf(get('quantity') ?? 1)) || 1;
      let unitPrice = numOf(get('unitPrice'));
      if ((map.unitPrice == null || !unitPrice) && map.total != null) unitPrice = numOf(get('total')) / quantity;
      const date = normDate(get('date'));
      const productName = get('product');
      const project = projects.find((p) => productName && p.name.toLowerCase() === String(productName).toLowerCase());
      const sale = {
        date, channel: (get('channel') || defaults.channel || 'CSV import').slice(0, 80), quantity, unitPrice: Math.round(unitPrice * 100) / 100,
        fees: numOf(get('fees')), shippingCost: numOf(get('shippingCost')), refund: numOf(get('refund')),
        projectId: project?.id || defaults.projectId || null, note: productName ? String(productName).slice(0, 200) : undefined,
      };
      if (!date || !Number.isFinite(sale.unitPrice) || sale.unitPrice < 0 || [sale.fees, sale.shippingCost, sale.refund].some((x) => !Number.isFinite(x) || x < 0)) bad++;
      else ok.push(sale);
    }
    return { ok, bad };
  }, [rows, map, defaults, projects]);

  return (
    <div className="stack">
      <div className="row">
        <Button icon={Upload} onClick={() => file.current?.click()}>Choose CSV file</Button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
        <a className="btn btn-ghost btn-sm" href={`data:text/csv;charset=utf-8,${encodeURIComponent('date,channel,product,quantity,unit_price,fees,shipping,refund\n2026-10-01,Local market,Wall shelf,2,45,0,0,0\n')}`} download="constraintforge-sales-template.csv"><Download size={14} />Template</a>
      </div>
      {rows && (
        <>
          <div className="form-grid">
            {TARGETS.map(([k, l]) => (
              <Field key={k} label={l}>
                <select className="select input-sm" value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">— not in file —</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </Field>
            ))}
            <Field label="Default channel"><input className="input input-sm" value={defaults.channel} maxLength={80} onChange={(e) => setDefaults({ ...defaults, channel: e.target.value })} /></Field>
            <Field label="Assign unmatched rows to">
              <select className="select input-sm" value={defaults.projectId} onChange={(e) => setDefaults({ ...defaults, projectId: e.target.value })}>
                <option value="">Unassigned</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Banner tone={mapped.bad ? 'warn' : 'info'}>{mapped.ok.length} row(s) ready to import{mapped.bad ? `, ${mapped.bad} skipped (missing/invalid date or price)` : ''}. Rows whose product name matches a project are linked to it.</Banner>
          {mapped.ok.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Channel</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fees</th><th>Product</th></tr></thead>
                <tbody>{mapped.ok.slice(0, 5).map((s, i) => <tr key={i}><td>{s.date}</td><td>{s.channel}</td><td className="num">{s.quantity}</td><td className="num">{s.unitPrice}</td><td className="num">{s.fees}</td><td>{projects.find((p) => p.id === s.projectId)?.name || <span className="muted">Unassigned</span>}</td></tr>)}</tbody>
              </table>
              {mapped.ok.length > 5 && <p className="xs muted">…and {mapped.ok.length - 5} more</p>}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setRows(null)}>Cancel</Button>
            <Button variant="primary" disabled={!mapped.ok.length} loading={busy === 'imp'} onClick={() => run('imp', async () => { await api.post('/sales/import', { rows: mapped.ok }); setRows(null); onDone?.(); }, `Imported ${mapped.ok.length} sale(s)`)}>Import {mapped.ok.length} sales</Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Integrations() {
  const { data, error, loading, reload } = useApi('/integrations');
  const projects = useApi('/projects');
  const { toast, setPageContext } = useApp();
  const { busy, run } = useAction(toast);
  const [params, setParams] = useSearchParams();
  const [shop, setShop] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    if (params.get('shopify') === 'connected') toast('Shopify store connected');
    if (params.get('shopify_error')) toast(params.get('shopify_error'), 'error');
    if (params.toString()) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) setPageContext('integrations', data.map(({ name, status, configured }) => ({ name, status, configured }))); }, [data, setPageContext]);

  const shopify = data?.find((i) => i.id === 'shopify');
  const connectShopify = (e) => {
    e.preventDefault();
    const s = shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return toast('Enter the store domain, e.g. my-store.myshopify.com', 'error');
    window.location.href = `/api/integrations/shopify/install?shop=${encodeURIComponent(s)}`;
  };

  return (
    <Page eyebrow="Connect" title="Integrations" sub="Bring real sales in. Push listings out.">
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock rows={4} />}
      {data && (
        <div className="stack-lg">
          <div className="grid g-2">
            {data.map((i) => {
              const Icon = ICONS[i.id] || Plug;
              const [tone, SIcon, label] = STATUS[i.status] || STATUS.disconnected;
              return (
                <Card key={i.id}>
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                      <div className="empty-art" style={{ width: 44, height: 44, borderRadius: 12, margin: 0 }}><Icon size={20} /></div>
                      <div>
                        <h3 style={{ fontSize: 16 }}>{i.name}</h3>
                        <p className="small text-2">{i.description}</p>
                      </div>
                    </div>
                    <Badge tone={tone} icon={SIcon}>{label}</Badge>
                  </div>
                  {(i.capabilities.length > 0 || i.notCapable.length > 0) && (
                    <ul className="list small" style={{ marginTop: 10 }}>
                      {i.capabilities.map((c) => <li key={c}>{c}</li>)}
                      {i.notCapable.map((c) => <li key={c} className="muted">{c}</li>)}
                    </ul>
                  )}
                  {i.importedRecords != null && <p className="xs muted" style={{ marginTop: 6 }}>{i.importedRecords} record(s) imported</p>}

                  {i.id === 'shopify' && (
                    <div style={{ marginTop: 14 }}>
                      {!i.configured && <Banner tone="warn">Requires a Shopify app's API key and secret on the server (<span className="mono">SHOPIFY_API_KEY</span>, <span className="mono">SHOPIFY_API_SECRET</span>). See README → Shopify.</Banner>}
                      {i.configured && i.status !== 'connected' && (
                        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={connectShopify}>
                          <input className="input" placeholder="your-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} aria-label="Shopify store domain" />
                          <Button type="submit" variant="primary">Connect</Button>
                        </form>
                      )}
                      {i.status === 'error' && i.meta?.error && <div style={{ marginTop: 8 }}><Banner tone="danger">{i.meta.error}</Banner></div>}
                      {i.status === 'connected' && (
                        <div className="stack">
                          <dl className="kv small"><dt>Store</dt><dd>{i.account}</dd><dt>Scopes</dt><dd className="mono xs">{i.scopes}</dd><dt>Connected</dt><dd>{relTime(i.connectedAt)}</dd></dl>
                          <div className="row">
                            <Button icon={Download} loading={busy === 'imp'} onClick={() => run('imp', async () => { const r = await api.post('/integrations/shopify/import', { sinceDays: 90 }); toast(`Imported ${r.imported} order line(s); ${r.skipped} already present. ${r.note}`); reload(); })}>Import last 90 days of orders</Button>
                            <Button variant="danger" icon={Link2Off} onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <Card title="Import sales from CSV" sub="Exports from marketplaces, POS systems or spreadsheets. Map columns, preview, then import.">
            <CsvImport projects={projects.data || []} onDone={reload} />
          </Card>
          <Card title="Security">
            <ul className="list small">
              <li>Store access tokens are kept on the server and never sent to the browser.</li>
              <li>Shopify connections use OAuth with a one-time state value and HMAC verification of the callback.</li>
              <li>Listings are created as drafts and only after you confirm; nothing is purchased, published or repriced automatically.</li>
              <li>Disconnecting deletes the stored token. To fully revoke access, also uninstall the app in your Shopify admin.</li>
            </ul>
          </Card>
        </div>
      )}
      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect Shopify?" footer={<><Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>Cancel</Button><Button variant="danger" loading={busy === 'dc'} onClick={() => run('dc', async () => { await api.post('/integrations/shopify/disconnect'); setConfirmDisconnect(false); reload(); }, 'Shopify disconnected')}>Disconnect</Button></>}>
        <p className="text-2">The access token for {shopify?.account} will be deleted. Previously imported sales stay in your records.</p>
      </Modal>
    </Page>
  );
}
