import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, Recycle, Ruler, ListChecks, Wallet, Calculator, Store, Check, Cpu } from 'lucide-react';
import { PublicNav } from './home/PublicNav.jsx';
import { Footer } from './home/Home.jsx';
import { Magnetic, Reveal, SplitWords, EASE } from './home/motion.jsx';
import { PHOTO_CREDITS } from '../components/productPhotos.js';
import PHOTOS from '../data-product-photos.json';
import '../styles/home.css';
import '../styles/about.css';

// Real example photos from the curated library (see Photo credits below).
const STORIES = [
  { materials: [['Pine boards', '6 × 1000 mm'], ['Wood screws', 'box of 100'], ['Hand saw', 'tool']], product: 'Wall shelf', photo: PHOTOS['wall_shelf-wood'] },
  { materials: [['Glass jars', '5 small'], ['Soy wax', '1 kg'], ['Cotton wicks', 'a few']], product: 'Jar candle', photo: PHOTOS['candle_jar-glass'] },
  { materials: [['Fabric scraps', 'old shirts'], ['Thread', 'one spool'], ['Needle', 'tool']], product: 'Zip pouch', photo: PHOTOS['pouch-fabric'] },
  { materials: [['Plastic bottles', '20 × 1.5 L'], ['Twine', 'a roll'], ['Scissors', 'tool']], product: 'Bird feeder', photo: PHOTOS['bird_feeder-plastic'] },
];

/** Raw materials on the left travel through the forge line and become a finished product. */
function ForgeScene() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % STORIES.length), 4200);
    return () => clearInterval(t);
  }, [reduce]);
  const s = STORIES[i];
  return (
    <div className="ab-forge" aria-label={`Example: ${s.materials.map((m) => m[0]).join(', ')} become a ${s.product.toLowerCase()}`}>
      <div className="ab-forge-in">
        <AnimatePresence mode="popLayout">
          {s.materials.map(([name, note], k) => (
            <motion.div
              key={`${i}-${name}`}
              className="ab-mat"
              initial={reduce ? false : { opacity: 0, x: -28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: 40, scale: 0.9 }}
              transition={{ duration: 0.55, ease: EASE, delay: k * 0.09 }}
            >
              <span className="ab-mat-dot" />
              <span className="ab-mat-name">{name}</span>
              <span className="ab-mat-note mono">{note}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="ab-forge-line" aria-hidden="true">
        {!reduce && <motion.span key={i} className="ab-forge-spark" initial={{ left: '0%', opacity: 0 }} animate={{ left: ['0%', '100%'], opacity: [0, 1, 0] }} transition={{ duration: 1.2, delay: 0.5, ease: 'easeInOut' }} />}
      </div>
      <div className="ab-forge-out">
        <AnimatePresence mode="wait">
          <motion.figure
            key={i}
            className="ab-product"
            initial={reduce ? false : { opacity: 0, scale: 0.92, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, scale: 1.04, filter: 'blur(6px)' }}
            transition={{ duration: 0.7, ease: EASE, delay: reduce ? 0 : 0.9 }}
          >
            <img src={s.photo.src} alt={`Example photo of a ${s.product.toLowerCase()}`} style={{ objectPosition: s.photo.position }} />
            <figcaption><span>{s.product}</span><span className="ab-chip">Example photo</span></figcaption>
          </motion.figure>
        </AnimatePresence>
      </div>
      <div className="ab-forge-dots" role="tablist" aria-label="Examples">
        {STORIES.map((x, k) => (
          <button key={x.product} type="button" role="tab" aria-selected={k === i} aria-label={x.product} className={k === i ? 'on' : ''} onClick={() => setI(k)} />
        ))}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="ab-hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="h-wrap ab-hero-grid">
        <div>
          <motion.div className="h-kicker" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.15, ease: EASE }}>About us</motion.div>
          <h1 className="ab-h1">
            <SplitWords text="Turn what you have" delay={0.2} />
            <br />
            <SplitWords text="into what you can" delay={0.45} />{' '}
            <motion.span className="serif accent-text" initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.9, delay: 0.75, ease: EASE }}>build.</motion.span>
          </h1>
          <motion.p className="ab-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.95, ease: EASE }}>
            ConstraintForge helps you discover realistic products from your existing materials, build them with clear instructions, and explore ways to sell them.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 1.1, ease: EASE }}>
            <Link to="/app/create" className="btn btn-primary btn-lg hero-cta">Start with your materials <ArrowRight size={17} /></Link>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.35, ease: EASE }}>
          <ForgeScene />
        </motion.div>
      </div>
    </section>
  );
}

