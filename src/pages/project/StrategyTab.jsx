import { useState } from 'react';
import { motion } from 'framer-motion';
import { Megaphone, Copy, Store, Rocket, Target, Camera, ListChecks, FlaskConical, BarChart, Wand2, ExternalLink, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { Card, Button, Badge, Banner, Field, NumberInput, Modal, Stagger, StaggerItem } from '../../components/ui.jsx';
import { money, relTime } from '../../utils/format.js';

const DIFF = { easy: 'ok', moderate: 'warn', hard: 'danger' };

function copy(text, toast) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard'), () => toast('Copy failed — select the text manually', 'error'));
}

export default function StrategyTab({ project: p, setProject, action, ctx, patch }) {
  const { toast, settings, currency } = ctx;
  const s = p.strategy;
  const [form, setForm] = useState({ delivery: settings?.deliveryOptions || ['pickup', 'courier'], marketingHoursPerWeek: settings?.marketingHoursPerWeek ?? 3, audienceSize: settings?.audienceSize ?? 0, adBudget: 0, goal: 'commercial' });
  const [checked, setChecked] = useState(new Set());
  const [publish, setPublish] = useState(null);
  const integrations = useApi('/integrations');
  const shopify = integrations.data?.find((i) => i.id === 'shopify');

  const generate = () => action.run('ch', async () => setProject(await api.post(`/projects/${p.id}/channels`, form)), 'Sales strategy ready');
  const lp = s?.launchPlan;

  return (
    <div className="stack-lg">
      <Card title="Your selling situation" sub="Used to rank channels for this product">
        <div className="form-grid">
          <Field label="Delivery options">
            <div className="row" style={{ gap: 6 }}>
              {['pickup', 'courier', 'post'].map((d) => (
                <button key={d} type="button" className={`chip ${form.delivery.includes(d) ? 'active' : ''}`} aria-pressed={form.delivery.includes(d)} onClick={() => setForm((f) => ({ ...f, delivery: f.delivery.includes(d) ? f.delivery.filter((x) => x !== d) : [...f.delivery, d] }))}>{d}</button>
              ))}
            </div>
          </Field>
          <Field label="Marketing time / week"><NumberInput value={form.marketingHoursPerWeek} min={0} onChange={(v) => setForm({ ...form, marketingHoursPerWeek: v ?? 0 })} suffix="h" /></Field>
          <Field label="Existing audience (followers)"><NumberInput value={form.audienceSize} min={0} onChange={(v) => setForm({ ...form, audienceSize: v ?? 0 })} /></Field>
          <Field label="Ad budget / month"><NumberInput value={form.adBudget} min={0} onChange={(v) => setForm({ ...form, adBudget: v ?? 0 })} suffix={currency} /></Field>
          <Field label="Ambition">
            <select className="select" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })}>
              <option value="diy">Side income</option><option value="commercial">Small business</option><option value="scalable">Scalable business</option>
            </select>
          </Field>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Button variant="primary" icon={Wand2} loading={action.busy === 'ch'} onClick={generate}>{s ? 'Re-rank channels' : 'Recommend sales channels'}</Button>
          {s && <span className="xs muted">Generated {relTime(s.generatedAt)} · {s.engine === 'ai' ? 'AI' : 'rule-based demo engine'}</span>}
        </div>
      </Card>

      {s && (
        <>
          <Banner tone="warn">{s.caveats}</Banner>
          <Stagger className="grid g-2">
            {s.channels.map((c, i) => (
              <StaggerItem key={c.name}>
                <div className="card" style={{ height: '100%' }}>
                  <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                    <div>
                      <div className="row" style={{ gap: 6 }}><Badge tone="accent">#{i + 1}</Badge><Badge>{c.type}</Badge><Badge tone={DIFF[c.difficulty]}>{c.difficulty} to start</Badge></div>
                      <h3 style={{ fontSize: 16, marginTop: 6 }}>{c.name}</h3>
                    </div>
                    <div className="right"><div className="xs muted mono">FIT</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>{Math.round(c.fitScore)}</div></div>
                  </div>
                  <div className="stack small" style={{ marginTop: 10, gap: 8 }}>
                    <p><strong>Why: </strong><span className="text-2">{c.whyItFits}</span></p>
                    <p><strong>Customers: </strong><span className="text-2">{c.likelyCustomers}</span></p>
                    <p><strong>Costs: </strong><span className="text-2">{c.costs}</span></p>
                    <p><strong>Setup: </strong><span className="text-2">{c.setup}</span></p>
                    <p><strong>Listing: </strong><span className="text-2">{c.listingFormat}</span></p>
                    <p><strong>Test: </strong><span className="text-2">{c.marketingTest}</span></p>
                    <p><strong>Risks: </strong><span className="text-2">{c.risks}</span></p>
                    <p className="xs muted">{c.regionalNote}</p>
                    <div className="card tight callout"><strong>First step: </strong>{c.firstStep}</div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>

          {lp && (
            <div className="grid g-main" style={{ alignItems: 'start' }}>
              <Card title="Listing draft" sub="Edit before publishing" actions={<Button size="sm" icon={Copy} onClick={() => copy(`${lp.title}\n\n${lp.description}\n\n${lp.keywords.join(', ')}`, toast)}>Copy all</Button>}>
                <div className="stack">
                  <Field label="Title"><div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" readOnly value={lp.title} /><Button icon={Copy} onClick={() => copy(lp.title, toast)} aria-label="Copy title" /></div></Field>
                  <Field label="Description"><textarea className="textarea" readOnly value={lp.description} style={{ minHeight: 140 }} /></Field>
                  <Field label="Keywords"><div className="row" style={{ gap: 6 }}>{lp.keywords.map((k) => <Badge key={k}>{k}</Badge>)}</div></Field>
                  <div className="grid g-2">
                    <div><div className="label row" style={{ gap: 6 }}><Camera size={13} />Photos to take</div><ul className="list small">{lp.photos.map((x) => <li key={x}>{x}</li>)}</ul></div>
                    <div><div className="label row" style={{ gap: 6 }}><ListChecks size={13} />Listing structure</div><ul className="list small">{lp.listingStructure.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  </div>
                  <hr className="divider" />
                  <div className="row">
                    {shopify?.status === 'connected' ? (
                      <Button variant="primary" icon={Store} onClick={() => setPublish({ title: lp.title, description: lp.description, tags: lp.keywords.slice(0, 10), price: p.economics.price })}>Create Shopify draft…</Button>
                    ) : (
                      <Button icon={Store} disabled title="Connect Shopify in Integrations">Shopify not connected</Button>
                    )}
                    <Button icon={Rocket} onClick={() => patch({ status: 'listed' }, 'Marked as listed')}>I listed it manually</Button>
                  </div>
                  <p className="xs muted">Nothing is published automatically. Shopify drafts are created only after you confirm, and stay unpublished until you publish them in Shopify.</p>
                </div>
              </Card>
              <div className="stack">
                <Card title="Pricing strategy" actions={<Target size={16} className="muted" />}><p className="small text-2">{lp.pricingStrategy}</p><p className="xs muted" style={{ marginTop: 6 }}>Current price {money(p.economics.price, currency)} · break-even {money(p.computed.economics.breakEvenPrice, currency)}</p></Card>
                <Card title="Experiments" actions={<FlaskConical size={16} className="muted" />}><ul className="list small">{lp.experiments.map((x) => <li key={x}>{x}</li>)}</ul><p className="xs muted" style={{ marginTop: 6 }}>Audience: {lp.audience}</p></Card>
                <Card title="Launch checklist">
                  <ul className="list-plain stack" style={{ gap: 6 }}>
                    {lp.checklist.map((x) => (
                      <li key={x}><label className="checkbox small"><input type="checkbox" checked={checked.has(x)} onChange={() => setChecked((c) => { const n = new Set(c); n.has(x) ? n.delete(x) : n.add(x); return n; })} />{x}</label></li>
                    ))}
                  </ul>
                </Card>
                <Card title="KPIs to watch" actions={<BarChart size={16} className="muted" />}><ul className="list small">{lp.kpis.map((x) => <li key={x}>{x}</li>)}</ul></Card>
              </div>
            </div>
          )}
        </>
      )}
      {!s && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card">
          <div className="row small text-2"><Megaphone size={16} className="accent-text" />No strategy yet. Rankings consider product size, price, fees, your delivery options, marketing time and audience — and always favour cheap demand validation first.</div>
        </motion.div>
      )}

      <Modal
        open={Boolean(publish)}
        onClose={() => setPublish(null)}
        title="Create a Shopify draft product"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublish(null)}>Cancel</Button>
            <Button variant="primary" icon={ShieldCheck} loading={action.busy === 'pub'} onClick={() => action.run('pub', async () => { const r = await api.post('/integrations/shopify/publish', { projectId: p.id, confirm: true, ...publish }); setPublish(null); toast(`Draft created in Shopify (${r.handle})`); }, undefined)}>
              Confirm — create draft
            </Button>
          </>
        }
      >
        {publish && (
          <div className="stack">
            <Banner tone="info">This will create a <strong>DRAFT</strong> product in {shopify?.account}. It will not be visible to customers until you publish it in Shopify admin.</Banner>
            <Field label="Title"><input className="input" value={publish.title} maxLength={255} onChange={(e) => setPublish({ ...publish, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={publish.description} onChange={(e) => setPublish({ ...publish, description: e.target.value })} /></Field>
            <Field label={`Price (${currency}) — check your store currency`}><NumberInput value={publish.price} min={0} onChange={(v) => setPublish({ ...publish, price: v })} /></Field>
            <a className="xs" href="https://help.shopify.com/en/manual/products" target="_blank" rel="noopener noreferrer">Shopify product help <ExternalLink size={10} /></a>
          </div>
        )}
      </Modal>
    </div>
  );
}
