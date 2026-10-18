import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Sparkles, Plus, ScanLine, Wrench, Wallet, Check, GitCompare, Save, Hammer, AlertTriangle, ShieldAlert, PackagePlus, X, ChevronDown, BookOpen, ExternalLink, RotateCcw, HelpCircle, ShoppingCart, CircleCheck, Ruler, ArrowRight, Info,
} from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Card, Button, Badge, Field, NumberInput, Modal, Banner, Empty, Stagger, StaggerItem } from '../components/ui.jsx';
import { ProductPreview } from '../components/ProductPreview.jsx';
import { assignPhotos } from '../components/productPhotos.js';
import { InventoryItemForm, dimsSummary } from '../components/InventoryEditor.jsx';
import { STATUS } from '../../shared/allocation.js';
import { money } from '../utils/format.js';

const TOOL_OPTIONS = ['Saw', 'Drill / driver', 'Sandpaper', 'Clamps', 'Tape measure', 'Craft knife', 'Scissors', 'Needle & thread', 'Sewing machine', 'Hot-glue gun', 'Soldering iron', 'Paint brush'];
const SOURCE_TYPE = { build_guide: 'Build guide', video: 'Video', specification: 'Spec', product_listing: 'Listing', inspiration: 'Inspiration', forum: 'Forum', other: 'Source' };
const DIFFICULTY = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

function Chips({ options, value, onChange, allowCustom }) {
  const [custom, setCustom] = useState('');
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="row" style={{ gap: 6 }}>
      {[...new Set([...options, ...value])].map((o) => (
        <button type="button" key={o} className={`chip ${value.includes(o) ? 'active' : ''}`} onClick={() => toggle(o)} aria-pressed={value.includes(o)}>
          {value.includes(o) && <Check size={13} />}
          {o}
        </button>
      ))}
      {allowCustom && (
        <form className="row" style={{ gap: 4 }} onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { onChange([...value, custom.trim()]); setCustom(''); } }}>
          <input className="input input-sm" style={{ width: 130 }} placeholder="Add other…" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} aria-label="Add custom" />
        </form>
      )}
    </div>
  );
}

const fmtElapsed = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Shown only while a real request is in flight. Every line reflects an event the server
 * actually sent (parsing → ideas drafted so far → checking against stock); the clock is
 * real elapsed time. No simulated percentages.
 */
