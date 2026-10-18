import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Boxes, Lightbulb, Ruler, ListChecks, Megaphone } from 'lucide-react';
import { AssemblyView, CutListDiagram, ProductVisual } from '../../components/Diagrams.jsx';
import { Reveal, EASE } from './motion.jsx';

// Sample data shaped exactly like the workspace's real plan output.
const L = 240, W = 120, H = 100, T = 15;
const c = (x, y, z, sx, sy, sz) => ({ x, y, z, sx, sy, sz });
const COMPONENTS = [
  { id: 'base', name: 'Base', instances: [c(0, 0, 0, L, W, T)] },
  { id: 'long_wall', name: 'Front / back wall', instances: [c(0, 0, T, L, T, H - T), c(0, W - T, T, L, T, H - T)] },
  { id: 'end_wall', name: 'End wall', instances: [c(0, T, T, T, W - 2 * T, H - T), c(L - T, T, T, T, W - 2 * T, H - T)] },
  { id: 'divider', name: 'Divider', instances: [c(96, T, T, T, W - 2 * T, 60)] },
];
const CUTS = { layout: [{ board: 1, cuts: [
  { name: 'Base', length: 240, width: 120, offset: 10 }, { name: 'Front wall', length: 240, width: 85, offset: 253 }, { name: 'Back wall', length: 240, width: 85, offset: 496 },
  { name: 'End', length: 90, width: 85, offset: 739 }, { name: 'End', length: 90, width: 85, offset: 832 }, { name: 'Divider', length: 90, width: 60, offset: 925 },
] }] };

const TABS = [
  { id: 'inv', label: 'Inventory', icon: Boxes },
  { id: 'idea', label: 'Concept', icon: Lightbulb },
  { id: 'plan', label: 'Plan', icon: Ruler },
  { id: 'bom', label: 'Materials', icon: ListChecks },
  { id: 'sell', label: 'Sell', icon: Megaphone },
];

function Inv() {
  const rows = [['Pine boards', '× 4', '1200 × 150 × 18 mm', 'Confirmed', 'ok'], ['Wood screws', '× 60', '3 × 30 mm', 'From photo', 'warn'], ['Steel L-brackets', '× 6', '≈ 100 mm ±25%', 'AI estimate', 'warn']];
  return (
    <div className="pv-list">
      {rows.map((r, i) => (
        <motion.div key={r[0]} className="pv-row" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}>
          <span className="strong">{r[0]} <span className="muted">{r[1]}</span></span>
          <span className="mono small muted">{r[2]}</span>
          <span className={`badge badge-${r[4]}`}>{r[3]}</span>
        </motion.div>
      ))}
    </div>
  );
}

function Idea() {
  const scores = [['Resource fit', 100], ['Feasibility', 88], ['Economics', 70], ['Ease of testing', 85]];
  return (
    <div className="pv-idea">
      <div className="idea-visual" style={{ height: 170 }}><ProductVisual shape="organizer" size={150} /></div>
      <div className="stack" style={{ gap: 10 }}>
        <div><div className="pv-k mono">#1 · fit 84</div><div className="pv-title">Desk organiser</div></div>
        {scores.map(([l, v], i) => (
          <div key={l} className="scorebar">
            <span>{l}</span>
            <div className="track"><motion.span initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.7, delay: 0.1 * i }} style={{ background: 'var(--accent)' }} /></div>
            <span className="num right">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Plan() {
  const [hl, setHl] = useState('long_wall');
  useEffect(() => {
    const ids = COMPONENTS.map((x) => x.id);
    const t = setInterval(() => setHl((h) => ids[(ids.indexOf(h) + 1) % ids.length]), 1300);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pv-plan">
      <div className="blueprint" style={{ padding: 8 }}><AssemblyView components={COMPONENTS} highlight={[hl]} height={190} showLabels={false} /></div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="pv-k mono">Step 4 / 6 — {COMPONENTS.find((x) => x.id === hl).name}</div>
        <div className="blueprint" style={{ padding: 8 }}><CutListDiagram cutList={CUTS} stockLength={1200} /></div>
        <div className="mono xs muted">3 mm kerf · 81% of one board</div>
      </div>
    </div>
  );
}

function Bom() {
  const rows = [['Pine board', '0.83 board', 'owned'], ['PVA wood glue', '0.05 bottle', 'buy'], ['Brad nails 30 mm', '10 pcs', 'buy'], ['Felt pads', '4 pcs', 'buy']];
  return (
    <div className="pv-list">
      {rows.map((r, i) => (
        <motion.div key={r[0]} className="pv-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
          <span className="strong">{r[0]}</span>
          <span className="mono small muted">{r[1]}</span>
          <span className={`badge ${r[2] === 'owned' ? 'badge-ok' : 'badge-accent'}`}>{r[2] === 'owned' ? 'You have it' : 'To buy'}</span>
        </motion.div>
      ))}
      <div className="pv-total"><span className="muted">To buy for 10 units</span><span className="mono strong">≈ 26.40</span></div>
    </div>
  );
}

function Sell() {
  const rows = [['Craft market', 86], ['Instagram + DMs', 78], ['Local gift shops', 64], ['Handmade marketplace', 58]];
  return (
    <div className="pv-list">
      {rows.map(([n, v], i) => (
        <div key={n} className="pv-bar-row">
          <span className="small">{n}</span>
          <div className="pv-bar"><motion.span initial={{ scaleX: 0 }} animate={{ scaleX: v / 100 }} transition={{ duration: 0.8, delay: i * 0.1, ease: EASE }} /></div>
          <span className="mono small">{v}</span>
        </div>
      ))}
    </div>
  );
}

const PANES = { inv: Inv, idea: Idea, plan: Plan, bom: Bom, sell: Sell };

export function Preview() {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState('inv');
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || reduce) return undefined;
    const t = setTimeout(() => setTab((x) => TABS[(TABS.findIndex((y) => y.id === x) + 1) % TABS.length].id), 4200);
    return () => clearTimeout(t);
  }, [tab, auto, reduce]);
  const Pane = PANES[tab];
  return (
    <section id="features" className="h-section">
      <div className="h-wrap h-split">
        <Reveal className="h-head h-head-side">
          <span className="h-kicker">Inside the workspace</span>
          <h2 className="h-h2">One project. <span className="serif accent-text">Everything</span> it takes.</h2>
          <p className="h-lede">Inventory, concept, plan, materials and sales strategy stay connected — change one, the numbers follow.</p>
        </Reveal>
        <Reveal delay={0.1} className="pv-window">
          <div className="pv-chrome">
            <span /><span /><span />
            <div className="pv-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`pv-tab ${tab === t.id ? 'on' : ''}`} onClick={() => { setTab(t.id); setAuto(false); }}>
                  {tab === t.id && <motion.span layoutId="pv-pill" className="pv-pill" />}
                  <t.icon size={14} /> <span className="pv-tab-label">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pv-body">
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}>
                <Pane />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="pv-foot mono">Preview · sample data</div>
        </Reveal>
      </div>
    </section>
  );
}
