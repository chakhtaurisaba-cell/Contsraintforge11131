// Hero centrepiece: raw materials float in, get scanned and labelled, then fly
// together into a dimensioned product (the same parametric organiser the demo
// engine generates). Four phases loop; the phase buttons let visitors scrub.
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, useTransform } from 'framer-motion';
import { useTilt, EASE } from './motion.jsx';

const S = 0.92;
const C = Math.cos(Math.PI / 6);
const OX = 330;
const OY = 250;
const P = (x, y, z) => [OX + (x - y) * C * S, OY + ((x + y) * 0.5 - z) * S];
const pts = (arr) => arr.map((p) => P(...p).map((v) => v.toFixed(1)).join(',')).join(' ');

const L = 240, W = 120, H = 100, T = 15;
// Painted back-to-front.
const PARTS = [
  { id: 'base', box: [0, 0, 0, L, W, T], raw: [-185, -150, -16], label: 'Pine board · 18 mm', conf: 96 },
  { id: 'backLong', box: [0, 0, T, L, T, H - T], raw: [175, -175, 11], label: 'Pine board', conf: 94 },
  { id: 'backEnd', box: [0, T, T, T, W - 2 * T, H - T], raw: [-240, 40, 24] },
  { id: 'divider', box: [96, T, T, T, W - 2 * T, 62], raw: [30, -215, -30], label: 'Offcut', conf: 81 },
  { id: 'frontEnd', box: [L - T, T, T, T, W - 2 * T, H - T], raw: [235, 60, -18] },
  { id: 'frontLong', box: [0, W - T, T, L, T, H - T], raw: [-30, 170, 7] },
];
const SCREWS = [
  [T / 2, W - T / 2, H], [L - T / 2, W - T / 2, H], [L - T / 2, T / 2, H], [T / 2, T / 2, H], [96 + T / 2, W / 2, 62 + T],
].map((p, i) => ({ to: P(...p), from: [[95, 90], [520, 120], [560, 360], [80, 380], [440, 470]][i] }));

function faces([x, y, z, sx, sy, sz]) {
  const x2 = x + sx, y2 = y + sy, z2 = z + sz;
  return {
    top: pts([[x, y, z2], [x2, y, z2], [x2, y2, z2], [x, y2, z2]]),
    right: pts([[x2, y, z], [x2, y2, z], [x2, y2, z2], [x2, y, z2]]),
    front: pts([[x, y2, z], [x2, y2, z], [x2, y2, z2], [x, y2, z2]]),
    bbox: (() => {
      const all = [[x, y, z], [x2, y2, z2], [x2, y, z], [x, y2, z], [x, y, z2], [x2, y, z2], [x, y2, z2], [x2, y2, z]].map((p) => P(...p));
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    })(),
  };
}

export const PHASES = [
  { id: 'raw', label: 'Materials', ms: 2600 },
  { id: 'scan', label: 'Scan', ms: 2600 },
  { id: 'build', label: 'Assemble', ms: 2000 },
  { id: 'product', label: 'Product', ms: 3800 },
];
const RAW_SCALE = 0.7;

function Dim({ a, b, label, show, delay = 0, side = 'below' }) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <motion.g initial={false} animate={{ opacity: show ? 1 : 0 }} transition={{ duration: 0.3, delay: show ? delay : 0 }}>
      <motion.line x1={x1} y1={y1} x2={x2} y2={y2} className="hf-dim" initial={false} animate={{ pathLength: show ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE, delay: show ? delay : 0 }} />
      <circle cx={x1} cy={y1} r="2.6" className="hf-dim-end" />
      <circle cx={x2} cy={y2} r="2.6" className="hf-dim-end" />
      <g transform={`translate(${mx} ${my + (side === 'below' ? 16 : 0)})`}>
        <rect x={-34} y={-10} width={68} height={19} rx={9.5} className="hf-tag" />
        <text textAnchor="middle" y={4} className="hf-tag-text">{label}</text>
      </g>
    </motion.g>
  );
}