function GeneratingState({ progress, startedAt, hasText, onCancel }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stage = progress?.stage;
  const steps = [
    hasText && { id: 'parsing', label: 'Reading what you have' },
    { id: 'ideas', label: progress?.stage === 'ideas' && progress.drafted ? `Designing products — ${progress.drafted} drafted` : 'Designing products' },
    { id: 'checking', label: 'Checking every idea against your stock' },
  ].filter(Boolean);
  const order = steps.map((s) => s.id);
  const at = Math.max(0, order.indexOf(stage));
  return (
    <div className="card generating" role="status" aria-live="polite">
      <div className="row" style={{ gap: 16, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <motion.div animate={{ rotate: [0, 8, -8, 0] }} transition={{ repeat: Infinity, duration: 1.2 }} className="empty-art" style={{ margin: 0 }}>
          <Hammer size={28} />
        </motion.div>
        <div className="stack" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <div className="row-between">
            <div className="card-title">Working out what you can make</div>
            <span className="mono small muted">{fmtElapsed(Math.max(0, Math.round((now - startedAt) / 1000)))}</span>
          </div>
          <ol className="gen-steps">
            {steps.map((s, i) => (
              <li key={s.id} className={i < at ? 'done' : i === at && stage ? 'current' : ''}>
                <span className="gen-dot">{i < at ? <Check size={11} /> : i === at && stage ? <span className="spinner" style={{ width: 10, height: 10 }} /> : null}</span>
                {s.label}
              </li>
            ))}
          </ol>
          <div className="row">
            <span className="xs muted">Runs on your computer’s AI model. Usually under a minute.</span>
            <div className="spacer" />
            <Button size="sm" variant="ghost" icon={X} onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One line that says whether the current stock is enough — computed by the app, not the model. */
function Verdict({ idea, compact }) {
  const cur = idea.currency;
  const v = {
    ready: { tone: 'ok', icon: CircleCheck, text: `You have everything${idea.testBatch > 1 ? ` for ${idea.testBatch}` : ''}` },
    confirm: { tone: 'info', icon: Info, text: idea.sizeWarning ? 'Check one size before building' : 'Confirm an amount before building' },
    tools: { tone: 'warn', icon: Wrench, text: `Needs ${idea.toolsMissing?.join(', ')}` },
    short: { tone: 'warn', icon: ShoppingCart, text: `${idea.missing.length} item${idea.missing.length === 1 ? '' : 's'} to buy${idea.shortageCost ? ` · ~${money(idea.shortageCost, cur)}` : ''}` },
  }[idea.verdict] || { tone: 'info', icon: Info, text: '' };
  const I = v.icon;
  return (
    <div className={`verdict verdict-${v.tone}`} title={compact ? idea.sizeWarning || idea.confirmNotes?.[0] || undefined : undefined}>
      <I size={14} aria-hidden="true" />
      <span>{v.text}</span>
    </div>
  );
}

/** "Uses your: pine boards ×2, wood screws ×12" — from the allocator, at most three items. */
function UsesYour({ idea }) {
  const items = idea.usesExisting || [];
  if (!items.length) return null;
  const shown = items.slice(0, 3);
  return (
    <div className="uses-your">
      <span className="muted">Uses your</span>
      {shown.map((u, i) => (
        <span key={i} className="uses-chip" title={u.use || undefined}>{u.inventoryName}<span className="muted"> ×{u.quantityUsed}</span></span>
      ))}
      {items.length > 3 && <span className="muted">+{items.length - 3}</span>}
    </div>
  );
}

function IdeaCard({ idea, photo, selected, onCompare, onDetails, onSave, onDevelop, busy }) {
  const meta = [DIFFICULTY[idea.difficulty], idea.estProductionMinutes > 0 && `~${idea.estProductionMinutes} min each`].filter(Boolean);
  return (
    <motion.article layout className={`idea-card ${selected ? 'selected' : ''}`}>
      <div className="idea-card-media">
        <button type="button" onClick={onDetails} aria-label={`Details for ${idea.name}`}>
          <ProductPreview idea={idea} photo={photo} />
        </button>
        <label className="idea-compare" title="Compare up to 3 ideas"><input type="checkbox" checked={selected} onChange={onCompare} />Compare</label>
      </div>
      <div className="idea-card-body">
        <h3 className="idea-card-title" title={idea.name}>{idea.name}</h3>
        <p className="idea-card-summary">{idea.summary || idea.tagline}</p>
        <UsesYour idea={idea} />
        <Verdict idea={idea} compact />
        {meta.length > 0 && <div className="xs muted">{meta.join(' · ')}</div>}
      </div>
      <div className="idea-card-foot">
        <Button size="sm" variant="ghost" onClick={onDetails}>Details</Button>
        <div className="spacer" />
        <Button size="sm" icon={Save} onClick={onSave} loading={busy === `save-${idea.id}`} aria-label={`Save ${idea.name}`} title="Save idea" />
        <Button size="sm" variant="primary" onClick={onDevelop} loading={busy === `dev-${idea.id}`}>Open blueprint<ArrowRight size={14} /></Button>
      </div>
    </motion.article>
  );
}

function ResearchBlock({ idea, state, onResearch }) {
  if (state === 'loading' && !idea.research) return <div className="row xs muted"><span className="spinner" style={{ width: 11, height: 11 }} />Searching the web for build guides…</div>;
  if (!idea.research) return <Button size="sm" variant="ghost" icon={BookOpen} onClick={onResearch}>Find build guides online</Button>;
  if (!idea.research.sources?.length) return <p className="xs muted">No build guides found online for this one{idea.research.note ? ` — ${idea.research.note}` : ''}.</p>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {idea.research.sources.map((s) => (
        <div key={s.url} className="xs">
          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} <ExternalLink size={10} /></a> <span className="muted">· {SOURCE_TYPE[s.type] || 'Source'} · {s.publisher}</span>
          {s.findings?.[0] && <div className="muted">{s.findings[0]}</div>}
        </div>
      ))}
    </div>
  );
}

/** Everything about one idea, in one calm place — the card stays short. */
function IdeaDetails({ idea, photo, onClose, onSave, onDevelop, busy, researchState, onResearch }) {
  const cur = idea.currency;
  const materials = (idea.materials || []).filter((m) => m.status !== 'optional_upgrade');
  return (
    <Modal open onClose={onClose} title={idea.name} wide>
      <div className="idea-details">
        <div className="stack" style={{ gap: 10 }}>
          <ProductPreview idea={idea} photo={photo} />
          <p className="text-2">{idea.summary || idea.tagline}</p>
          <Verdict idea={idea} />
          <div className="xs muted">{[DIFFICULTY[idea.difficulty], idea.estProductionMinutes > 0 && `~${idea.estProductionMinutes} min per unit`, idea.priceLow > 0 && `sells for ~${money(idea.priceLow, cur)}–${money(idea.priceHigh, cur)}`].filter(Boolean).join(' · ')} <span className="muted">(estimates)</span></div>
        </div>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <section>
            <div className="label" style={{ marginBottom: 6 }}>Materials {idea.missingBasis}</div>
            <ul className="mat-list">
              {materials.map((m, i) => (
                <li key={i}>
                  <span className={`mat-dot tone-${STATUS[m.status]?.tone || ''}`} aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div className="small"><strong>{m.name}</strong> <span className="muted">— {m.needTotal} {m.unit}{m.use ? ` · ${m.use}` : ''}</span></div>
                    <div className="xs muted">{STATUS[m.status]?.label}{m.status === 'insufficient' ? ` · short by ${m.shortage} ${m.unit}` : ''}{m.from.length && m.status !== 'required_purchase' ? ` · from ${m.from.join(', ')}` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          {idea.missing.length > 0 && (
            <section>
              <div className="label" style={{ marginBottom: 6 }}>To buy</div>
              <ul className="list small">{idea.missing.map((m, i) => <li key={i}>{m.name} — {m.quantity} {m.unit}{m.estUnitPrice ? <span className="muted"> × ~{money(m.estUnitPrice, cur)}</span> : null}</li>)}</ul>
            </section>
          )}
          {(idea.toolsMissing?.length > 0 || idea.sizeWarning || idea.confirmNotes?.length > 0 || idea.dependsOnMeasurements?.length > 0) && (
            <section className="stack" style={{ gap: 6 }}>
              {idea.toolsMissing?.length > 0 && <div className="row small warn-text" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Wrench size={14} style={{ flex: 'none', marginTop: 3 }} />This design needs {idea.toolsMissing.join(', ')}, which isn’t in your tools.</div>}
              {idea.sizeWarning && <div className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Ruler size={14} style={{ flex: 'none', marginTop: 3 }} className="accent-text" />{idea.sizeWarning}</div>}
              {idea.confirmNotes?.map((n) => <div key={n} className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Info size={14} style={{ flex: 'none', marginTop: 3 }} className="accent-text" />{n}</div>)}
              {idea.dependsOnMeasurements?.length > 0 && <div className="small"><span className="muted">Check these sizes: </span>{idea.dependsOnMeasurements.join('; ')}</div>}
            </section>
          )}
          {idea.flags?.map((f) => <div key={f} className="row small warn-text" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><AlertTriangle size={14} style={{ flex: 'none', marginTop: 3 }} />{f}</div>)}
          {idea.safetyNote && <div className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><ShieldAlert size={14} style={{ flex: 'none', marginTop: 3 }} className="accent-text" />{idea.safetyNote}</div>}
          {idea.optionalUpgrades?.length > 0 && (
            <details className="disclosure">
              <summary className="small" style={{ padding: '8px 0' }}>Optional extras ({idea.optionalUpgrades.length}) — not needed<ChevronDown size={14} className="chev" /></summary>
              <ul className="list small" style={{ paddingBottom: 8 }}>{idea.optionalUpgrades.map((o, i) => <li key={i}>{o.name}{o.why ? <span className="muted"> — {o.why}</span> : null}</li>)}</ul>
            </details>
          )}
          <ResearchBlock idea={idea} state={researchState} onResearch={onResearch} />
        </div>
      </div>
      <div className="modal-foot">
        <Button icon={Save} onClick={onSave} loading={busy === `save-${idea.id}`}>Save idea</Button>
        <Button variant="primary" onClick={onDevelop} loading={busy === `dev-${idea.id}`}>Open blueprint<ArrowRight size={14} /></Button>
      </div>
    </Modal>
  );
}

export default function Create() {
  const { currency, settings, toast, aiEnabled, health, setPageContext } = useApp();
  const inv = useApi('/inventory');
  const { busy, run } = useAction(toast);
  const nav = useNavigate();
  // Only what changes the result: what they have, their tools, and an optional spending limit.
  // Ideas answer "can I build one?"; batch sizes are set later in the project.
  const [form, setForm] = useState({ freeText: '', tools: [], budget: null, quantity: 1 });
  const [selectedInv, setSelectedInv] = useState(null);
  const fromScan = useLocation().state?.fromScan || null; // names of items just saved from a scan
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState(null);
  const [genError, setGenError] = useState(null);
  const [researchState, setResearchState] = useState(null); // loading | done | error
  const [compare, setCompare] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [detailsId, setDetailsId] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const items = inv.data || [];
  const selected = selectedInv ?? items.map((i) => i.id);
  useEffect(() => {
    setPageContext('create', { inventory: items.map((i) => i.name), form, ideas: result?.ideas?.map((i) => ({ name: i.name, verdict: i.verdict, fit: i.fit, toBuy: i.missing?.map((m) => m.name) })) });
  }, [items, form, result, setPageContext]);

  const [generating, setGenerating] = useState(null); // { startedAt, progress } while a request runs
  const inFlight = useRef(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  /** Web research for the ideas of one run — only when the user asks for it. */
  async function research(runId) {
    setResearchState('loading');
    try {
      const rr = await api.post(`/ideas/${runId}/research`);
      setResult((cur) => (cur?.runId === runId ? { ...cur, ideas: cur.ideas.map((i) => ({ ...i, research: rr.ideas.find((x) => x.id === i.id)?.research })) } : cur));
      setResearchState(rr.error ? 'error' : 'done');
    } catch {
      setResearchState('error');
    }
  }

  async function generate() {
    if (inFlight.current) return; // one request at a time — no duplicate model calls
    const ac = new AbortController();
    inFlight.current = ac;
    setResult(null);
    setGenError(null);
    setCompare([]);
    setDetailsId(null);
    setResearchState(null);
    setGenerating({ startedAt: Date.now(), progress: null });
    try {
      const r = await api.stream('/ideas', { ...form, inventoryIds: selected, currency, region: settings?.region }, {
        signal: ac.signal,
        onEvent: (ev) => setGenerating((g) => (g ? { ...g, progress: ev } : g)),
      });
      setResult(r);
    } catch (err) {
      if (err.name !== 'AbortError') setGenError(err); // inputs stay; the user can retry
    } finally {
      inFlight.current = null;
      setGenerating(null);
    }
  }
  const cancel = () => inFlight.current?.abort();

  async function createProject(idea, develop) {
    const key = `${develop ? 'dev' : 'save'}-${idea.id}`;
    await run(key, async () => {
      const p = await api.post('/projects', { idea });
      if (p.addedToInventory?.length) {
        toast(`Added what you described to your inventory: ${p.addedToInventory.join(', ')}`);
        inv.reload();
      }
      if (develop) {
        await api.post(`/projects/${p.id}/plan`);
        nav(`/app/projects/${p.id}?tab=build`);
      } else toast(`Saved "${idea.name}" to My Projects`);
    });
  }

  // Each example photo at most once per result list.
  const photos = useMemo(() => assignPhotos(result?.ideas || []), [result]);
  const comparing = useMemo(() => (result?.ideas || []).filter((i) => compare.includes(i.id)), [result, compare]);
  const details = result?.ideas?.find((i) => i.id === detailsId) || null;

  return (
    <Page eyebrow="Create" title={<>What do you <span className="serif accent-text">have</span>?</>} sub="Describe it, pick from your inventory, or scan it.">
      {fromScan && (
        <div style={{ marginBottom: 14 }}>
          <Banner tone="ok">Your scanned items are in the inventory below and will be used first: {fromScan.join(', ')}.</Banner>
        </div>
      )}
      <section className="composer card">
        <textarea className="composer-input" value={form.freeText} onChange={(e) => set('freeText', e.target.value)} maxLength={4000} placeholder="6 pine boards 1000 × 150 × 18 mm, a box of wood screws, wood glue, a saw and a drill…" aria-label="Describe what you have" rows={3} />
        <p className="xs muted composer-hint">Name the materials you have. Amounts and sizes help, but you can add them later.</p>

        <div className="composer-inv">
          <span className="label">From inventory</span>
          {inv.loading && <span className="spinner" />}
          {!inv.loading && !items.length && <span className="small muted">Nothing saved yet.</span>}
          {items.map((i) => {
            const on = selected.includes(i.id);
            return (
              <button type="button" key={i.id} className={`chip ${on ? 'active' : ''}`} aria-pressed={on} title={dimsSummary(i.dimensions) || undefined} onClick={() => setSelectedInv((cur) => { const base = cur ?? items.map((x) => x.id); return base.includes(i.id) ? base.filter((x) => x !== i.id) : [...base, i.id]; })}>
                {on && <Check size={13} />}{i.name} <span className="muted">×{i.quantity}</span>
              </button>
            );
          })}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>Add</Button>
        </div>

        <details className="disclosure">
          <summary><Wrench size={15} />Your tools and budget <span className="muted" style={{ fontWeight: 400 }}>— optional</span><ChevronDown size={16} className="chev" /></summary>
          <div className="stack-lg" style={{ paddingBottom: 18 }}>
            <Field label="Tools you own" hint="Ideas that need a tool you don’t have are marked.">
              <Chips options={TOOL_OPTIONS} value={form.tools} onChange={(v) => set('tools', v)} allowCustom />
            </Field>
            <div style={{ maxWidth: 260 }}>
              <Field label={<span className="row" style={{ gap: 6 }}><Wallet size={13} />Spending limit</span>} hint="Only if you want to cap what you buy.">
                <NumberInput value={form.budget} min={0} onChange={(v) => set('budget', v)} suffix={currency} />
              </Field>
            </div>
          </div>
        </details>
        <details className="disclosure">
          <summary><Info size={15} />How ideas are checked and ordered<ChevronDown size={16} className="chev" /></summary>
          <ol className="list small" style={{ paddingBottom: 14 }}>
            <li>Every material an idea claims is matched to your inventory and checked against the amount you have. Ideas that use nothing you own are not shown.</li>
            <li>Ideas you can build right now come first, then ideas that need a size or amount confirmed, then ones that need a tool, then ones that need a purchase.</li>
            <li>Within each group: more of the parts from your own stock first, then the lower cost of anything missing, then easier and quicker builds.</li>
          </ol>
        </details>

        <div className="composer-foot">
          <Button icon={ScanLine} onClick={() => nav('/app/scan')}>Scan instead</Button>
          {health && !aiEnabled && <span className="xs warn-text">The AI service isn’t set up, so ideas can’t be generated yet.</span>}
          <div className="spacer" />
          <Button variant="primary" size="lg" icon={Sparkles} onClick={generate} loading={Boolean(generating)} disabled={!form.freeText.trim() && !selected.length}>Generate ideas</Button>
        </div>
      </section>

      <div style={{ marginTop: 28 }} id="results">
        {generating && <GeneratingState progress={generating.progress} startedAt={generating.startedAt} hasText={Boolean(form.freeText.trim())} onCancel={cancel} />}
        {genError && !generating && (
          <Banner tone="danger">
            <div className="row-between">
              <span>{genError.message}</span>
              {(genError.retryable || genError.code === 'network') && <Button size="sm" icon={RotateCcw} onClick={generate}>Try again</Button>}
            </div>
          </Banner>
        )}
        {result && !generating && result.status !== 'ok' && (
          <Card className="quiet">
            <Empty icon={result.status === 'unrecognized' ? HelpCircle : PackagePlus} title={result.status === 'unrecognized' ? 'We couldn’t tell what materials you have' : result.status === 'empty' ? 'Add some materials first' : 'No realistic products found'} action={<div className="row"><Button icon={ScanLine} onClick={() => nav('/app/scan')}>Scan my materials</Button><Button variant="ghost" onClick={() => document.querySelector('.composer-input')?.focus()}>Edit description</Button></div>}>
              {result.message}
            </Empty>
          </Card>
        )}
        {result && !generating && result.status === 'ok' && (
          <div className="stack-lg">
            <div className="row-between">
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 20 }}>{result.ideas.length} {result.ideas.length === 1 ? 'idea' : 'ideas'} for your materials</h2>
                {result.parsed && <p className="xs muted">Understood from your text: {[...(result.parsed.materials || []).map((m) => m.name), ...(result.parsed.tools || [])].join(', ') || '—'}{result.parsed.budget ? ` · budget ${result.parsed.budget} ${result.parsed.currency || ''}` : ''}{result.parsed.hoursPerWeek ? ` · ${result.parsed.hoursPerWeek} h/week` : ''}</p>}
                {result.dropped > 0 && <p className="xs muted">{result.dropped} suggestion{result.dropped === 1 ? '' : 's'} hidden because {result.dropped === 1 ? 'it didn’t' : 'they didn’t'} use your materials.</p>}
                {result.rejected?.length > 0 && (
                  <details className="xs muted left-out">
                    <summary>{result.rejected.length} suggestion{result.rejected.length === 1 ? '' : 's'} left out because {result.rejected.length === 1 ? 'it doesn’t' : 'they don’t'} make physical sense with these materials</summary>
                    <ul className="list">{result.rejected.map((x) => <li key={x.name}><strong>{x.name}</strong> — {x.reason}</li>)}</ul>
                  </details>
                )}
              </div>
              <Button icon={GitCompare} disabled={compare.length < 2} onClick={() => setShowCompare(true)}>Compare ({compare.length})</Button>
            </div>
            <Stagger className="idea-grid">
              {result.ideas.map((idea) => (
                <StaggerItem key={idea.id} style={{ display: 'flex' }}>
                  <IdeaCard
                    idea={idea}
                    photo={photos[result.ideas.indexOf(idea)]}
                    busy={busy}
                    selected={compare.includes(idea.id)}
                    onCompare={() => setCompare((c) => (c.includes(idea.id) ? c.filter((x) => x !== idea.id) : [...c, idea.id].slice(-3)))}
                    onDetails={() => setDetailsId(idea.id)}
                    onSave={() => createProject(idea, false)}
                    onDevelop={() => createProject(idea, true)}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        )}
      </div>

      {details && (
        <IdeaDetails
          idea={details}
          photo={photos[result.ideas.indexOf(details)]}
          busy={busy}
          researchState={researchState}
          onResearch={() => research(result.runId)}
          onClose={() => setDetailsId(null)}
          onSave={() => createProject(details, false)}
          onDevelop={() => createProject(details, true)}
        />
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add inventory item" wide>
        <InventoryItemForm
          currency={currency}
          busy={busy === 'add'}
          onCancel={() => setAdding(false)}
          onSubmit={(item) => run('add', async () => { await api.post('/inventory', item); await inv.reload(); setAdding(false); }, 'Item added')}
        />
      </Modal>

      <Modal open={showCompare} onClose={() => setShowCompare(false)} title="Compare ideas" wide>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th />{comparing.map((i) => <th key={i.id}>{i.name}</th>)}</tr>
            </thead>
            <tbody>
              {[
                ['Ready to build?', (i) => <Verdict idea={i} />],
                ['Parts from your stock', (i) => `${i.fit.ownedParts} of ${i.fit.totalParts}`],
                ['To buy', (i) => (i.nothingToBuy ? 'Nothing' : `${i.missing.map((m) => m.name).join(', ')}${i.shortageCost ? ` (~${money(i.shortageCost, i.currency)})` : ''}`)],
                ['Tools you’d need', (i) => i.toolsMissing?.join(', ') || '—'],
                ['Difficulty', (i) => DIFFICULTY[i.difficulty] || '—'],
                ['Build time (estimate)', (i) => (i.estProductionMinutes > 0 ? `~${i.estProductionMinutes} min` : '—')],
              ].map(([label, fn]) => (
                <tr key={label}><td className="muted">{label}</td>{comparing.map((i) => <td key={i.id}>{fn(i)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-foot">
          {comparing.map((i) => <Button key={i.id} variant="primary" size="sm" icon={Hammer} onClick={() => { setShowCompare(false); createProject(i, true); }}>Build {i.name.split(' ').slice(0, 2).join(' ')}</Button>)}
          <Button variant="ghost" icon={X} onClick={() => setShowCompare(false)}>Close</Button>
        </div>
      </Modal>
    </Page>
  );
}
