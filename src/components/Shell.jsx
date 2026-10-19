// Workspace shell: slim icon rail (desktop) / floating dock + sheet (mobile),
// glass top bar with breadcrumbs, theme toggle and a way back to the public site.
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Gauge, Info, Sparkles, ScanLine, FolderKanban, ShoppingCart, Megaphone, LineChart, BrainCircuit, Plug, Settings as SettingsIcon, LayoutGrid, Home, Plus, FlaskConical,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { LogoMark, Badge, Button } from './ui.jsx';
import { ThemeToggle } from '../theme/ThemeToggle.jsx';
import { AssistantPanel, Toasts } from './Layout.jsx';

export const NAV_GROUPS = [
  [
    { to: '/app', label: 'Overview', icon: Gauge, end: true },
    { to: '/about', label: 'About', icon: Info },
    { to: '/app/create', label: 'Create', icon: Sparkles },
    { to: '/app/scan', label: 'Scan', icon: ScanLine },
    { to: '/app/projects', label: 'Projects', icon: FolderKanban },
  ],
  [
    { to: '/app/marketplace', label: 'Source', icon: ShoppingCart },
    { to: '/app/strategy', label: 'Sell', icon: Megaphone },
  ],
  [
    { to: '/app/analytics', label: 'Analytics', icon: LineChart },
    { to: '/app/advisor', label: 'Advisor', icon: BrainCircuit },
  ],
  [
    { to: '/app/integrations', label: 'Connect', icon: Plug },
    { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
  ],
];
const ALL = NAV_GROUPS.flat();
const TITLES = {
  '/app': 'Overview', '/app/create': 'Create a product', '/app/scan': 'Scan materials', '/app/projects': 'Projects', '/app/marketplace': 'Material sourcing',
  '/app/strategy': 'Sales strategy', '/app/analytics': 'Analytics', '/app/advisor': 'Business advisor', '/app/integrations': 'Integrations', '/app/settings': 'Settings',
};

function RailItem({ item, layoutId = 'rail-pill', onClick }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`} onClick={onClick} aria-label={item.label}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId={layoutId} className="rail-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <item.icon size={20} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden="true" />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Rail() {
  const { health } = useApp();
  return (
    <nav className="rail" aria-label="Workspace">
      <Link to="/" className="rail-logo" aria-label="ConstraintForge home"><LogoMark size={30} /></Link>
      {NAV_GROUPS.map((g, i) => (
        <div key={i} style={{ display: 'contents' }}>
          {i > 0 && <div className="rail-sep" />}
          <div className="rail-group">{g.map((item) => <RailItem key={item.to} item={item} />)}</div>
        </div>
      ))}
      <div className="rail-foot">
        <span className={`engine-dot ${health?.ai?.enabled ? 'on' : ''}`} title={health?.ai?.enabled ? 'AI engine connected (Google Gemini)' : 'AI unavailable — rule-based engine active'} />
      </div>
    </nav>
  );
}

function Dock() {
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setMore(false); }, [pathname]);
  const primary = ['/app', '/app/create', '/app/scan', '/app/projects'].map((to) => ALL.find((i) => i.to === to));
  return (
    <>
      <AnimatePresence>
        {more && (
          <>
            <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.nav className="sheet" aria-label="All workspace sections" initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
              {ALL.map((item) => <RailItem key={item.to} item={item} layoutId="sheet-pill" />)}
              <Link to="/" className="rail-item"><Home size={20} aria-hidden="true" /><span>Website</span></Link>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
      <nav className="dock" aria-label="Workspace">
        {primary.map((item) => <RailItem key={item.to} item={item} layoutId="dock-pill" />)}
        <button className={`rail-item ${more ? 'active' : ''}`} style={{ background: 'none', border: 0 }} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="More sections">
          <LayoutGrid size={20} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}

function Topbar() {
  const { pathname } = useLocation();
  const { aiEnabled, health } = useApp();
  const nav = useNavigate();
  const title = TITLES[pathname] || (pathname.startsWith('/app/projects/') ? 'Project' : '');
  return (
    <header className="topbar">
      <Link to="/" className="mobile-logo" aria-label="ConstraintForge home"><LogoMark size={24} /></Link>
      <div className="crumbs">
        <Link to="/app" className="muted hide-sm" style={{ textDecoration: 'none' }}>Workspace</Link>
        <span className="hide-sm">/</span>
        <AnimatePresence mode="wait">
          <motion.span key={title} className="here" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {title}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="spacer" />
      {health && !aiEnabled && <Badge tone="warn" icon={FlaskConical} title="The AI service isn’t available — the rule-based engine is active.">Demo</Badge>}
      <Link to="/" className="btn btn-ghost btn-sm hide-sm"><Home size={14} />Website</Link>
      <ThemeToggle />
      <Button variant="primary" size="sm" icon={Plus} onClick={() => nav('/app/create')} className="hide-sm">New idea</Button>
    </header>
  );
}

export function AppShell({ children }) {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="app">
      <Rail />
      <div className="main">
        <Topbar />
        <main id="main">{children}</main>
      </div>
      <Dock />
      <AssistantPanel />
      <Toasts />
    </div>
  );
}
