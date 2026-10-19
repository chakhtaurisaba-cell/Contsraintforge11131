import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BrainCircuit, Play, Eye, Database, AlertCircle, Target, Scale, FlaskConical, ThumbsUp, ThumbsDown, SlidersHorizontal, CheckCircle2, History, Sparkles, ArrowRight } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Card, Button, Badge, Banner, Empty, ErrorState, LoadingBlock, Modal, Field, NumberInput, ExampleBadge, Stagger, StaggerItem } from '../components/ui.jsx';
import { simulateBatchChange, simulatePriceChange, computeEconomics } from '../../shared/economics.js';
import { AnalysisResult } from '../components/AnalysisResult.jsx';
import { money, pct, relTime } from '../utils/format.js';

const SEV = { high: 'danger', medium: 'warn', low: 'info', opportunity: 'ok' };

function Simulator({ rec, onClose, currency }) {
  const project = useApi(`/projects/${rec.projectId}`, [rec.projectId]);
  const s = rec.simulation;
  const [p, setP] = useState(s);
  const bom = project.data?.plan?.bom;
  const econ = project.data?.economics;
  const result = useMemo(() => {
    if (!bom || !econ) return null;
    if (p.kind === 'batch') return simulateBatchChange(bom, econ, { fromQty: p.fromQty, toQty: p.toQty || 0, expectedSales: p.expectedSales || 0 });
    if (p.kind === 'price') return simulatePriceChange(bom, econ, { newPrice: p.newPrice || 0, unitsBefore: p.unitsBefore || 0, unitsAfter: p.unitsAfter || 0 });
    return null;
  }, [bom, econ, p]);
  const base = bom && econ ? computeEconomics(bom, econ) : null;

  return (
    <Modal open onClose={onClose} title="Simulate this change" wide>
      {project.loading && <LoadingBlock />}
      {result && (
        <div className="stack-lg">
          <p className="small text-2">Adjust the inputs. Results are computed with the same formulas as the Economics tab, using {rec.projectName}'s current costs.</p>
          {p.kind === 'batch' && (
            <>
              <div className="form-grid">
                <Field label="Current batch size"><NumberInput value={p.fromQty} disabled /></Field>
                <Field label="New batch size"><NumberInput value={p.toQty} min={0} step={1} onChange={(v) => setP({ ...p, toQty: v ?? 0 })} /></Field>
                <Field label="Expected sales (next period)" hint="Your assumption"><NumberInput value={p.expectedSales} min={0} step={1} onChange={(v) => setP({ ...p, expectedSales: v ?? 0 })} /></Field>
              </div>
              <input type="range" min={0} max={Math.max(p.fromQty * 2, 10)} value={p.toQty} onChange={(e) => setP({ ...p, toQty: Number(e.target.value) })} aria-label="New batch size" style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <table className="table">
                <thead><tr><th /><th className="num">Before ({p.fromQty})</th><th className="num">After ({p.toQty})</th></tr></thead>
                <tbody>
                  <tr><td>Cash needed for the batch</td><td className="num">{money(result.cashOutlayBefore, currency)}</td><td className="num strong">{money(result.cashOutlayAfter, currency)}</td></tr>
                  <tr><td>Units likely left unsold</td><td className="num">{result.unsoldBefore}</td><td className="num strong">{result.unsoldAfter}</td></tr>
                  <tr><td>Inventory exposure (production cost of unsold)</td><td className="num">{money(result.inventoryExposureBefore, currency)}</td><td className="num strong">{money(result.inventoryExposureAfter, currency)}</td></tr>
                </tbody>
              </table>
              <Banner tone={result.cashSaved >= 0 ? 'ok' : 'info'}>{result.cashSaved >= 0 ? `Frees ${money(result.cashSaved, currency)} of cash.` : `Requires ${money(-result.cashSaved, currency)} more cash.`}</Banner>
            </>
          )}
          {p.kind === 'price' && (
            <>
              <div className="form-grid">
                <Field label="Current price"><NumberInput value={econ.price} disabled suffix={currency} /></Field>
                <Field label="New price"><NumberInput value={p.newPrice} min={0} onChange={(v) => setP({ ...p, newPrice: v ?? 0 })} suffix={currency} /></Field>
                <Field label="Units / period now"><NumberInput value={p.unitsBefore} min={0} onChange={(v) => setP({ ...p, unitsBefore: v ?? 0 })} /></Field>
                <Field label="Units / period at new price" hint="Your assumption — volume often drops"><NumberInput value={p.unitsAfter} min={0} onChange={(v) => setP({ ...p, unitsAfter: v ?? 0 })} /></Field>
              </div>
              <table className="table">
                <thead><tr><th /><th className="num">Now</th><th className="num">Proposed</th></tr></thead>
                <tbody>
                  <tr><td>Net profit per unit</td><td className="num">{money(result.netPerUnitBefore, currency)}</td><td className="num strong">{money(result.netPerUnitAfter, currency)}</td></tr>
                  <tr><td>Net margin</td><td className="num">{pct(result.marginBefore)}</td><td className="num strong">{pct(result.marginAfter)}</td></tr>
                  <tr><td>Profit per period</td><td className="num">{money(result.profitBefore, currency)}</td><td className="num strong">{money(result.profitAfter, currency)}</td></tr>
                </tbody>
              </table>
              {p.unitsAfter > 0 && result.netPerUnitAfter > 0 && result.profitBefore > 0 && (
                <p className="small text-2">The new price stays ahead as long as you sell at least <strong>{Math.ceil(result.profitBefore / result.netPerUnitAfter)}</strong> units per period.</p>
              )}
            </>
          )}
          {base && <p className="xs muted">Current production cost {money(base.perUnit.productionCost, currency)}/unit · break-even price {money(base.breakEvenPrice, currency)}.</p>}
        </div>
      )}
    </Modal>
  );
}

