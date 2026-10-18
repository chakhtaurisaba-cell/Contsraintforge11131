import { lazy, Suspense } from 'react';
import { Route, Routes, Link, Outlet, Navigate, useParams } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { AppShell } from './components/Shell.jsx';
import { Empty, LoadingBlock } from './components/ui.jsx';
import Home from './pages/home/Home.jsx';

const About = lazy(() => import('./pages/About.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Create = lazy(() => import('./pages/Create.jsx'));
const Scan = lazy(() => import('./pages/Scan.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace.jsx'));
const Marketplace = lazy(() => import('./pages/Marketplace.jsx'));
const Strategy = lazy(() => import('./pages/Strategy.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Advisor = lazy(() => import('./pages/Advisor.jsx'));
const Integrations = lazy(() => import('./pages/Integrations.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

const Fallback = () => (
  <div className="page">
    <LoadingBlock rows={4} />
  </div>
);

function Workspace() {
  return (
    <AppShell>
      <Suspense fallback={<Fallback />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

const NotFound = ({ inApp }) => (
  <div className="page">
    <Empty icon={Compass} title="Nothing here" action={<Link className="btn btn-primary" to={inApp ? '/app' : '/'}>{inApp ? 'Back to workspace' : 'Back home'}</Link>}>
      This page does not exist.
    </Empty>
  </div>
);

// Old (pre-redesign) workspace URLs keep working.
const LEGACY = ['create', 'scan', 'projects', 'marketplace', 'strategy', 'analytics', 'advisor', 'integrations', 'settings'];
function LegacyProject() {
  const { id } = useParams();
  return <Navigate to={`/app/projects/${id}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<Suspense fallback={<div className="home" />}><About /></Suspense>} />
      <Route path="/app" element={<Workspace />}>
        <Route index element={<Dashboard />} />
        <Route path="create" element={<Create />} />
        <Route path="scan" element={<Scan />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectWorkspace />} />
        <Route path="marketplace" element={<Marketplace />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="advisor" element={<Advisor />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound inApp />} />
      </Route>
      {LEGACY.map((p) => <Route key={p} path={`/${p}`} element={<Navigate to={`/app/${p}`} replace />} />)}
      <Route path="/projects/:id" element={<LegacyProject />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
