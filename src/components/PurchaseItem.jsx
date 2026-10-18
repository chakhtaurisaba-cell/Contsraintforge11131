import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, ExternalLink, Plus, Trophy, Trash2, ChevronDown, Globe, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import { useAction } from '../hooks/useApi.js';
import { Button, Badge, Banner, Field, NumberInput, Provenance, ExampleBadge } from './ui.jsx';
import { compareOptions, searchLinks } from '../../shared/sourcing.js';
import { money, relTime } from '../utils/format.js';

function QuoteForm({ currency, onAdd, busy }) {
  const [q, setQ] = useState({ supplier: '', title: '', url: '', price: null, currency, packQuantity: 1, shippingCost: null, deliveryDays: null, compatible: true });
  const set = (k, v) => setQ((x) => ({ ...x, [k]: v }));
  return (
    <form className="card tight stack" style={{ background: 'var(--bg)' }} onSubmit={(e) => { e.preventDefault(); onAdd({ ...q, url: q.url || undefined }).then((ok) => ok && setQ({ ...q, supplier: '', title: '', url: '', price: null })); }}>
      <div className="label">Add a quote you found (shop, website, phone call)</div>
      <div className="form-grid">
        <Field label="Supplier *"><input className="input input-sm" required maxLength={120} value={q.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
        <Field label="Price per pack *"><NumberInput className="input-sm" required value={q.price} min={0} onChange={(v) => set('price', v)} /></Field>
        <Field label="Currency"><input className="input input-sm" maxLength={3} value={q.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
        <Field label="Units per pack"><NumberInput className="input-sm" value={q.packQuantity} min={0} onChange={(v) => set('packQuantity', v || 1)} /></Field>
        <Field label="Shipping"><NumberInput className="input-sm" value={q.shippingCost} min={0} onChange={(v) => set('shippingCost', v)} /></Field>
        <Field label="Delivery (days)"><NumberInput className="input-sm" value={q.deliveryDays} min={0} onChange={(v) => set('deliveryDays', v)} /></Field>
        <Field label="Link"><input className="input input-sm" type="url" maxLength={1000} value={q.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" /></Field>
        <Field label="Compatible?"><label className="checkbox small" style={{ height: 30 }}><input type="checkbox" checked={q.compatible} onChange={(e) => set('compatible', e.target.checked)} />Meets the spec</label></Field>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" size="sm" icon={Plus} loading={busy}>Add quote</Button></div>
    </form>
  );
}

export function PurchaseItem({ item: initial, region, showProject, onChange }) {
  const { aiEnabled, toast, currency } = useApp();
  const { busy, run } = useAction(toast);
  const [item, setItem] = useState(initial);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(null);
  const cmp = item.comparison || compareOptions(item.options, item.quantity, { currency: item.currency });
  const links = item.links || searchLinks([item.name, item.spec].filter(Boolean).join(' '), region);
  const update = (next) => { setItem((cur) => ({ ...cur, ...next })); onChange?.(); };

  const meta = item.searchMeta;
  return (
    <motion.div layout className="card" style={{ opacity: item.purchased ? 0.7 : 1 }}>
      <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <label className="checkbox" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={item.purchased} style={{ marginTop: 3 }} onChange={(e) => run('p', async () => update(await api.patch(`/purchases/${item.id}`, { purchased: e.target.checked })), e.target.checked ? 'Marked as purchased' : undefined)} aria-label={`Purchased: ${item.name}`} />
          <span>
            <span className="strong" style={{ textDecoration: item.purchased ? 'line-through' : 'none' }}>{item.name}</span>
            {showProject && <span className="xs muted"> · {item.projectName}</span>} {item.isExample && <ExampleBadge />}
            <div className="small text-2">{item.spec}</div>
            {item.reason && <div className="xs muted" style={{ marginTop: 2 }}>Why: {item.reason}</div>}
          </span>
        </label>
        <div className="right" style={{ flex: 'none' }}>
          <div className="mono strong">{item.quantity} {item.unit}</div>
          <div className="xs muted">est. {money(item.estUnitPrice * item.quantity, item.currency)}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {item.chosenOption ? <Badge tone="ok" icon={CheckCircle2}>Chosen: {item.chosenOption.supplier}</Badge> : <Badge>No supplier chosen</Badge>}
        <Badge>{item.options.length} option(s)</Badge>
        {item.purchased && <Badge tone="ok">Purchased</Badge>}
        <div className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Compare & source <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div className="stack" style={{ paddingTop: 14 }}>
              <div className="row">
                <Button size="sm" variant="primary" icon={Globe} disabled={!aiEnabled} loading={busy === 's'} onClick={() => run('s', async () => { const r = await api.post(`/purchases/${item.id}/search`); setSearch(r.search); update(r); })}>
                  {aiEnabled ? 'Search live suppliers' : 'Live search needs the AI model'}
                </Button>
                <span className="xs muted">Open a search:</span>
                {links.map((l) => (
                  <a key={l.url} className="btn btn-sm btn-ghost" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <ExternalLink size={12} /></a>
                ))}
              </div>
              {(search || meta) && (
                <Banner tone={(search || meta).live ? 'info' : 'warn'}>
                  {(search || meta).note}
                  {(search || meta).retrievedAt && <span className="xs muted"> Retrieved {relTime((search || meta).retrievedAt)}.</span>}
                </Banner>
              )}
              {!aiEnabled && !meta && <Banner tone="warn">No live supplier data is connected, so no listings or prices are shown. Use the search links and record quotes below to compare them.</Banner>}

              {item.options.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Supplier</th><th className="num">Pack price</th><th className="num">Packs</th><th className="num">Total incl. shipping</th><th className="num">Spare</th><th>Delivery</th><th>Source</th><th /></tr></thead>
                    <tbody>
                      {cmp.ranked.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              {cmp.bestId === o.id && <Badge tone="accent" icon={Trophy}>Best</Badge>}
                              <span className="strong">{o.supplier}</span>
                            </div>
                            {o.title && <div className="xs muted">{o.title}</div>}
                            {o.url && <a className="xs" href={o.url} target="_blank" rel="noopener noreferrer">Open listing <ExternalLink size={10} /></a>}
                            {o.compatible === false && <div className="xs danger-text">Not compatible</div>}
                          </td>
                          <td className="num">{o.price != null ? money(o.price, o.currency || currency) : <span className="muted">not shown</span>}{o.packQuantity > 1 && <div className="xs muted">{o.packQuantity}/pack</div>}</td>
                          <td className="num">{o.packsNeeded ?? '—'}</td>
                          <td className="num strong">{o.totalCost != null ? money(o.totalCost, o.currency || currency) : '—'}{o.shippingCost == null && o.price != null && <div className="xs muted">shipping unknown</div>}</td>
                          <td className="num">{o.wasteUnits ?? '—'}</td>
                          <td className="small">{o.deliveryDays != null ? `${o.deliveryDays} d` : o.delivery || '—'}</td>
                          <td><Provenance source={o.source} /></td>
                          <td className="right nowrap">
                            <Button size="sm" variant={item.chosenOption?.id === o.id ? 'primary' : ''} onClick={() => run('c', async () => update(await api.patch(`/purchases/${item.id}`, { chosenOptionId: item.chosenOption?.id === o.id ? null : o.id })))}>
                              {item.chosenOption?.id === o.id ? 'Chosen' : 'Choose'}
                            </Button>
                            {o.source === 'manual_quote' && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove quote" onClick={() => run('d', async () => update(await api.del(`/purchases/${item.id}/options/${o.id}`)))} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {cmp.bestId && <ul className="list small">{cmp.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              {search?.alternatives?.length > 0 && <p className="small text-2"><strong>Compatible alternatives: </strong>{search.alternatives.join(', ')}</p>}

              <QuoteForm currency={item.currency || currency} busy={busy === 'q'} onAdd={(q) => run('q', async () => { update(await api.post(`/purchases/${item.id}/options`, q)); return true; }, 'Quote added')} />
              {item.purchased && (
                <Field label="Actual amount paid (optional)">
                  <NumberInput value={item.actualCost} min={0} onChange={(v) => setItem((x) => ({ ...x, actualCost: v }))} onBlur={() => run('a', async () => update(await api.patch(`/purchases/${item.id}`, { actualCost: item.actualCost ?? null })))} suffix={item.currency} />
                </Field>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
