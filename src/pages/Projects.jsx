import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderKanban, Sparkles, Search } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { Page, Button, Empty, ErrorState, LoadingBlock, StatusBadge, ExampleBadge, Progress, Stagger, StaggerItem } from '../components/ui.jsx';
import { ProductPreview } from '../components/ProductPreview.jsx';
import { assignPhotos } from '../components/productPhotos.js';
import { PROJECT_STATUSES } from '../../shared/constants.js';
import { money, pct, relTime } from '../utils/format.js';

export default function Projects() {
  const { data, error, loading, reload } = useApi('/projects');
  const { currency } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useMemo(() => (data || []).filter((p) => (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!status || p.status === status)), [data, q, status]);

  return (
    <Page eyebrow="Projects" title="Your projects" actions={<Button variant="primary" icon={Sparkles} onClick={() => nav('/app/create')}>New product</Button>}>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock rows={4} />}
      {data && !data.length && (
        <Empty icon={FolderKanban} title="No projects yet" action={<Button variant="primary" icon={Sparkles} onClick={() => nav('/app/create')}>Generate ideas from my materials</Button>}>
          Generate ideas from your resources, then save or develop one into a project.
        </Empty>
      )}
      {data?.length > 0 && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <div className="input-group" style={{ maxWidth: 320, flex: 1 }}>
              <input className="input" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
              <span className="addon"><Search size={14} /></span>
            </div>
            <select className="select" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {PROJECT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <Stagger className="grid g-3">
            {list.map((p, pi, arr) => (
              <StaggerItem key={p.id}>
                <Link to={`/app/projects/${p.id}`} className="card interactive" style={{ display: 'block', color: 'inherit', textDecoration: 'none', height: '100%' }}>
                  <div style={{ marginBottom: 12 }}><ProductPreview idea={p} photo={(arr.photos ||= assignPhotos(arr))[pi]} caption={false} /></div>
                  <div className="row-between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div className="strong" style={{ fontSize: 15 }}>{p.name}</div>
                    {p.isExample && <ExampleBadge />}
                  </div>
                  <div className="row" style={{ margin: '8px 0' }}>
                    <StatusBadge status={p.status} />
                    {p.category && <span className="xs muted">{p.category}</span>}
                  </div>
                  <Progress value={p.progress} />
                  <div className="row-between xs muted" style={{ marginTop: 10 }}>
                    <span>{p.hasPlan ? `Build ${p.progress}% · ${p.unitsProduced} made` : 'No plan yet'}</span>
                    <span>{relTime(p.updatedAt)}</span>
                  </div>
                  {p.hasPlan && (
                    <div className="row-between small" style={{ marginTop: 8 }}>
                      <span className="text-2">Price {money(p.price, currency)}</span>
                      <span className={p.netProfitPerUnit < 0 ? 'danger-text' : 'ok-text'}>{money(p.netProfitPerUnit, currency)}/unit · {pct(p.netMarginPct)}</span>
                    </div>
                  )}
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
          {!list.length && <p className="muted">No projects match your filters.</p>}
        </>
      )}
    </Page>
  );
}