function RecCard({ r, currency, onDecide, onSimulate }) {
  const decided = r.status !== 'proposed';
  return (
    <motion.article layout className="card" style={{ borderLeft: `3px solid var(--${SEV[r.severity] === 'ok' ? 'ok' : SEV[r.severity] === 'danger' ? 'danger' : SEV[r.severity] === 'warn' ? 'warn' : 'blueprint'})` }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={SEV[r.severity]}>{r.severity === 'opportunity' ? 'Opportunity' : `${r.severity} priority`}</Badge>
            <Link to={`/app/projects/${r.projectId}`} className="small">{r.projectName}</Link>
            {r.isExample && <ExampleBadge />}
            {decided && <Badge tone={r.status === 'rejected' ? '' : 'ok'}>{r.status}</Badge>}
          </div>
          <h3 style={{ fontSize: 17, marginTop: 6 }}>{r.title}</h3>
        </div>
        <span className="mono xs muted">impact {r.priority}</span>
      </div>

      <div className="grid g-2" style={{ marginTop: 14, gap: 16 }}>
        <div className="stack" style={{ gap: 10 }}>
          <div><div className="label row" style={{ gap: 6 }}><Eye size={13} />1 · What we observed</div><p className="small text-2">{r.observation}</p></div>
          <div>
            <div className="label row" style={{ gap: 6 }}><Database size={13} />2 · Supporting data</div>
            <dl className="kv small" style={{ marginTop: 4 }}>{r.evidence.map((e) => <Fragment key={e.label}><dt>{e.label}</dt><dd className="num">{e.value}</dd></Fragment>)}</dl>
          </div>
          <div><div className="label row" style={{ gap: 6 }}><AlertCircle size={13} />3 · Why it matters</div><p className="small text-2">{r.whyItMatters}</p></div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="card tight callout">
            <div className="label row" style={{ gap: 6 }}><Target size={13} />4 · Proposed action</div>
            <p className="small">{r.action}</p>
          </div>
          <div><div className="label row" style={{ gap: 6 }}><Scale size={13} />5 · Expected financial effect</div><p className="small text-2">{r.expectedEffect.text}</p></div>
          <div><div className="label">6 · Assumptions</div><ul className="list small">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>
          <div><div className="label">7 · Risks & trade-offs</div><ul className="list small">{r.risks.map((a) => <li key={a}>{a}</li>)}</ul></div>
          <div><div className="label row" style={{ gap: 6 }}><FlaskConical size={13} />8 · How to test it</div><p className="small text-2">{r.test}</p></div>
        </div>
      </div>

      {(r.aiExplanation || r.aiIdeas?.length > 0) && (
        <div className="card tight" style={{ marginTop: 14, background: 'var(--info-soft)', borderColor: 'transparent' }}>
          <div className="label row" style={{ gap: 6 }}><Sparkles size={13} />AI explanation</div>
          {r.aiExplanation && <p className="small">{r.aiExplanation}</p>}
          {r.aiIdeas?.length > 0 && <ul className="list small" style={{ marginTop: 6 }}>{r.aiIdeas.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}

      {decided && r.results && (
        <div className="card tight" style={{ marginTop: 14, background: 'var(--bg)' }}>
          <div className="label row" style={{ gap: 6 }}><History size={13} />Results since decision ({relTime(r.decidedAt)})</div>
          <table className="table">
            <thead><tr><th /><th className="num">Baseline (30 days before)</th><th className="num">Since decision (per 30 days)</th></tr></thead>
            <tbody>
              <tr><td>Units sold</td><td className="num">{r.baseline?.sold30 ?? '—'}</td><td className="num">{r.results.per30?.units ?? '—'}</td></tr>
              <tr><td>Profit</td><td className="num">{money(r.baseline?.profit30, currency)}</td><td className="num">{money(r.results.per30?.profit, currency)}</td></tr>
            </tbody>
          </table>
          <p className="xs muted">{r.results.since?.days < 14 ? 'Less than two weeks of data — too early to judge.' : 'Compare with the test criteria above before drawing conclusions.'}{r.decisionNote ? ` Note: ${r.decisionNote}` : ''}</p>
        </div>
      )}

      {!decided && (
        <div className="row" style={{ marginTop: 14 }}>
          {r.simulation && <Button icon={SlidersHorizontal} onClick={onSimulate}>Simulate</Button>}
          <div className="spacer" />
          <Button variant="ghost" icon={ThumbsDown} onClick={() => onDecide('reject')}>Reject</Button>
          <Button variant="primary" icon={ThumbsUp} onClick={() => onDecide('approve')}>Approve…</Button>
        </div>
      )}
    </motion.article>
  );
}

export default function Advisor() {
  const { data, setData, error, loading, reload } = useApi('/advisor');
  const { currency, toast, aiEnabled, setPageContext } = useApp();
  const { busy, run } = useAction(toast);
  const [runInfo, setRunInfo] = useState(null);
  const [sim, setSim] = useState(null);
  const [decision, setDecision] = useState(null);
  const [view, setView] = useState('open');

  useEffect(() => {
    if (data) setPageContext('advisor', { recommendations: data.recommendations.map(({ title, observation, action, expectedEffect, status, projectName }) => ({ title, projectName, observation, action, effect: expectedEffect?.text, status })) });
  }, [data, setPageContext]);

  // The result panel shows the outcome (including "no sales data yet"), so no toast is needed.
  const analyse = () => run('run', async () => { const r = await api.post('/advisor/run', {}); setData(r); setRunInfo(r); });
  const recs = (data?.recommendations || []).filter((r) => (view === 'open' ? r.status === 'proposed' : r.status !== 'proposed'));

  return (
    <Page
      eyebrow="Advisor"
      title="What to change next"
      sub="Evidence first. Simulate it. Nothing changes until you approve."
      actions={<Button variant="primary" icon={Play} loading={busy === 'run'} onClick={analyse}>Analyze my business</Button>}
    >
      {(runInfo || busy === 'run') && (
        <div style={{ marginBottom: 16 }} className="stack">
          <AnalysisResult result={runInfo} running={busy === 'run'} currency={currency} />
          {runInfo?.summary?.hasData && !aiEnabled && <Banner tone="warn">The numbers and recommendations are complete; plain-language explanations need the AI service (Google Gemini), which isn’t available right now.</Banner>}
        </div>
      )}
      <div className="row" style={{ marginBottom: 16 }}>
        <button className={`chip ${view === 'open' ? 'active' : ''}`} onClick={() => setView('open')}>Open ({(data?.recommendations || []).filter((r) => r.status === 'proposed').length})</button>
        <button className={`chip ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>Decisions & results ({(data?.recommendations || []).filter((r) => r.status !== 'proposed').length})</button>
      </div>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock rows={5} />}
      {data && !recs.length && !(view === 'open' && runInfo) && (
        <Empty icon={BrainCircuit} title={view === 'open' ? 'No open recommendations' : 'No decisions yet'} action={view === 'open' && <Button variant="primary" icon={Play} loading={busy === 'run'} onClick={analyse}>Analyze now</Button>}>
          {view === 'open' ? 'Run an analysis after recording production and sales. The advisor checks inventory build-up, margins, conversion (if traffic is recorded), supplier prices, channel performance, demand and growth signals.' : 'Approved or rejected recommendations appear here with before/after results.'}
        </Empty>
      )}
      <Stagger className="stack-lg">
        <AnimatePresence>
          {recs.map((r) => (
            <StaggerItem key={r.id}>
              <RecCard r={r} currency={currency} onSimulate={() => setSim(r)} onDecide={(d) => setDecision({ rec: r, decision: d, note: '', apply: Boolean(r.apply) })} />
            </StaggerItem>
          ))}
        </AnimatePresence>
      </Stagger>
      {view === 'open' && recs.length > 0 && <p className="xs muted" style={{ marginTop: 16 }}>Recommendations are hypotheses based on your data, not guarantees. Approve to track results; test changes one at a time.</p>}

      {sim && <Simulator rec={sim} currency={currency} onClose={() => setSim(null)} />}

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision?.decision === 'approve' ? 'Approve recommendation' : 'Reject recommendation'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
            <Button variant={decision?.decision === 'approve' ? 'primary' : 'danger'} icon={decision?.decision === 'approve' ? CheckCircle2 : ThumbsDown} loading={busy === 'dec'} onClick={() => run('dec', async () => { setData(await api.post(`/advisor/${encodeURIComponent(decision.rec.id)}/decision`, { decision: decision.decision, note: decision.note || undefined, apply: decision.apply })); setDecision(null); }, decision.decision === 'approve' ? 'Decision recorded — results will be tracked' : 'Recommendation rejected')}>
              Confirm
            </Button>
          </>
        }
      >
        {decision && (
          <div className="stack">
            <p className="strong">{decision.rec.title}</p>
            <p className="small text-2">{decision.rec.action}</p>
            {decision.decision === 'approve' && decision.rec.apply && (
              <label className="checkbox card tight" style={{ background: 'var(--bg)' }}>
                <input type="checkbox" checked={decision.apply} onChange={(e) => setDecision({ ...decision, apply: e.target.checked })} />
                <span className="small">Also apply in ConstraintForge: <strong>{decision.rec.apply.label}</strong>. <span className="muted">(Only changes your plan inside this app — nothing external is changed or purchased.)</span></span>
              </label>
            )}
            <Field label="Note (optional)"><textarea className="textarea" style={{ minHeight: 70 }} maxLength={1000} value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} placeholder="Why, and what you'll measure" /></Field>
            <p className="xs muted">A snapshot of current metrics is saved as the baseline so results can be compared later.</p>
          </div>
        )}
      </Modal>
      {view === 'history' && <Link to="/app/analytics" className="btn btn-ghost btn-sm" style={{ marginTop: 16 }}>Open analytics <ArrowRight size={14} /></Link>}
    </Page>
  );
}
