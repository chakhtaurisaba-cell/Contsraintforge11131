import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Gauge, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProductVisual } from '../../components/Diagrams.jsx';
import { Reveal, EASE } from './motion.jsx';

// Mirrors the demo engine's template library, so what the visitor sees here is
// exactly what the workspace can generate for that material.
const MATERIALS = [
  { id: 'wood', name: 'Wooden boards', note: 'pine · 18 mm', glyph: 'plank', ideas: [
    { name: 'Wall shelf', shape: 'shelf', time: '75 min', level: 'Beginner' },
    { name: 'Desk organiser', shape: 'organizer', time: '90 min', level: 'Beginner' },
    { name: 'Balcony planter', shape: 'planter', time: '100 min', level: 'Beginner' },
  ] },
  { id: 'jar', name: 'Glass jars', note: 'heat-resistant', glyph: 'jar', ideas: [
    { name: 'Container candles', shape: 'jar', time: '30 min', level: 'Intermediate' },
  ] },
  { id: 'rope', name: 'Cotton rope', note: '6 mm', glyph: 'rope', ideas: [
    { name: 'Coaster set', shape: 'coaster', time: '60 min', level: 'Beginner' },
  ] },
  { id: 'fabric', name: 'Canvas fabric', note: '1.5 m wide', glyph: 'fabric', ideas: [
    { name: 'Tote bag', shape: 'bag', time: '90 min', level: 'Intermediate' },
  ] },
  { id: 'offcuts', name: 'Small offcuts', note: 'hardwood', glyph: 'offcut', ideas: [
    { name: 'Phone stand', shape: 'stand', time: '45 min', level: 'Beginner' },
    { name: 'Key holder', shape: 'panel', time: '40 min', level: 'Beginner' },
  ] },
];

function Glyph({ kind }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' };
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      {kind === 'plank' && <><path d="M4 22 22 12l8 4-18 10z" {...s} /><path d="M4 22v3l8 4v-3M30 16v3L12 29" {...s} /></>}
      {kind === 'jar' && <><rect x="9" y="10" width="16" height="20" rx="4" {...s} /><path d="M12 6h10v4H12z" {...s} /></>}
      {kind === 'rope' && <><circle cx="17" cy="17" r="12" {...s} /><circle cx="17" cy="17" r="7.5" {...s} /><circle cx="17" cy="17" r="3" {...s} /></>}
      {kind === 'fabric' && <path d="M5 9c4-3 8 3 12 0s8-3 12 0v16c-4-3-8 3-12 0s-8 3-12 0z" {...s} />}
      {kind === 'offcut' && <><path d="M5 20 14 15l7 3.5-9 5z" {...s} /><path d="M17 11l9-5 4 2-9 5z" {...s} /></>}
    </svg>
  );
}

const FLOW = ['Materials', 'Ideas', 'Build', 'Sell'];

export function Discover() {
  const [sel, setSel] = useState(MATERIALS[0]);
  return (
    <section id="discover" className="h-section h-discover">
      <div className="h-wrap">
        <Reveal className="h-head">
          <span className="h-kicker">Discover</span>
          <h2 className="h-h2">Pick a material. <span className="serif accent-text">Watch it become</span> a product.</h2>
        </Reveal>

        <Reveal className="h-flow" delay={0.1}>
          {FLOW.map((f, i) => (
            <div key={f} className={`h-flow-step ${i <= 1 ? 'lit' : ''}`}>
              <span className="mono">0{i + 1}</span>{f}
              {i < FLOW.length - 1 && <motion.span className="h-flow-line" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.3 + i * 0.25, ease: EASE }} />}
            </div>
          ))}
        </Reveal>

        <div className="h-disc-grid">
          <div className="h-materials" role="listbox" aria-label="Materials">
            {MATERIALS.map((m, i) => (
              <Reveal key={m.id} delay={i * 0.06}>
                <button role="option" aria-selected={sel.id === m.id} className={`h-mat ${sel.id === m.id ? 'on' : ''}`} onClick={() => setSel(m)} onMouseEnter={() => setSel(m)} onFocus={() => setSel(m)}>
                  {sel.id === m.id && <motion.span layoutId="mat-bg" className="h-mat-bg" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                  <span className="h-mat-glyph"><Glyph kind={m.glyph} /></span>
                  <span className="h-mat-text">
                    <span className="h-mat-name">{m.name}</span>
                    <span className="h-mat-note mono">{m.note}</span>
                  </span>
                  <span className="h-mat-count mono">{m.ideas.length}</span>
                </button>
              </Reveal>
            ))}
          </div>

          <div className="h-beam" aria-hidden="true">
            <svg viewBox="0 0 80 300" preserveAspectRatio="none">
              <path d="M0 150 C 40 150, 40 60, 80 60 M0 150 L80 150 M0 150 C 40 150, 40 240, 80 240" className="h-beam-path" />
              <motion.circle key={sel.id} r="4" cy="150" className="h-beam-dot" initial={{ cx: 0, opacity: 1 }} animate={{ cx: 80, opacity: [1, 1, 0] }} transition={{ duration: 0.9, ease: EASE }} />
            </svg>
          </div>

          <div className="h-ideas" aria-live="polite">
            <AnimatePresence mode="popLayout">
              {sel.ideas.map((idea, i) => (
                <motion.article
                  key={`${sel.id}-${idea.name}`}
                  className="h-idea"
                  layout
                  initial={{ opacity: 0, x: 40, rotate: 2, scale: 0.96 }}
                  animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -20, scale: 0.96 }}
                  transition={{ duration: 0.55, ease: EASE, delay: i * 0.08 }}
                >
                  <div className="h-idea-visual"><ProductVisual shape={idea.shape} size={88} /></div>
                  <div className="h-idea-body">
                    <h3>{idea.name}</h3>
                    <div className="h-idea-meta">
                      <span><Clock size={13} />{idea.time}</span>
                      <span><Gauge size={13} />{idea.level}</span>
                    </div>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
            <Link to="/app/create" className="h-textlink">Try it with your own materials <ArrowRight size={15} /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
