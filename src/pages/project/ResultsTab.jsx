import { useState } from 'react';
import { Factory, Receipt, Trash2, Plus } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { Card, Button, Field, NumberInput, Stat, Provenance, Empty } from '../../components/ui.jsx';
import { SaleForm } from '../../components/SaleForm.jsx';
import { money, num, pct, today } from '../../utils/format.js';

export default function ResultsTab({ project: p, setProject, action, ctx, reload }) {
  const cur = ctx.currency;
  const m = p.computed.metrics;
  const [prod, setProd] = useState({ quantity: null, date: today(), note: '', deductInventory: false });
  const sales = useApi(`/analytics?projectId=${p.id}`, [p.id]);

  const addProduction = (e) => {
    e.preventDefault();
    action.run('prod', async () => {
      setProject(await api.post(`/projects/${p.id}/production`, prod));
      setProd({ quantity: null, date: today(), note: '', deductInventory: prod.deductInventory });
    }, 'Production recorded');
  };

  return (
    <div className="stack-lg">
      <div className="grid g-4">
        <div className="card"><Stat label="Produced" value={num(m.produced)} /></div>
        <div className="card"><Stat label="Sold" value={num(m.sold)} foot={`${num(m.sold30)} in last 30 days`} /></div>
        <div className="card"><Stat label="On hand" value={num(m.onHand)} foot="produced − sold + returned" /></div>
        <div className="card"><Stat label="Recorded profit" value={money(m.profit, cur)} foot={m.actualMarginPct != null ? `${pct(m.actualMarginPct)} of revenue` : 'No sales yet'} tone={m.profit < 0 ? 'danger' : undefined} /></div>
      </div>

      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <Card title="Record production" sub="Units you have finished" actions={<Factory size={16} className="muted" />}>
          <form className="stack" onSubmit={addProduction}>
            <div className="form-grid">
              <Field label="Units made *"><NumberInput value={prod.quantity} min={1} step={1} required onChange={(v) => setProd({ ...prod, quantity: v })} /></Field>
              <Field label="Date"><input type="date" className="input" value={prod.date} max={today()} onChange={(e) => setProd({ ...prod, date: e.target.value })} required /></Field>
            </div>
            <Field label="Note"><input className="input" maxLength={500} value={prod.note} onChange={(e) => setProd({ ...prod, note: e.target.value })} /></Field>
            {!p.isExample && <label className="checkbox small"><input type="checkbox" checked={prod.deductInventory} onChange={(e) => setProd({ ...prod, deductInventory: e.target.checked })} />Deduct the materials these units used from my inventory</label>}
            <Button type="submit" variant="primary" icon={Plus} loading={action.busy === 'prod'} style={{ alignSelf: 'flex-start' }}>Add production</Button>
          </form>
          {p.production.length > 0 && (
            <table className="table" style={{ marginTop: 14 }}>
              <thead><tr><th>Date</th><th className="num">Units</th><th>Note</th><th /></tr></thead>
              <tbody>
                {p.production.map((r) => (
                  <tr key={r.id}><td>{r.date}</td><td className="num">{r.quantity}</td><td className="small text-2">{r.note}</td><td className="right"><Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete production record" onClick={() => action.run('dp', async () => setProject(await api.del(`/production/${r.id}`)))} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Record a sale" actions={<Receipt size={16} className="muted" />}>
          <SaleForm projects={[{ id: p.id, name: p.name }]} fixedProjectId={p.id} defaultPrice={p.economics.price} channels={p.strategy?.channels?.map((c) => c.name) || []} currency={cur} onSaved={() => { reload(); sales.reload(); }} />
        </Card>
      </div>

      <Card title="Sales of this product" sub="Each profit figure can be traced to its inputs">
        {sales.data?.sales?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Channel</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Costs & fees</th><th className="num">Profit</th><th>Source</th><th /></tr></thead>
              <tbody>
                {sales.data.sales.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap">{s.date}</td>
                    <td>{s.channel}</td>
                    <td className="num">{s.quantity}</td>
                    <td className="num mono">{money(s.revenue, cur)}</td>
                    <td className="num mono" title={s.profitFormula}>{money(s.revenue - s.profit, cur)}</td>
                    <td className={`num mono ${s.profit < 0 ? 'danger-text' : ''}`} title={s.profitFormula}>{money(s.profit, cur)}</td>
                    <td><Provenance source={s.source} /></td>
                    <td className="right"><Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete sale" onClick={() => action.run('ds', async () => { await api.del(`/sales/${s.id}`); sales.reload(); reload(); })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="xs muted" style={{ marginTop: 8 }}>Hover a profit figure to see its formula. Production cost uses the current per-unit cost from Economics.</p>
          </div>
        ) : (
          <Empty title="No sales recorded">Record sales above, import a CSV, or connect Shopify in Integrations.</Empty>
        )}
      </Card>
    </div>
  );
}
