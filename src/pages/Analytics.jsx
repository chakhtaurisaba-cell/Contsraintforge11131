import { useEffect, useMemo, useState } from 'react';
import { Download, Play, Plus, Receipt, Wallet, TrendingUp, ShoppingBag, Percent, MousePointerClick, Trash2, Table2, BarChart3 } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Card, Button, Stat, Banner, Empty, ErrorState, LoadingBlock, Modal, Field, NumberInput, Provenance, ExampleBadge, Stagger, StaggerItem } from '../components/ui.jsx';
import { TimelineChart, CategoryBars, SERIES } from '../components/Charts.jsx';
import { SaleForm } from '../components/SaleForm.jsx';
import { AnalysisResult } from '../components/AnalysisResult.jsx';
import { useSearchParams } from 'react-router-dom';
import { money, num, pct, daysAgo, today } from '../utils/format.js';

const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['all', 'All time']];

export default function Analytics() {
  const { currency, toast, settings, setPageContext } = useApp();
  const [range, setRange] = useState('90');
  const [projectId, setProjectId] = useState('');
  const [channel, setChannel] = useState('');
  const [includeExamples, setIncludeExamples] = useState(true);
  useEffect(() => { if (settings) setIncludeExamples(settings.includeExamples !== false); }, [settings]);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (range !== 'all') p.set('from', daysAgo(Number(range)));
    if (projectId) p.set('projectId', projectId);
    if (channel) p.set('channel', channel);
    p.set('includeExamples', String(includeExamples));
    return p.toString();
  }, [range, projectId, channel, includeExamples]);
  const { data, error, loading, reload } = useApi(`/analytics?${qs}`, [qs]);
  const projects = useApi('/projects');
  const { busy, run } = useAction(toast);
  const [modal, setModal] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [params, setParams] = useSearchParams();
  // "Record a sale" from an empty analysis lands here with the form open.
  useEffect(() => {
    if (params.get('record') === '1') {
      setModal('sale');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);
  const analyse = () => run('analyse', async () => setAnalysis(await api.post('/advisor/run', {})));
  const [inspect, setInspect] = useState(null);
  const [traffic, setTraffic] = useState({ channel: '', projectId: '', periodStart: daysAgo(30), periodEnd: today(), visits: null, impressions: null });
  const [expense, setExpense] = useState({ projectId: '', date: today(), category: 'Materials', amount: null, note: '' });
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (data) setPageContext('analytics', { filters: data.filters, totals: data.totals, byChannel: data.byChannel, byProduct: data.byProduct, conversion: data.conversion, inventory: data.inventory });
  }, [data, setPageContext]);

  const t = data?.totals;
  const projList = (projects.data || []).filter((p) => includeExamples || !p.isExample);

  return (
    <Page
      eyebrow="Performance"
      title="How sales are going"
      sub="Only real recorded data. Missing numbers stay missing."
      actions={
        <>
          <a className="btn" href={`/api/analytics/export.csv?${qs}`} download><Download size={16} />Export CSV</a>
          <Button icon={Plus} onClick={() => setModal('sale')}>Record sale</Button>
          <Button variant="primary" icon={Play} loading={busy === 'analyse'} onClick={analyse}>Analyze</Button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 18 }}>
        <select className="select" style={{ width: 170 }} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="select" style={{ width: 230 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Product"><option value="">All products</option>{projList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="select" style={{ width: 200 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"><option value="">All channels</option>{(data?.channels || []).map((c) => <option key={c}>{c}</option>)}</select>
        <label className="checkbox small"><input type="checkbox" checked={includeExamples} onChange={(e) => setIncludeExamples(e.target.checked)} />Include example data</label>
      </div>

      {(analysis || busy === 'analyse') && <div style={{ marginBottom: 18 }}><AnalysisResult result={analysis} running={busy === 'analyse'} currency={currency} onRecordSale={() => setModal('sale')} /></div>}
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock rows={5} />}
      {data && (
        <Stagger className="stack-lg">
          {includeExamples && data.sales.some((s) => s.source === 'example') && <StaggerItem><Banner tone="warn">These figures include simulated example sales.</Banner></StaggerItem>}
          <StaggerItem className="grid g-4">
            <div className="card"><Stat icon={Wallet} label="Revenue" value={money(t.revenue, currency)} foot={`${num(t.orders)} orders · AOV ${money(t.avgOrderValue, currency)}`} /></div>
            <div className="card"><Stat icon={TrendingUp} label="Net profit" value={money(t.netProfit, currency)} tone={t.netProfit < 0 ? 'danger' : undefined} foot={`after production cost, fees, shipping, ads, refunds & ${money(t.otherExpenses, currency)} other expenses`} /></div>
            <div className="card"><Stat icon={Percent} label="Net margin" value={pct(t.marginPct)} foot={t.salesWithoutCost ? `${t.salesWithoutCost} sale(s) lack a production cost` : 'of revenue'} /></div>
            <div className="card"><Stat icon={ShoppingBag} label="Units sold" value={num(t.units)} foot={`${num(t.returnedUnits)} returned · refunds ${money(t.refunds, currency)}`} /></div>
          </StaggerItem>

          {!data.sales.length ? (
            <StaggerItem><Card><Empty icon={BarChart3} title="No sales in this view" action={<Button variant="primary" icon={Plus} onClick={() => setModal('sale')}>Record a sale</Button>}>Record sales manually, import a CSV in Integrations, or widen the filters.</Empty></Card></StaggerItem>
          ) : (
            <>
              <StaggerItem>
                <Card title="Revenue & profit over time" sub={`Grouped by ${data.filters.granularity}`} actions={<Button size="sm" variant="ghost" icon={Table2} onClick={() => setShowTable((x) => !x)}>{showTable ? 'Chart' : 'Table'}</Button>}>
                  <div className="legend" style={{ marginBottom: 8 }}><span><i style={{ background: 'var(--chart-1)' }} />Revenue</span><span><i style={{ background: 'var(--chart-2)' }} />Profit</span></div>
                  {showTable ? (
                    <div className="table-wrap"><table className="table"><thead><tr><th>Period</th><th className="num">Orders</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead><tbody>{data.timeline.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num">{r.orders}</td><td className="num">{r.units}</td><td className="num">{money(r.revenue, currency)}</td><td className="num">{money(r.profit, currency)}</td></tr>)}</tbody></table></div>
                  ) : (
                    <TimelineChart data={data.timeline} currency={currency} height={260} />
                  )}
                </Card>
              </StaggerItem>
              <StaggerItem className="grid g-2">
                <Card title="Profit per unit by channel" sub="Revenue minus all recorded costs, per unit sold">
                  <CategoryBars data={data.byChannel} dataKey="profitPerUnit" name="Profit / unit" currency={currency} />
                  <table className="table" style={{ marginTop: 8 }}>
                    <thead><tr><th>Channel</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">Fees</th><th className="num">Profit</th></tr></thead>
                    <tbody>{data.byChannel.map((c, i) => <tr key={c.key}><td><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: SERIES[i % 8], marginRight: 6 }} />{c.key}</td><td className="num">{c.units}</td><td className="num">{money(c.revenue, currency)}</td><td className="num">{money(c.fees, currency)}</td><td className="num">{money(c.profit, currency)}</td></tr>)}</tbody>
                  </table>
                </Card>
                <Card title="By product">
                  <table className="table">
                    <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">/unit</th></tr></thead>
                    <tbody>{data.byProduct.map((c) => <tr key={c.key}><td>{c.key}</td><td className="num">{c.units}</td><td className="num">{money(c.revenue, currency)}</td><td className="num">{money(c.profit, currency)}</td><td className="num">{money(c.profitPerUnit, currency)}</td></tr>)}</tbody>
                  </table>
                  <hr className="divider" />
                  <div className="card-title" style={{ fontSize: 13, marginBottom: 6 }}>Inventory</div>
                  <table className="table">
                    <thead><tr><th>Product</th><th className="num">Made</th><th className="num">Sold</th><th className="num">On hand</th></tr></thead>
                    <tbody>{data.inventory.filter((i) => !projectId || i.projectId === projectId).map((i) => <tr key={i.projectId}><td>{i.name} {i.isExample && <ExampleBadge />}</td><td className="num">{i.produced}</td><td className="num">{i.sold}</td><td className={`num ${i.onHand < 0 ? 'danger-text' : ''}`}>{i.onHand}</td></tr>)}</tbody>
                  </table>
                </Card>
              </StaggerItem>
            </>
          )}

          <StaggerItem className="grid g-2">
            <Card title="Conversion" sub="Orders ÷ recorded visits" actions={<Button size="sm" icon={MousePointerClick} onClick={() => setModal('traffic')}>Add visit data</Button>}>
              <table className="table">
                <thead><tr><th>Channel</th><th className="num">Visits</th><th className="num">Orders</th><th className="num">Conversion</th></tr></thead>
                <tbody>
                  {data.conversion.map((c) => (
                    <tr key={c.channel}><td>{c.channel}</td><td className="num">{c.visits ?? <span className="muted">—</span>}</td><td className="num">{c.orders}</td><td className="num">{c.conversionPct != null ? pct(c.conversionPct) : <span className="muted small">unavailable</span>}</td></tr>
                  ))}
                  {!data.conversion.length && <tr><td colSpan={4} className="muted small">No channels yet.</td></tr>}
                </tbody>
              </table>
              <p className="xs muted" style={{ marginTop: 8 }}>Conversion and advertising performance appear only when you enter or import visit/impression data — they are never estimated.</p>
            </Card>
            <Card title="Other expenses" sub="Costs not tied to a single sale" actions={<Button size="sm" icon={Receipt} onClick={() => setModal('expense')}>Add expense</Button>}>
              {data.expenses.length ? (
                <table className="table">
                  <thead><tr><th>Date</th><th>Category</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>{data.expenses.map((e) => <tr key={e.id}><td>{e.date}</td><td>{e.category}{e.note && <div className="xs muted">{e.note}</div>}</td><td className="num">{money(e.amount, currency)}</td><td className="right"><Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete expense" onClick={() => run('de', async () => { await api.del(`/expenses/${e.id}`); reload(); })} /></td></tr>)}</tbody>
                </table>
              ) : <p className="small muted">No expenses recorded in this period.</p>}
            </Card>
          </StaggerItem>

          {data.sales.length > 0 && (
            <StaggerItem>
              <Card title="Individual sales" sub="Click a row to see how its profit was calculated">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Product</th><th>Channel</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Profit</th><th>Source</th></tr></thead>
                    <tbody>
                      {data.sales.slice(0, 200).map((s) => (
                        <tr key={s.id} onClick={() => setInspect(s)} style={{ cursor: 'pointer' }} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setInspect(s)}>
                          <td className="nowrap">{s.date}</td><td>{s.project_name || <span className="muted">Unassigned</span>}</td><td>{s.channel}</td><td className="num">{s.quantity}</td><td className="num">{money(s.revenue, currency)}</td><td className={`num ${s.profit < 0 ? 'danger-text' : ''}`}>{money(s.profit, currency)}</td><td><Provenance source={s.source} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </StaggerItem>
          )}
        </Stagger>
      )}

      <Modal open={modal === 'sale'} onClose={() => setModal(null)} title="Record a sale" wide>
        <SaleForm projects={projList} currency={currency} onSaved={() => { reload(); setModal(null); }} />
      </Modal>

      <Modal open={modal === 'traffic'} onClose={() => setModal(null)} title="Add listing traffic" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" loading={busy === 'tr'} disabled={!traffic.channel || traffic.visits == null} onClick={() => run('tr', async () => { await api.post('/channel-metrics', { ...traffic, projectId: traffic.projectId || null }); setModal(null); reload(); }, 'Visit data saved')}>Save</Button></>}>
        <div className="stack">
          <p className="small text-2">Enter views or visits from your listing's statistics page for a period. Conversion = orders in that channel ÷ visits.</p>
          <div className="form-grid">
            <Field label="Channel *"><input className="input" list="ch-list" value={traffic.channel} onChange={(e) => setTraffic({ ...traffic, channel: e.target.value })} /><datalist id="ch-list">{(data?.channels || []).map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Product"><select className="select" value={traffic.projectId} onChange={(e) => setTraffic({ ...traffic, projectId: e.target.value })}><option value="">All / unassigned</option>{projList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="From"><input type="date" className="input" value={traffic.periodStart} onChange={(e) => setTraffic({ ...traffic, periodStart: e.target.value })} /></Field>
            <Field label="To"><input type="date" className="input" value={traffic.periodEnd} onChange={(e) => setTraffic({ ...traffic, periodEnd: e.target.value })} /></Field>
            <Field label="Visits / views *"><NumberInput value={traffic.visits} min={0} step={1} onChange={(v) => setTraffic({ ...traffic, visits: v })} /></Field>
            <Field label="Impressions"><NumberInput value={traffic.impressions} min={0} step={1} onChange={(v) => setTraffic({ ...traffic, impressions: v })} /></Field>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'expense'} onClose={() => setModal(null)} title="Add expense" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" loading={busy === 'ex'} disabled={!expense.amount} onClick={() => run('ex', async () => { await api.post('/expenses', { ...expense, projectId: expense.projectId || null, note: expense.note || undefined }); setModal(null); reload(); }, 'Expense saved')}>Save</Button></>}>
        <div className="form-grid">
          <Field label="Date"><input type="date" className="input" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} /></Field>
          <Field label="Category"><select className="select" value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}>{['Materials', 'Tools', 'Packaging', 'Advertising', 'Platform subscription', 'Market stall', 'Shipping supplies', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label={`Amount (${currency}) *`}><NumberInput value={expense.amount} min={0} onChange={(v) => setExpense({ ...expense, amount: v })} /></Field>
          <Field label="Product"><select className="select" value={expense.projectId} onChange={(e) => setExpense({ ...expense, projectId: e.target.value })}><option value="">General</option>{projList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Note"><input className="input" maxLength={500} value={expense.note} onChange={(e) => setExpense({ ...expense, note: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(inspect)} onClose={() => setInspect(null)} title="How this sale's profit was calculated">
        {inspect && (
          <div className="stack">
            <dl className="kv">
              <dt>Product</dt><dd>{inspect.project_name || 'Unassigned'}</dd>
              <dt>Channel</dt><dd>{inspect.channel}</dd>
              <dt>Quantity × price</dt><dd className="num">{inspect.quantity} × {money(inspect.unit_price, currency)} = {money(inspect.revenue, currency)}</dd>
              <dt>Fees</dt><dd className="num">− {money(inspect.fees, currency)}</dd>
              <dt>Shipping</dt><dd className="num">− {money(inspect.shipping_cost, currency)}</dd>
              <dt>Advertising</dt><dd className="num">− {money(inspect.ad_cost, currency)}</dd>
              <dt>Refund</dt><dd className="num">− {money(inspect.refund, currency)}</dd>
              <dt>Production cost</dt><dd className="num">{inspect.cogs != null ? `− ${inspect.quantity} × ${money(inspect.unitCost, currency)} = ${money(inspect.cogs, currency)}` : 'unknown (project has no plan)'}</dd>
              <dt className="strong">Profit</dt><dd className="num strong">{money(inspect.profit, currency)}</dd>
            </dl>
            <div className="formula">{inspect.profitFormula}</div>
            <p className="xs muted">Production cost uses the product's current per-unit cost from its Economics tab. Source: <Provenance source={inspect.source} /></p>
            <Button variant="danger" size="sm" icon={Trash2} style={{ alignSelf: 'flex-start' }} onClick={() => run('ds', async () => { await api.del(`/sales/${inspect.id}`); setInspect(null); reload(); }, 'Sale deleted')}>Delete this sale</Button>
          </div>
        )}
      </Modal>
    </Page>
  );
}
