import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, BookOpen, ChevronLeft, ChevronRight, Check, Wrench, Ruler, Compass, Link2, ScanEye, AlertTriangle, MessageCircleQuestion, ShieldAlert, ClipboardCheck, Package } from 'lucide-react';
import { Card, Button, Badge, Progress, Banner } from '../../components/ui.jsx';
import { AssemblyView } from '../../components/Diagrams.jsx';

export const askAssistant = (text) => window.dispatchEvent(new CustomEvent('cf-ask', { detail: text }));

function Section({ icon: Icon, title, children }) {
  if (!children || (Array.isArray(children) && !children.length)) return null;
  return (
    <div>
      <div className="label row" style={{ gap: 6, marginBottom: 4 }}><Icon size={14} className="accent-text" />{title}</div>
      <div className="small text-2">{children}</div>
    </div>
  );
}

export default function BuildTab({ project: p, patch }) {
  const plan = p.plan;
  const steps = plan.steps;
  const progress = p.progress || { completedSteps: [], stepNotes: {} };
  const done = new Set(progress.completedSteps);
  const initialIdx = Math.max(0, steps.findIndex((s) => s.id === progress.currentStep));
  const [idx, setIdx] = useState(initialIdx === -1 ? 0 : initialIdx);
  const [dir, setDir] = useState(1);
  const step = steps[idx];
  const [note, setNote] = useState(progress.stepNotes?.[step.id] || '');
  useEffect(() => { setNote(progress.stepNotes?.[step.id] || ''); }, [step.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next) => patch({ progress: { ...progress, ...next } });
  const go = (i) => {
    setDir(i > idx ? 1 : -1);
    setIdx(i);
    save({ currentStep: steps[i].id });
  };
  const toggle = (id) => {
    const set = new Set(done);
    set.has(id) ? set.delete(id) : set.add(id);
    save({ completedSteps: [...set], currentStep: step.id });
  };
  const completeAndNext = () => {
    const set = new Set(done);
    set.add(step.id);
    const next = Math.min(idx + 1, steps.length - 1);
    setDir(1);
    setIdx(next);
    save({ completedSteps: [...set], currentStep: steps[next].id });
  };
  const pctDone = Math.round((done.size / steps.length) * 100);
  const nextTools = steps[idx + 1]?.tools || [];
  const inspection = new Set(progress.inspection || []);
  const compName = (id) => plan.components.find((c) => c.id === id)?.name || id;
  const [view, setView] = useState('step');
  const hasGeometry = plan.components.some((c) => c.instances?.length);
  // Sequential assembly: every part used up to and including this step.
  const placed = useMemo(() => [...new Set(steps.slice(0, idx + 1).flatMap((s) => s.components || []))], [steps, idx]);
  const owned = (step.components || []).map((id) => plan.components.find((c) => c.id === id)).filter((c) => c?.fromInventory);
  const sources = (step.sourceRefs || []).map((i) => plan.research?.sources?.[i]).filter(Boolean);

  return (
    <div className="grid g-side" style={{ alignItems: 'start' }}>
      <div className="stack sticky-side">
        <Card className="tight">
          <div className="row-between small" style={{ marginBottom: 8 }}>
            <span className="strong">Progress</span>
            <span className="num">{done.size}/{steps.length} · {pctDone}%</span>
          </div>
          <Progress value={pctDone} />
          <nav className="step-nav" style={{ marginTop: 12 }} aria-label="Build steps">
            {steps.map((s, i) => (
              <button key={s.id} className={`step-link ${i === idx ? 'current' : ''} ${done.has(s.id) ? 'done' : ''}`} onClick={() => go(i)} aria-current={i === idx ? 'step' : undefined}>
                <span className="step-num">{done.has(s.id) ? <Check size={13} /> : s.n}</span>
                <span className="small" style={{ minWidth: 0 }}>{s.title}</span>
              </button>
            ))}
          </nav>
        </Card>
        <Card className="tight" title="Safety" sub="Read before you start">
          <ul className="list small">{plan.safety.map((s) => <li key={s}>{s}</li>)}</ul>
        </Card>
      </div>

      <div className="stack-lg" style={{ minWidth: 0 }}>
        {plan.sizeIssues?.length > 0 && (
          <Banner tone="warn" icon={Ruler}>
            <strong>Check these sizes before cutting — the plan doesn’t fit your stock:</strong>
            <ul className="list" style={{ marginTop: 4 }}>{plan.sizeIssues.map((n) => <li key={n}>{n}</li>)}</ul>
          </Banner>
        )}
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step.id} custom={dir} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.2 }}>
            <Card>
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="eyebrow">Step {step.n} of {steps.length}</div>
                  <h2 style={{ fontSize: 21 }}>{step.title}</h2>
                  <p className="text-2" style={{ marginTop: 4 }}>{step.objective}</p>
                </div>
                <label className="checkbox"><input type="checkbox" checked={done.has(step.id)} onChange={() => toggle(step.id)} />Completed</label>
              </div>

              <div className="grid g-2" style={{ marginTop: 16 }}>
                <div className="stack">
                  <div className="row" style={{ gap: 6 }}>
                    {step.components.map((c) => <Badge key={c} tone="accent" icon={Package}>{compName(c)}</Badge>)}
                    {step.tools.map((t) => <Badge key={t} icon={Wrench}>{t}</Badge>)}
                  </div>
                  {step.measurements.length > 0 && (
                    <div className="card tight" style={{ background: 'var(--bg)' }}>
                      <div className="label row" style={{ gap: 6, marginBottom: 6 }}><Ruler size={14} className="accent-text" />Measurements for this step</div>
                      <ul className="list-plain stack mono small" style={{ gap: 4 }}>{step.measurements.map((m) => <li key={m}>▸ {m}</li>)}</ul>
                    </div>
                  )}
                  <p style={{ lineHeight: 1.65 }}>{step.instructions}</p>
                  {owned.length > 0 && (
                    <div className="small"><span className="label">Uses your: </span>{owned.map((c) => <span key={c.id} className="text-2">{c.name} ← <strong>{c.fromInventory}</strong>{c.cutLength ? <span className="mono muted"> ({[c.cutLength, c.cutWidth, c.thickness].filter(Boolean).join(' × ')} mm)</span> : null}; </span>)}</div>
                  )}
                </div>
                {hasGeometry && (
                  <div className="stack" style={{ gap: 6, alignSelf: 'start' }}>
                    <div className="row" style={{ gap: 4 }} role="tablist" aria-label="Diagram view">
                      {[['step', 'This step'], ['exploded', 'Exploded'], ['final', 'Finished']].map(([k, l]) => (
                        <button key={k} type="button" className={`chip ${view === k ? 'active' : ''}`} style={{ height: 26, fontSize: 12 }} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
                      ))}
                    </div>
                    <div className="blueprint" style={{ padding: 10 }}>
                      <AssemblyView components={plan.components} highlight={view === 'final' ? [] : step.components} visible={view === 'step' ? placed : null} explode={view === 'exploded' ? 0.6 : 0} height={240} showLabels={false} />
                    </div>
                    <span className="xs muted">{view === 'step' ? 'Parts placed so far — this step highlighted.' : view === 'exploded' ? 'Parts pulled apart to show how they fit.' : 'The finished product.'} Drawn from the plan’s sizes; not an exact drawing.</span>
                  </div>
                )}
              </div>

              <div className="grid g-2" style={{ marginTop: 16, gap: 14 }}>
                <Section icon={Compass} title="Orientation">{step.orientation}</Section>
                <Section icon={Link2} title="Where parts connect">{step.connections}</Section>
                <Section icon={CheckCircle2} title="When it’s done">{step.expectedResult}</Section>
                <Section icon={ScanEye} title="Check before continuing">{step.alignmentCheck}</Section>
              </div>
              {/* Secondary detail, one click away. */}
              {step.commonMistakes.length > 0 && (
                <details className="disclosure" style={{ marginTop: 12 }}>
                  <summary className="small" style={{ padding: '8px 0' }}><AlertTriangle size={14} className="warn-text" />Common mistakes ({step.commonMistakes.length})</summary>
                  <ul className="list small" style={{ paddingBottom: 8 }}>{step.commonMistakes.map((m) => <li key={m}>{m}</li>)}</ul>
                </details>
              )}

              {sources.length > 0 && (
                <div className="small" style={{ marginTop: 12 }}>
                  <span className="label row" style={{ gap: 6, display: 'inline-flex' }}><BookOpen size={13} />Based on:</span>{' '}
                  {sources.map((src) => <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 10 }}>{src.title} <ExternalLink size={11} /></a>)}
                </div>
              )}
              <details className="disclosure" open={Boolean(note)}>
                <summary className="small" style={{ padding: '8px 0' }}>Your notes for this step{note ? ' (saved)' : ''}</summary>
                <textarea id="step-note" aria-label="Your notes for this step" className="textarea" style={{ minHeight: 64, marginBottom: 8 }} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (progress.stepNotes?.[step.id] || '') && save({ stepNotes: { ...(progress.stepNotes || {}), [step.id]: note } })} placeholder="Record changes, measurements taken, or issues…" />
              </details>
              <div className="row" style={{ marginTop: 14 }}>
                <Button icon={ChevronLeft} disabled={idx === 0} onClick={() => go(idx - 1)}>Previous</Button>
                <Button variant="ghost" icon={MessageCircleQuestion} onClick={() => askAssistant(`Explain step ${step.n} ("${step.title}") of my ${p.name} build in more detail. What exactly should I do and check?`)}>Ask about this step</Button>
                <div className="spacer" />
                {nextTools.length > 0 && <span className="xs muted hide-sm">Next step needs: {nextTools.join(', ')}</span>}
                {idx < steps.length - 1 ? (
                  <Button variant="primary" onClick={completeAndNext}>Complete & next <ChevronRight size={16} /></Button>
                ) : (
                  <Button variant="primary" icon={Check} onClick={() => toggle(step.id)} disabled={done.has(step.id)}>Mark final step complete</Button>
                )}
              </div>
            </Card>
          </motion.div>
        </AnimatePresence>

        <Card title="Final inspection" sub="Check every item before selling a unit" actions={<ClipboardCheck size={18} className="muted" />}>
          <ul className="list-plain stack" style={{ gap: 6 }}>
            {plan.finalInspection.map((item, i) => (
              <li key={item}>
                <label className="checkbox">
                  <input type="checkbox" checked={inspection.has(i)} onChange={() => { const s = new Set(inspection); s.has(i) ? s.delete(i) : s.add(i); save({ inspection: [...s] }); }} />
                  <span className="small">{item}</span>
                </label>
              </li>
            ))}
          </ul>
          {plan.riskFlags?.some((f) => f.level === 'high') && <div style={{ marginTop: 12 }}><Banner tone="danger" icon={ShieldAlert}>This product has high-risk aspects. Have the design and finished units verified by a qualified person before selling.</Banner></div>}
          {pctDone === 100 && inspection.size === plan.finalInspection.length && <div style={{ marginTop: 12 }}><Banner tone="ok">Build and inspection complete. Record the units you made under Production & sales.</Banner></div>}
        </Card>
      </div>
    </div>
  );
}
