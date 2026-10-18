import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion, animate } from 'framer-motion';
import { AlertTriangle, TrendingDown, FlaskConical } from 'lucide-react';
import { simulateBatchChange } from '../../../shared/economics.js';
import { Reveal, EASE } from './motion.jsx';

// Example business (simulated) — computed with the same engine the advisor uses.
const BOM = [
  { name: 'Board', quantity: 0.8, unitPrice: 12, owned: false },
  { name: 'Hardware', quantity: 1, unitPrice: 3.5, owned: false },
];
const ECON = { price: 49, packagingPerUnit: 2.5 };
const EXPECTED = 20;

function Num({ value, prefix = '' }) {
  const ref = useRef(null);
  const prev = useRef(value);
  useEffect(() => {
    const ctrl = animate(prev.current, value, { duration: 0.6, ease: EASE, onUpdate: (v) => { if (ref.current) ref.current.textContent = `${prefix}${Math.round(v).toLocaleString()}`; } });
    prev.current = value;
    return () => ctrl.stop();
  }, [value, prefix]);
  return <span ref={ref}>{prefix}{Math.round(value).toLocaleString()}</span>;
}

export function Intelligence() {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-20% 0px' });
  const [batch, setBatch] = useState(100);
  const [touched, setTouched] = useState(false);
  // Self-demonstrate once: the advisor's suggestion slides the batch from 100 to 20.
  useEffect(() => {
    if (!inView || touched || reduce) return undefined;
    let ctrl;
    const t = setTimeout(() => {
      ctrl = animate(100, 20, { duration: 1.6, ease: EASE, onUpdate: (v) => setBatch(Math.round(v)) });
    }, 900);
    return () => { clearTimeout(t); ctrl?.stop(); };
  }, [inView, touched, reduce]);
  const sim = useMemo(() => simulateBatchChange(BOM, ECON, { fromQty: 100, toQty: batch, expectedSales: EXPECTED }), [batch]);
  const max = sim.cashOutlayBefore;

  return (
    <section className="h-section h-intel" ref={ref}>
      <div className="h-wrap h-split h-split-rev">
        <Reveal className="h-head h-head-side">
          <span className="h-kicker">Business intelligence</span>
          <h2 className="h-h2">It reads your sales <span className="serif accent-text">before</span> you overspend.</h2>
          <p className="h-lede">The advisor spots the problem, shows the evidence, and lets you simulate the fix before you approve it.</p>
        </Reveal>

        <Reveal delay={0.1} className="ai-card">
          <div className="ai-alert">
            <span className="ai-icon"><AlertTriangle size={16} /></span>
            <div>
              <div className="strong">Production is ahead of demand</div>
              <div className="ai-evidence">
                <span>Made <b>100</b></span><span>Sold <b>18</b> / 30 days</span><span>On hand <b>82</b></span>
              </div>
            </div>
          </div>
          <div className="ai-rec">
            <TrendingDown size={15} /> Test a smaller next batch.
          </div>

          <div className="ai-sim">
            <div className="row-between">
              <label htmlFor="batch" className="label">Next batch</label>
              <span className="mono strong">{batch} units</span>
            </div>
            <input id="batch" type="range" min="5" max="100" value={batch} onChange={(e) => { setTouched(true); setBatch(Number(e.target.value)); }} className="ai-range" style={{ '--p': `${((batch - 5) / 95) * 100}%` }} />
            <div className="ai-bars">
              {[
                ['Cash needed', sim.cashOutlayAfter, sim.cashOutlayBefore],
                ['Unsold exposure', sim.inventoryExposureAfter, sim.inventoryExposureBefore],
              ].map(([label, now, before]) => (
                <div key={label} className="ai-bar-row">
                  <span className="small text-2">{label}</span>
                  <div className="ai-bar">
                    <span className="ai-bar-ghost" style={{ width: `${(before / max) * 100}%` }} />
                    <motion.span className="ai-bar-fill" animate={{ width: `${(now / max) * 100}%` }} transition={{ type: 'spring', stiffness: 160, damping: 24 }} />
                  </div>
                  <span className="mono strong ai-val"><Num value={now} /></span>
                </div>
              ))}
            </div>
            <div className="ai-saved">
              Frees <b className="accent-text"><Num value={Math.max(0, sim.cashSaved)} /></b> of cash vs. a 100-unit batch
            </div>
          </div>
          <div className="ai-foot mono"><FlaskConical size={12} /> Simulated example · expected sales {EXPECTED}/month</div>
        </Reveal>
      </div>
    </section>
  );
}
