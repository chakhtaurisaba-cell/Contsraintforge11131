// Four stages along a scroll-linked measuring line; each has a small live illustration.
import { useRef } from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';
import { Reveal, EASE } from './motion.jsx';

const view = { once: true, margin: '-15% 0px' };

function ScanArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-art">
      <rect x="20" y="12" width="120" height="86" rx="12" className="a-frame" />
      <path d="M26 30v-10h10M134 30v-10h-10M26 80v10h10M134 80v10h-10" className="a-accent" />
      <rect x="48" y="44" width="40" height="12" rx="2" className="a-fill" transform="rotate(-12 68 50)" />
      <rect x="92" y="52" width="16" height="22" rx="4" className="a-fill" />
      <motion.line x1="28" x2="132" className="a-scan" initial={{ y1: 24, y2: 24 }} whileInView={{ y1: [24, 88, 24], y2: [24, 88, 24] }} viewport={view} transition={{ duration: 2.4, ease: 'easeInOut' }} />
    </svg>
  );
}

function IdeasArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-art">
      {[-14, 0, 14].map((r, i) => (
        <motion.g key={r} initial={{ rotate: 0, opacity: 0 }} whileInView={{ rotate: r, opacity: 1 }} viewport={view} transition={{ duration: 0.7, delay: 0.15 * i, ease: EASE }} style={{ originX: '80px', originY: '100px' }}>
          <rect x="56" y="20" width="48" height="66" rx="8" className={i === 1 ? 'a-card-on' : 'a-card'} />
          <rect x="64" y="30" width="32" height="22" rx="3" className="a-fill" />
          <rect x="64" y="58" width="24" height="4" rx="2" className="a-line" />
          <rect x="64" y="66" width="16" height="4" rx="2" className="a-line" />
        </motion.g>
      ))}
    </svg>
  );
}

function BuildArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-art">
      <rect x="14" y="20" width="132" height="22" rx="3" className="a-frame" />
      {[[16, 46], [64, 34], [100, 28], [130, 14]].map(([x, w], i) => (
        <motion.rect key={x} x={x} y="22" height="18" rx="2" className={i % 2 ? 'a-fill' : 'a-fill-2'} initial={{ width: 0 }} whileInView={{ width: w }} viewport={view} transition={{ duration: 0.5, delay: 0.2 + i * 0.18 }} />
      ))}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(18 ${58 + i * 16})`}>
          <rect width="10" height="10" rx="3" className="a-frame" />
          <motion.path d="M2 5l2.5 2.5L8 3" className="a-check" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={view} transition={{ delay: 0.9 + i * 0.25, duration: 0.3 }} />
          <rect x="18" y="3" width={70 - i * 14} height="4" rx="2" className="a-line" />
        </g>
      ))}
    </svg>
  );
}

function SellArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-art">
      <path d="M16 92h128" className="a-frame" />
      {[20, 34, 30, 52, 64].map((h, i) => (
        <motion.rect key={i} x={24 + i * 24} width="14" rx="3" className={i === 4 ? 'a-accent-fill' : 'a-fill'} initial={{ height: 0, y: 92 }} whileInView={{ height: h, y: 92 - h }} viewport={view} transition={{ duration: 0.6, delay: 0.1 * i, ease: EASE }} />
      ))}
      <motion.path d="M20 74 L56 62 L80 66 L104 44 L134 24" className="a-trend" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={view} transition={{ duration: 1.2, delay: 0.5 }} />
    </svg>
  );
}

const STEPS = [
  { t: 'Show what you have', d: 'Type it, or point your camera at it.', Art: ScanArt },
  { t: 'Discover what fits', d: 'Ideas ranked by your materials, tools and budget.', Art: IdeasArt },
  { t: 'Build it right', d: 'Cut lists, measured steps, and what to buy.', Art: BuildArt },
  { t: 'Sell and improve', d: 'Channels, prices, and advice from real sales.', Art: SellArt },
];

export function HowItWorks() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 60%'] });
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  return (
    <section id="how" className="h-section" ref={ref}>
      <div className="h-wrap">
        <Reveal className="h-head">
          <span className="h-kicker">How it works</span>
          <h2 className="h-h2">Four steps from <span className="serif accent-text">“what do I have?”</span> to “it sold.”</h2>
        </Reveal>
        <div className="h-ruler" aria-hidden="true">
          <motion.div className="h-ruler-fill" style={{ scaleX }} />
          {Array.from({ length: 41 }, (_, i) => <span key={i} className={i % 10 === 0 ? 'major' : i % 5 === 0 ? 'mid' : ''} />)}
        </div>
        <ol className="h-steps">
          {STEPS.map(({ t, d, Art }, i) => (
            <Reveal as="li" key={t} delay={i * 0.12} className="h-step">
              <span className="h-step-n mono">0{i + 1}</span>
              <Art />
              <h3>{t}</h3>
              <p>{d}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
