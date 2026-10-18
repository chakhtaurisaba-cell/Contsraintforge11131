import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutGrid, Ruler, ListChecks, Hammer, ShoppingCart, Calculator, Megaphone, LineChart, Trash2, Wand2, FolderX } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Tabs, Button, ErrorState, LoadingBlock, Empty, ExampleBadge, Modal, Banner } from '../components/ui.jsx';
import { PROJECT_STATUSES } from '../../shared/constants.js';
import OverviewTab from './project/OverviewTab.jsx';
import DesignTab from './project/DesignTab.jsx';
import MaterialsTab from './project/MaterialsTab.jsx';
import BuildTab from './project/BuildTab.jsx';
import SourcingTab from './project/SourcingTab.jsx';
import EconomicsTab from './project/EconomicsTab.jsx';
import SellTab from './project/SellTab.jsx';
import { ProductPreview } from '../components/ProductPreview.jsx';
import ResultsTab from './project/ResultsTab.jsx';

// The two things a chosen product is for: building it and selling it.
const TABS = [
  { id: 'build', label: 'Build it', icon: Hammer },
  { id: 'sell', label: 'Sell it', icon: Megaphone },
];
// Everything else stays available, one click away, without crowding the page.
const MORE = [
  { id: 'materials', label: 'Materials list', icon: ListChecks },
  { id: 'sourcing', label: 'Buy missing parts', icon: ShoppingCart },
  { id: 'design', label: 'Measured drawing', icon: Ruler },
  { id: 'economics', label: 'Costs', icon: Calculator },
  { id: 'results', label: 'Production & sales', icon: LineChart },
  { id: 'overview', label: 'Notes & status', icon: LayoutGrid },
];

/** What it is, what you already have for it, and anything genuinely missing — in one glance. */
function ProjectSummary({ project: p, goTo }) {
  const alloc = p.computed?.allocation;
  const owned = alloc
    ? [...new Set(alloc.lines.filter((l) => !l.optional).flatMap((l) => l.sources.map((x) => x.name)).filter((n) => n && n !== 'Marked as owned by you'))]
    : (p.idea?.usesExisting || []).map((u) => u.inventoryName);
  const missing = alloc ? alloc.purchases : p.idea?.missing || [];
  return (
    <div className="card project-summary" style={{ marginBottom: 18 }}>
      <ProductPreview idea={p.idea || { name: p.name }} />
      <div className="stack" style={{ gap: 10, minWidth: 0 }}>
        <p className="text-2">{p.idea?.summary || p.idea?.description || p.idea?.tagline}</p>
        {owned.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>You already have</div>
            <div className="summary-materials">{owned.map((n) => <span key={n} className="uses-chip">{n}</span>)}</div>
          </div>
        )}
        {missing.length > 0 ? (
          <div className="small warn-text">Still needed: {missing.map((m) => `${m.name} (${m.quantity} ${m.unit})`).join(', ')} · <button type="button" className="link-btn" onClick={() => goTo('sourcing')}>where to buy</button></div>
        ) : alloc ? (
          <div className="small ok-text">Nothing to buy — your materials cover it.</div>
        ) : null}
      </div>
    </div>
  );
}

export default function ProjectWorkspace() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'build';
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const { data: project, setData, error, loading, reload } = useApi(`/projects/${id}`, [id]);
  const ctx = useApp();
  const { toast, setPageContext } = ctx;
  const action = useAction(toast);
  const nav = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (project) {
      setPageContext('project', {
        id: project.id,
        tab,
        name: project.name,
        status: project.status,
        idea: project.idea && { name: project.idea.name, description: project.idea.description },
        plan: project.plan && { summary: project.plan.summary, overall: project.plan.overall, steps: project.plan.steps.map((s) => `${s.n}. ${s.title}: ${s.instructions}`), assumptions: project.plan.assumptions },
        economics: project.computed?.economics && { perUnit: project.computed.economics.perUnit, breakEvenPrice: project.computed.economics.breakEvenPrice, price: project.economics.price },
        metrics: project.computed?.metrics,
        currentStep: project.progress?.currentStep,
      });
    }
  }, [project, tab, setPageContext]);

  /** PATCH and replace local state with the server's recomputed project. */
  const patch = async (body, msg) => {
    const r = await action.run('patch', () => api.patch(`/projects/${id}`, body), msg);
    if (r) setData(r);
    return r;
  };

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading && !project) return <div className="page"><LoadingBlock rows={6} /></div>;
  if (!project) return <div className="page"><Empty icon={FolderX} title="Project not found" /></div>;

  const shared = { project, setProject: setData, patch, reload, action, ctx };
  const generatePlan = () =>
    action.run('plan', async () => {
      const r = await api.post(`/projects/${id}/plan`);
      setData(r);
    }, 'Build plan generated');

  return (
    <Page
      eyebrow={project.idea?.category || 'Project'}
      title={
        <span className="row" style={{ gap: 10 }}>
          {project.name}
          {project.isExample && <ExampleBadge />}
        </span>
      }
      sub={null}
      actions={
        <>
          <select className="select" style={{ width: 210 }} value={project.status} onChange={(e) => patch({ status: e.target.value }, 'Status updated')} aria-label="Project status">
            {PROJECT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete project" />
        </>
      }
    >
      {project.isExample && <div style={{ marginBottom: 14 }}><Banner tone="warn">This is an example project with simulated production and sales data.</Banner></div>}
      <ProjectSummary project={project} goTo={setTab} />
      <Tabs tabs={TABS} value={MORE.some((m) => m.id === tab) ? null : tab} onChange={setTab} />
      <div className="project-more xs">
        <span className="muted">More:</span>
        {MORE.map((m) => (
          <button key={m.id} type="button" className={`chip ${tab === m.id ? 'active' : ''}`} style={{ height: 26, fontSize: 12 }} aria-pressed={tab === m.id} onClick={() => setTab(m.id)}>{m.label}</button>
        ))}
      </div>
      {!project.plan && !['overview', 'sell'].includes(tab) ? (
        <Empty icon={Wand2} title="No build guide yet" action={<Button variant="primary" icon={Wand2} loading={action.busy === 'plan'} onClick={generatePlan}>Make the build guide</Button>}>
          A short, step-by-step guide made for this product and the materials you have.
        </Empty>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === 'overview' && <OverviewTab {...shared} generatePlan={generatePlan} goTo={setTab} />}
            {tab === 'design' && <DesignTab {...shared} />}
            {tab === 'materials' && <MaterialsTab {...shared} goTo={setTab} />}
            {tab === 'build' && <BuildTab {...shared} />}
            {tab === 'sourcing' && <SourcingTab {...shared} goTo={setTab} />}
            {tab === 'economics' && <EconomicsTab {...shared} />}
            {tab === 'sell' && <SellTab {...shared} />}
            {tab === 'results' && <ResultsTab {...shared} />}
          </motion.div>
        </AnimatePresence>
      )}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete project?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} loading={action.busy === 'del'} onClick={() => action.run('del', async () => { await api.del(`/projects/${id}`); nav('/app/projects'); }, 'Project deleted')}>Delete permanently</Button>
          </>
        }
      >
        <p className="text-2">This removes the plan, purchases, production records and sales of “{project.name}”. This cannot be undone.</p>
      </Modal>
    </Page>
  );
}
