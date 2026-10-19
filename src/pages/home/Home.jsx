import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, ArrowDown } from 'lucide-react';
import { PublicNav } from './PublicNav.jsx';
import { HeroForge } from './HeroForge.jsx';
import { Discover } from './Discover.jsx';
import { HowItWorks } from './HowItWorks.jsx';
import { Preview } from './Preview.jsx';
import { Intelligence } from './Intelligence.jsx';
import { Magnetic, Reveal, SplitWords, EASE } from './motion.jsx';
import { Logo } from '../../components/ui.jsx';
import { ThemeToggle } from '../../theme/ThemeToggle.jsx';
import '../../styles/home.css';

function Hero() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const fade = useTransform(scrollY, [0, 500], [1, 0.25]);
  const lift = useTransform(scrollY, [0, 500], [0, reduce ? 0 : -60]);
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-ruler" aria-hidden="true">
        {Array.from({ length: 60 }, (_, i) => <span key={i} className={i % 10 === 0 ? 'major' : i % 5 === 0 ? 'mid' : ''} />)}
      </div>
      <div className="h-wrap hero-grid">
        <motion.div className="hero-copy" style={{ opacity: fade, y: lift }}>
          <motion.div className="h-kicker" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.2, ease: EASE }}>
            AI product forge
          </motion.div>
          <h1 className="hero-h1">
            <SplitWords text="You have the materials." delay={0.25} />
            <br />
            <SplitWords text="AI finds the" delay={0.55} />
            <motion.span className="serif hero-accent" initial={reduce ? false : { opacity: 0, y: 30, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1, delay: 0.85, ease: EASE }}>
              possibilities.
            </motion.span>
          </h1>
          <motion.p className="hero-sub" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 1.05, ease: EASE }}>
            Turn what you already own into something you can build, sell, and grow.
          </motion.p>
          <motion.div className="hero-ctas" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 1.2, ease: EASE }}>
            <Magnetic>
              <Link to="/app/create" className="btn btn-primary btn-lg hero-cta">Start creating <ArrowRight size={17} /></Link>
            </Magnetic>
            <a href="#discover" className="btn btn-ghost btn-lg">Explore the possibilities <ArrowDown size={16} /></a>
          </motion.div>
          <motion.div className="hero-trail mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.8 }}>
            {['Materials', 'Ideas', 'Build', 'Sell'].map((s, i) => (
              <span key={s}>{i > 0 && <i />}{s}</span>
            ))}
          </motion.div>
        </motion.div>
        <motion.div className="hero-visual" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, delay: 0.3, ease: EASE }}>
          <HeroForge />
        </motion.div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="h-final">
      <div className="h-final-rings" aria-hidden="true"><span /><span /><span /></div>
      <div className="h-wrap" style={{ position: 'relative', textAlign: 'center' }}>
        <Reveal><span className="h-kicker">Your move</span></Reveal>
        <Reveal delay={0.05}>
          <h2 className="h-final-h">Stop wondering what you could <span className="serif accent-text">build.</span></h2>
        </Reveal>
        <Reveal delay={0.15}><p className="h-lede" style={{ margin: '18px auto 34px' }}>Start with what you have. Discover what comes next.</p></Reveal>
        <Reveal delay={0.25}>
          <Magnetic>
            <Link to="/app/create" className="btn btn-primary btn-lg hero-cta">Build your first idea <ArrowRight size={17} /></Link>
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="h-footer">
      <div className="h-wrap h-footer-grid">
        <div className="stack" style={{ gap: 14 }}>
          <Logo />
          <p className="muted small" style={{ maxWidth: 280 }}>From the materials you own to products you can sell.</p>
          <ThemeToggle />
        </div>
        <nav aria-label="Product">
          <div className="h-foot-h">Product</div>
          <a href="/#how">How it works</a>
          <a href="/#discover">Discover</a>
          <a href="/#features">Features</a>
          <Link to="/about">About us</Link>
          <Link to="/about#credits">Photo credits</Link>
        </nav>
        <nav aria-label="Workspace">
          <div className="h-foot-h">Workspace</div>
          <Link to="/app/create">Create a product</Link>
          <Link to="/app/scan">Scan materials</Link>
          <Link to="/app/projects">Projects</Link>
          <Link to="/app/analytics">Analytics</Link>
          <Link to="/app/advisor">Business advisor</Link>
        </nav>
        <nav aria-label="Setup">
          <div className="h-foot-h">Setup</div>
          <Link to="/app/integrations">Integrations</Link>
          <Link to="/app/settings">Settings & privacy</Link>
        </nav>
      </div>
      <div className="h-wrap h-foot-base mono">
        <span>© {new Date().getFullYear()} ConstraintForge</span>
        <span>Your inventory stays in your own database</span>
      </div>
    </footer>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = 'ConstraintForge — You have the materials';
  }, []);
  return (
    <div className="home">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <PublicNav />
      <main id="main-content">
        <Hero />
        <Discover />
        <HowItWorks />
        <Preview />
        <Intelligence />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
