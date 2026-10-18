import { useState } from 'react';
import { Check, Wand2, StickyNote, Trash2, ArrowRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, Button, Stat, Badge, Banner } from '../../components/ui.jsx';
import { ProductPreview } from '../../components/ProductPreview.jsx';
import { ResearchCard } from '../../components/ResearchCard.jsx';
import { api } from '../../api/client.js';
import { PROJECT_STATUSES } from '../../../shared/constants.js';
import { money, pct, num, relTime } from '../../utils/format.js';

function nextStep(p) {
  if (!p.plan) return { label: 'Generate the build plan', tab: null };
  const open = p.purchases.filter((x) => !x.purchased).length;
  if (open) return { label: `Source and buy ${open} missing item(s)`, tab: 'sourcing' };
  const done = p.progress.completedSteps.length;
  if (done < p.plan.steps.length) return { label: `Continue building — step ${done + 1} of ${p.plan.steps.length}`, tab: 'build' };
  if (!p.strategy) return { label: 'Choose where to sell', tab: 'sell' };
  return { label: 'Record production and sales', tab: 'results' };
}

export default function OverviewTab({ project: p, setProject, patch, action, ctx, generatePlan, goTo }) {
  const [note, setNote] = useState('');
  const cur = ctx.currency;
  const econ = p.computed.economics;
  const m = p.computed.metrics;
  const statusIdx = PROJECT_STATUSES.findIndex((s) => s.id === p.status);
  const ns = nextStep(p);

  return (
    <div className="stack-lg">
      <Card>
        <div className="row" style={{ gap: 4, overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 4 }} aria-label="Project pipeline">
          {PROJECT_STATUSES.slice(0, -1).map((s, i) => (
            <button key={s.id} className="row small" onClick={() => patch({ status: s.id }, `Moved to ${s.label}`)} style={{ flexWrap: 'nowrap', gap: 6, background: 'none', border: 0, cursor: 'pointer', padding: '4px 6px', color: i === statusIdx ? 'var(--accent)' : i < statusIdx ? 'var(--text-2)' : 'var(--muted)' }} aria-current={i === statusIdx ? 'step' : undefined}>
              <span className="step-num" style={{ width: 20, height: 20, fontSize: 10, background: i < statusIdx ? 'var(--ok)' : i === statusIdx ? 'var(--accent)' : 'transparent', color: i <= statusIdx ? 'var(--accent-ink)' : undefined, borderColor: i <= statusIdx ? 'transparent' : undefined }}>
                {i < statusIdx ? <Check size={11} /> : i + 1}
              </span>
              <span className="nowrap">{s.label}</span>
              {i < PROJECT_STATUSES.length - 2 && <span className="muted">—</span>}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid g-main">
        <Card>
          <div className="row" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'nowrap' }}>
            <div className="hide-sm" style={{ width: 200, flex: 'none' }}><ProductPreview idea={p.idea || { name: p.name }} /></div>
            <div className="stack" style={{ minWidth: 0 }}>
              <p className="text-2">{p.idea?.summary || p.idea?.description}</p>
              {p.idea?.whyItFits && <p className="small"><strong>Why it fits: </strong><span className="text-2">{p.idea.whyItFits}</span></p>}
              <div className="row">
                {p.idea?.difficulty && <Badge>{p.idea.difficulty}</Badge>}
                {p.idea?.engine && <Badge tone={p.idea.engine === 'ai' ? 'info' : 'warn'}>{p.idea.engine === 'ai' ? 'AI-generated idea' : 'Demo template'}</Badge>}
                {p.plan && <Badge tone={p.plan.dimensionsValidated ? 'ok' : 'warn'}>{p.plan.dimensionsValidated ? 'Dimensions confirmed' : 'Has unconfirmed dimensions'}</Badge>}
              </div>
            </div>
          </div>
        </Card>
        <Card title="Next step" className="card-accent">
          <p className="strong" style={{ marginBottom: 12 }}>{ns.label}</p>
          {ns.tab ? (
            <Button variant="primary" icon={ArrowRight} onClick={() => goTo(ns.tab)}>Go</Button>
          ) : (
            <Button variant="primary" icon={Wand2} loading={action.busy === 'plan'} onClick={generatePlan}>Generate plan</Button>
          )}
          {p.plan && (
            <>
              <hr className="divider" />
              <Button size="sm" variant="ghost" icon={RefreshCw} loading={action.busy === 'plan'} onClick={generatePlan}>Regenerate plan from current inventory</Button>
              <p className="xs muted" style={{ marginTop: 6 }}>Regenerating resets build progress. Plan generated {relTime(p.plan.generatedAt)}.</p>
            </>
          )}
        </Card>
      </div>

      {p.plan && (
        <div className="grid g-4">
          <div className="card"><Stat label="Production cost / unit" value={money(econ.perUnit.productionCost, cur)} foot={`${money(econ.perUnit.materialCash, cur)} cash materials`} /></div>
          <div className="card"><Stat label="Net profit / unit" value={money(econ.perUnit.netProfit, cur)} tone={econ.perUnit.netProfit < 0 ? 'danger' : 'ok'} foot={`${pct(econ.perUnit.netMarginPct)} at ${money(p.economics.price, cur)}`} /></div>
          <div className="card"><Stat label="Break-even price" value={money(econ.breakEvenPrice, cur)} foot="Covers all per-unit costs & fees" /></div>
          <div className="card"><Stat label="Made / sold / on hand" value={`${num(m.produced)} / ${num(m.sold)} / ${num(m.onHand)}`} foot={m.revenue ? `${money(m.revenue, cur)} revenue recorded` : 'No sales recorded'} /></div>
        </div>
      )}

      {p.computed.allocation?.everythingOwned && (
        <Banner tone="ok">You already have everything needed for this design (batch of {p.economics.batchQty}).</Banner>
      )}
      {p.computed.allocation && !p.computed.allocation.everythingOwned && p.computed.allocation.reduceBatchTo && (
        <Banner tone="warn" icon={AlertTriangle}>
          Your stock covers <strong>{p.computed.allocation.reduceBatchTo}</strong> unit(s) with no purchases; the planned batch is {p.economics.batchQty}. See Bill of materials.
        </Banner>
      )}

      {p.plan?.research && (
        <ResearchCard
          research={p.plan.research}
          busy={action.busy === 'research'}
          onRefresh={p.isExample ? null : () => action.run('research', async () => setProject(await api.post(`/projects/${p.id}/research`)), 'Research updated')}
        />
      )}

      <Card title="Notes & revisions" sub="Decisions, changes and observations">
        <form className="row" style={{ flexWrap: 'nowrap', marginBottom: 12 }} onSubmit={async (e) => { e.preventDefault(); if (note.trim() && (await patch({ addNote: note.trim() }))) setNote(''); }}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. changed shelf depth to 200 mm)" maxLength={4000} aria-label="New note" />
          <Button type="submit" icon={StickyNote} disabled={!note.trim()}>Add</Button>
        </form>
        {p.notes.length ? (
          <ul className="list-plain stack" style={{ gap: 8 }}>
            {p.notes.map((n) => (
              <li key={n.id} className="row-between card tight" style={{ background: 'var(--bg)', flexWrap: 'nowrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                  <div className="xs muted">{relTime(n.created_at)}</div>
                </div>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => patch({ removeNoteId: n.id })} aria-label="Delete note" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No notes yet.</p>
        )}
      </Card>
    </div>
  );
}
