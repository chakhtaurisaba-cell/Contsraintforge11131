import { useNavigate } from 'react-router-dom';
import { BarChart3, BrainCircuit, Plus, Upload, CircleCheck, AlertTriangle } from 'lucide-react';
import { Card, Button, Banner, Empty } from './ui.jsx';
import { money, num, pct } from '../utils/format.js';

/**
 * The visible outcome of "Analyze": what data was used, the computed numbers, the AI's
 * explanation of those numbers (when available) and how many recommendations came out.
 * With no recorded sales it says so and offers the two ways to add data.
 */
export function AnalysisResult({ result, running, currency, onRecordSale }) {
  const nav = useNavigate();
  if (running) {
    return (
      <Card>
        <div className="row small text-2" role="status"><span className="spinner" style={{ width: 14, height: 14 }} />Analysing your recorded sales…</div>
      </Card>
    );
  }
  if (!result) return null;
  const s = result.summary;
  if (!s?.hasData) {
    return (
      <Card>
        <Empty
          icon={BarChart3}
          title="You haven’t added any sales data yet."
          action={
            <div className="row">
              <Button variant="primary" icon={Plus} onClick={onRecordSale || (() => nav('/app/analytics?record=1'))}>Record a sale</Button>
              <Button icon={Upload} onClick={() => nav('/app/integrations')}>Import a CSV</Button>
            </div>
          }
        >
          The analysis works from sales you record or import — nothing is estimated or made up. Add a sale, then press Analyze again.
        </Empty>
      </Card>
    );
  }
  const t = s.totals;
  return (
    <Card title="Analysis result" sub={`Based on ${num(s.salesRecords)} recorded sale${s.salesRecords === 1 ? '' : 's'}${s.from ? ` from ${s.from} to ${s.to}` : ''}${s.exampleRecords ? ` — ${s.exampleRecords} of them simulated example data` : ''}.`}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="analysis-kpis">
          <div><span className="xs muted">Revenue</span><strong>{money(t.revenue, currency)}</strong></div>
          <div><span className="xs muted">Costs</span><strong>{money(t.costs, currency)}</strong></div>
          <div><span className="xs muted">Profit</span><strong className={t.netProfit < 0 ? 'danger-text' : ''}>{money(t.netProfit, currency)}</strong></div>
          <div><span className="xs muted">Units sold</span><strong>{num(t.units)}</strong></div>
          <div><span className="xs muted">Margin</span><strong>{pct(t.marginPct)}</strong></div>
          <div><span className="xs muted">Units on hand</span><strong>{num(s.onHand)}</strong></div>
        </div>
        {t.salesWithoutCost > 0 && <div className="xs warn-text row" style={{ gap: 6 }}><AlertTriangle size={13} />{t.salesWithoutCost} sale(s) have no production cost, so profit is overstated for them.</div>}
        <div className="grid g-2" style={{ gap: 14 }}>
          {[['By product', s.byProduct], ['By channel', s.byChannel]].map(([label, rows]) => (
            <div key={label}>
              <div className="label" style={{ marginBottom: 6 }}>{label}</div>
              <table className="table analysis-table">
                <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{num(r.units)} sold</td><td className="num">{money(r.revenue, currency)}</td><td className="num muted">{money(r.profit, currency)} profit</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
        {result.overall && <Banner tone="info" icon={BrainCircuit}>{result.overall}</Banner>}
        {result.aiError && <div className="xs muted">The AI explanation isn’t available ({result.aiError}); the numbers above are complete.</div>}
        <div className="small row" style={{ gap: 6 }}>
          <CircleCheck size={14} className="ok-text" />
          {result.diagnosticsFound ? `${result.diagnosticsFound} recommendation${result.diagnosticsFound === 1 ? '' : 's'} found — see below on the Advisor page.` : 'No problems found in this data that call for a change.'}
          {s.productsWithoutPlan > 0 && <span className="muted"> {s.productsWithoutPlan} product(s) without a build plan were left out of the recommendations.</span>}
        </div>
      </div>
    </Card>
  );
}