const LEFTOVERS = [
  ['Offcut boards', 8, 12, -60], ['Glass jars', 72, 6, 40], ['Old shirts', 18, 70, 30], ['Cardboard', 80, 64, -50],
  ['Bottles', 46, 84, 60], ['Spare screws', 4, 40, -30], ['Wax ends', 90, 34, 50], ['Twine', 60, 26, -40],
];

function Problem() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  return (
    <section className="h-section ab-problem" ref={ref}>
      <div className="ab-leftovers" aria-hidden="true">
        {LEFTOVERS.map(([label, x, y, drift]) => (
          <ParallaxChip key={label} label={label} x={x} y={y} drift={reduce ? 0 : drift} progress={scrollYProgress} />
        ))}
      </div>
      <div className="h-wrap ab-problem-copy">
        <Reveal><span className="h-kicker">The problem</span></Reveal>
        <Reveal delay={0.05}>
          <h2 className="ab-h2">Leftover materials. Unused things. <span className="serif accent-text">Good ideas.</span></h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="ab-lede" style={{ margin: '18px auto 0' }}>But it’s hard to know what you can realistically make with exactly what you own.</p>
        </Reveal>
      </div>
    </section>
  );
}

function ParallaxChip({ label, x, y, drift, progress }) {
  const ty = useTransform(progress, [0, 1], [drift, -drift]);
  return <motion.span className="ab-leftover" style={{ left: `${x}%`, top: `${y}%`, y: ty }}>{label}</motion.span>;
}

const STEPS = [
  { n: '01', title: 'Start with your materials.', text: 'Type what you have, add amounts and sizes if you know them, or scan it with your camera.' },
  { n: '02', title: 'Discover what you can realistically build.', text: 'Ideas are checked against your stock, sizes and tools. The ones that don’t make physical sense are left out.' },
  { n: '03', title: 'Build it and explore where to sell it.', text: 'Follow a short step-by-step guide, then see a few places to sell, a listing and a cautious price.' },
];