export function HeroForge() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(reduce ? 3 : 0);
  const [paused, setPaused] = useState(false);
  const { rx, ry, px, py, handlers } = useTilt(7);
  const nearX = useTransform(px, (v) => v * 22);
  const nearY = useTransform(py, (v) => v * 16);
  const farX = useTransform(px, (v) => v * -10);
  const farY = useTransform(py, (v) => v * -8);
  const geo = useMemo(() => PARTS.map((p) => ({ ...p, f: faces(p.box) })), []);

  useEffect(() => {
    if (reduce || paused) return undefined;
    const t = setTimeout(() => setPhase((p) => (p + 1) % PHASES.length), PHASES[phase].ms);
    return () => clearTimeout(t);
  }, [phase, paused, reduce]);
  useEffect(() => {
    if (!paused) return undefined;
    const t = setTimeout(() => setPaused(false), 9000);
    return () => clearTimeout(t);
  }, [paused, phase]);

  const id = PHASES[phase].id;
  const assembled = id === 'build' || id === 'product';
  const scanning = id === 'scan';
  const product = id === 'product';

  return (
    <div className="hf" {...handlers}>
      <motion.div className="hf-stage" style={{ rotateX: rx, rotateY: ry }}>
        <svg viewBox="0 0 660 540" className="hf-svg" role="img" aria-label="Animation: raw materials are scanned and assembled into a dimensioned desk organiser">
          {/* far layer: orbit rings + measured grid */}
          <motion.g style={{ x: farX, y: farY }}>
            <circle cx={OX} cy={OY + 20} r="230" className="hf-ring" />
            <circle cx={OX} cy={OY + 20} r="168" className="hf-ring hf-ring-dash" />
            {Array.from({ length: 25 }, (_, i) => (
              <line key={i} x1={OX - 230 + i * 19.2} y1={OY + 262} x2={OX - 230 + i * 19.2} y2={OY + 262 + (i % 5 === 0 ? 12 : 6)} className="hf-tick" />
            ))}
          </motion.g>

          <motion.g style={{ x: nearX, y: nearY }}>
            <motion.g animate={assembled || reduce ? { y: 0 } : { y: [0, -9, 0] }} transition={assembled || reduce ? { duration: 0.4 } : { repeat: Infinity, duration: 4.2, ease: 'easeInOut' }}>
              {/* extra materials that are not part of this product */}
              <motion.g initial={false} animate={{ opacity: assembled ? 0 : 1, x: assembled ? -40 : 0, y: assembled ? 20 : 0 }} transition={{ duration: 0.6 }}>
                <g transform="translate(70 230)">
                  <rect x="0" y="0" width="44" height="58" rx="9" className="hf-jar" />
                  <rect x="8" y="-8" width="28" height="10" rx="3" className="hf-jar" />
                </g>
                <g transform="translate(560 250)">
                  {[22, 16, 10, 4].map((r) => <ellipse key={r} rx={r} ry={r * 0.5} className="hf-rope" />)}
                </g>
              </motion.g>

              {geo.map((p, i) => (
                <motion.g
                  key={p.id}
                  initial={false}
                  animate={assembled ? { x: 0, y: 0, rotate: 0, scale: 1 } : { x: p.raw[0], y: p.raw[1], rotate: p.raw[2], scale: RAW_SCALE }}
                  transition={{ type: 'spring', stiffness: 70, damping: 15, delay: assembled ? i * 0.12 : (PARTS.length - i) * 0.04 }}
                >
                  <polygon points={p.f.front} className="hf-face hf-front" />
                  <polygon points={p.f.right} className="hf-face hf-right" />
                  <polygon points={p.f.top} className="hf-face hf-top" />
                </motion.g>
              ))}

              {/* screws fly to the joints */}
              {SCREWS.map((s, i) => (
                <motion.g key={i} initial={false} animate={assembled ? { x: s.to[0], y: s.to[1], rotate: 0, scale: 1 } : { x: s.from[0], y: s.from[1], rotate: 40 + i * 30, scale: 1.4 }} transition={{ type: 'spring', stiffness: 90, damping: 14, delay: assembled ? 0.75 + i * 0.07 : 0 }}>
                  {assembled ? <circle r="3.2" className="hf-joint" /> : (<><line x1="0" y1="-9" x2="0" y2="7" className="hf-screw" /><line x1="-4.5" y1="-9" x2="4.5" y2="-9" className="hf-screw" /></>)}
                </motion.g>
              ))}
            </motion.g>

            {/* scanning overlay: sweep + detection boxes */}
            <AnimatePresence>
              {scanning && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.rect x="0" width="660" height="3" className="hf-sweep" initial={{ y: 30 }} animate={{ y: 500 }} transition={{ duration: 2.2, ease: 'easeInOut' }} />
                  {geo.filter((p) => p.label).map((p, i) => {
                    const cx = p.f.bbox.x + p.f.bbox.w / 2 + p.raw[0];
                    const cy = p.f.bbox.y + p.f.bbox.h / 2 + p.raw[1];
                    const w = p.f.bbox.w * RAW_SCALE + 16;
                    const h = p.f.bbox.h * RAW_SCALE + 16;
                    return (
                      <motion.g key={p.id} initial={{ opacity: 0, scale: 1.15 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.35 + i * 0.35, duration: 0.35 }}>
                        <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx="6" className="hf-detect" />
                        <text x={cx - w / 2 + 2} y={cy - h / 2 - 7} className="hf-detect-text">{p.label} · {p.conf}%</text>
                      </motion.g>
                    );
                  })}
                  {[{ x: 58, y: 212, w: 70, h: 88, t: 'Glass jar · 92%' }, { x: 528, y: 228, w: 66, h: 46, t: 'Cotton rope · 77%' }, { x: 64, y: 70, w: 520, h: 410, t: '', hidden: true }].filter((b) => !b.hidden).map((b, i) => (
                    <motion.g key={b.t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 + i * 0.3 }}>
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="6" className="hf-detect hf-detect-muted" />
                      <text x={b.x} y={b.y - 7} className="hf-detect-text hf-muted">{b.t}</text>
                    </motion.g>
                  ))}
                </motion.g>
              )}
            </AnimatePresence>

            {/* dimensions + concept annotation */}
            <Dim a={P(0, W + 34, 0)} b={P(L, W + 34, 0)} label="240 mm" show={product} delay={0.1} />
            <Dim a={P(L + 34, 0, 0)} b={P(L + 34, W, 0)} label="120 mm" show={product} delay={0.3} />
            <Dim a={P(L, W + 4, 0).map((v, k) => (k === 0 ? v + 26 : v))} b={P(L, W + 4, H).map((v, k) => (k === 0 ? v + 26 : v))} label="100 mm" show={product} delay={0.5} side="mid" />
            <AnimatePresence>
              {product && (
                <motion.g initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.6, duration: 0.5 }}>
                  <line x1={P(L / 2, W / 2, H)[0]} y1={P(L / 2, W / 2, H)[1] - 6} x2="470" y2="96" className="hf-leader" />
                  <circle cx="470" cy="96" r="3" className="hf-dim-end" />
                  <text x="482" y="88" className="hf-concept-k">CONCEPT</text>
                  <text x="482" y="108" className="hf-concept-v">Desk organiser</text>
                  <text x="482" y="126" className="hf-concept-s">6 parts · 1 board · ~75 min</text>
                </motion.g>
              )}
            </AnimatePresence>
          </motion.g>
        </svg>
      </motion.div>

      <div className="hf-phases" role="tablist" aria-label="Animation phase">
        {PHASES.map((p, i) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={i === phase}
            className={`hf-phase ${i === phase ? 'on' : ''} ${i < phase ? 'past' : ''}`}
            onClick={() => { setPhase(i); setPaused(true); }}
          >
            <span className="mono">0{i + 1}</span> {p.label}
            <span className="hf-phase-bar">
              {i === phase && !paused && !reduce && <motion.span key={`${phase}-${i}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: p.ms / 1000, ease: 'linear' }} />}
              {(i < phase || (i === phase && (paused || reduce))) && <span style={{ transform: 'none' }} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
