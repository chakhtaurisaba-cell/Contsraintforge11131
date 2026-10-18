import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Logo } from '../../components/ui.jsx';
import { ThemeToggle } from '../../theme/ThemeToggle.jsx';
import { EASE } from './motion.jsx';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#discover', label: 'Discover' },
  { href: '#features', label: 'Features' },
  { href: '/about', label: 'About us', route: true },
];

export function PublicNav() {
  // Section links point at the home page's sections, also when shown on another page.
  const onHome = useLocation().pathname === '/';
  const hrefOf = (l) => (l.route || onHome ? l.href : `/${l.href}`);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24); // React bails out when the boolean is unchanged
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <motion.header className={`pn ${scrolled ? 'scrolled' : ''}`} initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, ease: EASE }}>
      <div className="pn-inner">
        <Link to="/" className="pn-logo" aria-label="ConstraintForge home"><Logo /></Link>
        <nav className="pn-links" aria-label="Site">
          {LINKS.map((l) => (l.route
            ? <NavLink key={l.href} to={l.href} className={({ isActive }) => `pn-link ${isActive ? 'active' : ''}`}>{l.label}</NavLink>
            : <a key={l.href} href={hrefOf(l)} className="pn-link">{l.label}</a>))}
        </nav>
        <div className="pn-actions">
          <ThemeToggle />
          <Link to="/app" className="pn-link pn-ws hide-sm"><LayoutGrid size={15} />Workspace</Link>
          <Link to="/app/create" className="btn btn-primary btn-sm pn-cta hide-sm">Start creating <ArrowRight size={14} /></Link>
          <button className={`pn-burger ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="pn-menu" aria-label={open ? 'Close menu' : 'Open menu'}>
            <span /><span />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div id="pn-menu" className="pn-menu" initial={{ clipPath: 'inset(0 0 100% 0)' }} animate={{ clipPath: 'inset(0 0 0% 0)' }} exit={{ clipPath: 'inset(0 0 100% 0)' }} transition={{ duration: 0.5, ease: EASE }}>
            <nav aria-label="Mobile">
              {[...LINKS, { href: '/app', label: 'Workspace', route: true }].map((l, i) => (
                <motion.div key={l.href} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 + i * 0.06, ease: EASE, duration: 0.5 }}>
                  {l.route ? <Link to={l.href} className="pn-menu-link" onClick={() => setOpen(false)}><span className="mono">0{i + 1}</span>{l.label}</Link>
                    : <a href={hrefOf(l)} className="pn-menu-link" onClick={() => setOpen(false)}><span className="mono">0{i + 1}</span>{l.label}</a>}
                </motion.div>
              ))}
            </nav>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              <Link to="/app/create" className="btn btn-primary btn-lg btn-block" onClick={() => setOpen(false)}>Start creating <ArrowRight size={16} /></Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
