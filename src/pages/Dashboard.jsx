import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, ScanLine, ArrowRight, BrainCircuit, FlaskConical, Trash2, LineChart, Plus, Activity } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Card, Button, Stat, ExampleBadge, StatusBadge, Progress, LoadingBlock, ErrorState, Stagger, StaggerItem, Banner, Empty } from '../components/ui.jsx';
import { ProductPreview } from '../components/ProductPreview.jsx';
import { TimelineChart } from '../components/Charts.jsx';
import { money, num, pct, relTime } from '../utils/format.js';

function EntryTile({ icon: Icon, title, hint, to, primary }) {
  return (
    <Link to={to} className={`entry-tile ${primary ? 'primary' : ''}`}>
      <span className="entry-icon"><Icon size={20} /></span>
      <span className="entry-text"><span className="entry-title">{title}</span><span className="entry-hint">{hint}</span></span>
      <ArrowRight size={18} className="entry-arrow" />
    </Link>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useApi('/dashboard');
  const { toast, setPageContext, saveSettings } = useApp();
  const { busy, run } = useAction(toast);
  const nav = useNavigate();
  const cur = data?.settings?.currency || 'GEL';

  useEffect(() => {
    if (data) setPageContext('dashboard', { counts: data.counts, totals: data.totals, recommendations: data.recommendations?.map((r) => r.title) });
  }, [data, setPageContext]);

  const loadExamples = () => run('ex', async () => { await api.post('/examples'); await reload(); }, 'Example projects loaded');
  const t = data?.totals;
  const hasSales = data && t.orders > 0;
  const latest = data?.projects?.find((p) => !p.isExample) || data?.projects?.[0];

  return (
    <Page title={data?.settings?.businessName || 'Your workshop'}>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <div className="card"><LoadingBlock rows={4} /></div>}

      {data && (
        <Stagger className="stack-lg">
          <StaggerItem>
            <section className="ws-hero">
              <div className="ws-hero-grid">
                <div>
                  <div className="eyebrow">{latest ? 'Pick up where you left off' : 'Start here'}</div>
                  <h2>{latest ? <>Keep forging <span className="serif accent-text">{latest.name.replace(' (example)', '')}</span></> : <>What do you <span className="serif accent-text">have</span> today?</>}</h2>
                  {latest && (
                    <div className="row" style={{ marginTop: 16 }}>
                      <StatusBadge status={latest.status} />
                      <div style={{ width: 160 }}><Progress value={latest.progress} /></div>
                      <span className="small muted">{latest.progress}% built</span>
                    </div>
                  )}
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {latest && <EntryTile icon={ArrowRight} title="Continue project" hint={latest.name} to={`/app/projects/${latest.id}`} primary />}
                  <EntryTile icon={Sparkles} title="Describe materials" hint="Get ranked product ideas" to="/app/create" primary={!latest} />
                  <EntryTile icon={ScanLine} title="Scan with camera" hint="Detect & measure what you own" to="/app/scan" />
                </div>
              </div>
            </section>
          </StaggerItem>

          {data.hasExamples && (
            <StaggerItem>
              <Banner tone="warn" icon={FlaskConical}>
                <div className="row-between">
                  <span>Example data (simulated) is {data.settings.includeExamples ? 'included' : 'hidden'}.</span>
                  <div className="row">
                    <Button size="sm" onClick={() => run('toggle', async () => { await saveSettings({ includeExamples: !data.settings.includeExamples }); await reload(); })}>{data.settings.includeExamples ? 'Hide' : 'Include'}</Button>
                    <Button size="sm" variant="danger" icon={Trash2} loading={busy === 'rm'} onClick={() => run('rm', async () => { await api.del('/examples'); await reload(); }, 'Examples removed')}>Remove</Button>
                  </div>
                </div>
              </Banner>
            </StaggerItem>
          )}

          <StaggerItem className="signal-row">
            <div className="signal"><Stat label="Active projects" value={num(data.counts.active)} foot={`${data.counts.inventoryItems} materials in stock`} /></div>
            <div className="signal"><Stat label="Revenue" value={hasSales ? money(t.revenue, cur) : '—'} foot={hasSales ? `${num(t.units)} units sold` : 'No sales recorded'} /></div>
            <div className="signal"><Stat label="Net profit" value={hasSales ? money(t.netProfit, cur) : '—'} tone={t.netProfit < 0 ? 'danger' : undefined} foot={t.marginPct != null ? `${pct(t.marginPct)} margin` : 'After all costs'} /></div>
            <div className="signal"><Stat label="On hand" value={num(data.inventory.reduce((s, i) => s + Math.max(0, i.onHand), 0))} foot="Finished units" /></div>
          </StaggerItem>

          <StaggerItem>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h2 className="section-h">Projects</h2>
              <Link to="/app/projects" className="btn btn-ghost btn-sm">All <ArrowRight size={14} /></Link>
            </div>
            {data.projects.length ? (
              <div className="bench">
                {data.projects.map((p, i) => (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
                    <Link to={`/app/projects/${p.id}`} className="bench-item">
                      <ProductPreview idea={p} project={p} caption={false} />
                      <div className="bench-name">{p.name}</div>
                      <div className="row" style={{ gap: 6 }}><StatusBadge status={p.status} />{p.isExample && <ExampleBadge />}</div>
                      <Progress value={p.progress} />
                    </Link>
                  </motion.div>
                ))}
                <Link to="/app/create" className="bench-item bench-new"><Plus size={26} /><span>New idea</span></Link>
              </div>
            ) : (
              <Card className="quiet"><Empty icon={Sparkles} title="No projects yet" action={<Button variant="primary" icon={Sparkles} onClick={() => nav('/app/create')}>Generate ideas</Button>} /></Card>
            )}
          </StaggerItem>

          <StaggerItem className="grid g-main">
            <Card title="Sales" actions={<Link to="/app/analytics" className="btn btn-ghost btn-sm"><LineChart size={14} />Analytics</Link>}>
              {data.timeline.length ? (
                <>
                  <div className="legend" style={{ marginBottom: 8 }}><span><i style={{ background: 'var(--chart-1)' }} />Revenue</span><span><i style={{ background: 'var(--chart-2)' }} />Profit</span></div>
                  <TimelineChart data={data.timeline} currency={cur} height={220} />
                </>
              ) : (
                <Empty icon={LineChart} title="No sales yet">Recorded sales appear here.</Empty>
              )}
            </Card>
            <Card title="Advisor" actions={<Link to="/app/advisor" className="btn btn-ghost btn-sm"><BrainCircuit size={14} />Open</Link>}>
              {data.recommendations.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {data.recommendations.map((r) => (
                    <Link key={r.id} to="/app/advisor" className="insight">
                      <span className="insight-dot" />
                      <span><span className="strong">{r.title}</span>{r.isExample && <> <ExampleBadge /></>}<span className="xs muted" style={{ display: 'block' }}>{r.projectName}</span></span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="small muted">Nothing needs attention. Run the advisor after recording sales.</p>
              )}
              {data.activity.length > 0 && (
                <>
                  <hr className="divider" />
                  <div className="row small muted" style={{ marginBottom: 8 }}><Activity size={13} />Recent</div>
                  <ul className="list-plain stack" style={{ gap: 6 }}>
                    {data.activity.slice(0, 4).map((a) => (
                      <li key={a.id} className="row-between xs" style={{ flexWrap: 'nowrap' }}><span className="text-2" style={{ minWidth: 0 }}>{a.message}</span><span className="muted nowrap">{relTime(a.created_at)}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </StaggerItem>

          {!data.hasExamples && !hasSales && (
            <StaggerItem className="row small muted" style={{ justifyContent: 'center' }}>
              <FlaskConical size={14} /> Want to see analytics and the advisor first?
              <Button size="sm" variant="ghost" loading={busy === 'ex'} onClick={loadExamples}>Load example projects</Button>
            </StaggerItem>
          )}
        </Stagger>
      )}
    </Page>
  );
}