function StepVisual({ n }) {
  const reduce = useReducedMotion();
  const stagger = (k) => ({ initial: reduce ? false : { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { duration: 0.5, ease: EASE, delay: 0.2 + k * 0.1 } });
  if (n === '01') {
    return (
      <div className="ab-sv ab-sv-input">
        {['6 pine boards · 1000 × 150 × 18 mm', 'box of 100 wood screws', 'wood glue', 'hand saw · drill'].map((t, k) => (
          <motion.span key={t} className="ab-sv-chip" {...stagger(k)}>{t}</motion.span>
        ))}
      </div>
    );
  }
  if (n === '02') {
    return (
      <div className="ab-sv ab-sv-ideas">
        {[['Wooden tray', 'tray-wood'], ['Plant stand', 'plant_stand-wood'], ['Wooden box', 'box-wood']].map(([t, key], k) => (
          <motion.div key={t} className="ab-sv-idea" {...stagger(k)}>
            <img src={PHOTOS[key].src} alt="" style={{ objectPosition: PHOTOS[key].position }} />
            <span>{t}</span>
            <i><Check size={11} />You have everything</i>
          </motion.div>
        ))}
      </div>
    );
  }
  return (
    <div className="ab-sv ab-sv-build">
      {['Cut the shelf board to 300 mm', 'Sand the edges', 'Fix the brackets'].map((t, k) => (
        <motion.div key={t} className="ab-sv-step" {...stagger(k)}><span className="ab-sv-check"><Check size={11} /></span>{t}</motion.div>
      ))}
      <motion.div className="ab-sv-sell" {...stagger(3)}>
        <span>Sell on</span><b>Local marketplace</b><b>Craft fair</b>
      </motion.div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="h-section ab-how">
      <div className="h-wrap">
        <Reveal><span className="h-kicker">How it works</span></Reveal>
        <Reveal delay={0.05}><h2 className="ab-h2" style={{ maxWidth: 720 }}>From a pile of materials to a finished product, in three steps.</h2></Reveal>
        <div className="ab-steps">
          <motion.div className="ab-steps-line" aria-hidden="true" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1.4, ease: EASE }} />
          {STEPS.map((s, k) => (
            <Reveal key={s.n} delay={0.1 + k * 0.12} className="ab-step">
              <span className="ab-step-n mono">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <StepVisual n={s.n} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// Only what the app actually does.
const PRINCIPLES = [
  { icon: Recycle, title: 'Your materials first', text: 'Everything you own is used before anything goes on a shopping list.' },
  { icon: Ruler, title: 'Fitted to real sizes', text: 'Designs are checked against your quantities and board sizes, and oversize parts are flagged.' },
  { icon: ListChecks, title: 'Practical instructions', text: 'Short steps with measurements, the parts to use and a check for each step.' },
  { icon: Wallet, title: 'No needless buying', text: 'Only a genuine shortfall is listed — never something you already have enough of.' },
  { icon: Calculator, title: 'Costs you can follow', text: 'Material costs, margins and break-even are calculated, not guessed by the AI.' },
  { icon: Store, title: 'Where to sell it', text: 'A few suitable channels, a ready listing and a cautious price for the product you picked.' },
];

function Principles() {
  return (
    <section className="h-section ab-principles">
      <div className="h-wrap">
        <Reveal><span className="h-kicker">What makes us different</span></Reveal>
        <Reveal delay={0.05}><h2 className="ab-h2">Built around what you <span className="serif accent-text">actually</span> have.</h2></Reveal>
        <div className="ab-pgrid">
          {PRINCIPLES.map((p, k) => (
            <Reveal key={p.title} delay={0.05 + (k % 3) * 0.08} className="ab-pcard">
              <span className="ab-picon"><p.icon size={20} /></span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.1}><p className="ab-local mono"><Cpu size={14} />The AI is Google Gemini, called from the server — your API key never reaches the browser, and your inventory stays in your own database.</p></Reveal>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="h-final ab-final">
      <div className="h-final-rings" aria-hidden="true"><span /><span /><span /></div>
      <div className="h-wrap" style={{ position: 'relative', textAlign: 'center' }}>
        <Reveal><span className="h-kicker">Your move</span></Reveal>
        <Reveal delay={0.05}><h2 className="h-final-h">Start with what you <span className="serif accent-text">have.</span></h2></Reveal>
        <Reveal delay={0.15}><p className="h-lede" style={{ margin: '18px auto 34px' }}>List your materials and see what you can make in under a minute.</p></Reveal>
        <Reveal delay={0.25}>
          <Magnetic><Link to="/app/create" className="btn btn-primary btn-lg hero-cta">Find what I can build <ArrowRight size={17} /></Link></Magnetic>
        </Reveal>
      </div>
    </section>
  );
}

function Credits() {
  return (
    <section className="h-wrap ab-credits" id="credits">
      <details>
        <summary>Photo credits</summary>
        <p className="xs muted">Example product photos are used under their free licences. They show the kind of product, not your exact design.</p>
        <ul>
          {PHOTO_CREDITS.map((c) => (
            <li key={c.key}>
              <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.title || c.key}</a> — {c.author} · {c.licenseUrl ? <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a> : c.license} · {c.source}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export default function About() {
  const { hash } = useLocation();
  useEffect(() => {
    document.title = 'About us — ConstraintForge';
    if (hash === '#credits') {
      const el = document.getElementById('credits');
      el?.querySelector('details')?.setAttribute('open', '');
      setTimeout(() => el?.scrollIntoView({ behavior: 'smooth' }), 300);
    } else window.scrollTo(0, 0);
  }, [hash]);
  return (
    <div className="home about">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <PublicNav />
      <main id="main-content">
        <Hero />
        <Problem />
        <HowItWorks />
        <Principles />
        <FinalCta />
        <Credits />
      </main>
      <Footer />
    </div>
  );
}
