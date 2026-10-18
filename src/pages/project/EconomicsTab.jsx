import { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, Info } from 'lucide-react';
import { Card, Button, Field, NumberInput, Stat, Banner, Badge } from '../../components/ui.jsx';
import { SensitivityChart } from '../../components/Charts.jsx';
import { computeEconomics, priceSensitivity, volumeScenarios } from '../../../shared/economics.js';
import { allocate, bomWithAllocation } from '../../../shared/allocation.js';
import { money, pct } from '../../utils/format.js';

const INPUTS = [
  { group: 'Pricing & volume', fields: [['price', 'Selling price', 'cur'], ['batchQty', 'Batch size', 'units']] },
  { group: 'Production', fields: [['packagingPerUnit', 'Packaging / unit', 'cur'], ['laborMinutesPerUnit', 'Labour minutes / unit', 'min'], ['laborRatePerHour', 'Labour rate / hour', 'cur'], ['otherFixedCosts', 'One-off batch costs (tools, samples)', 'cur']] },
  { group: 'Selling', fields: [['shippingPerUnit', 'Seller-paid shipping / unit', 'cur'], ['adSpendPerUnit', 'Advertising / unit', 'cur'], ['marketplaceFeePct', 'Marketplace fee', '%'], ['marketplaceFixedFee', 'Marketplace fixed fee / sale', 'cur'], ['paymentFeePct', 'Payment processing', '%'], ['paymentFixedFee', 'Payment fixed fee / sale', 'cur'], ['returnRatePct', 'Expected return / refund rate', '%']] },
];

export default function EconomicsTab({ project: p, patch, action, ctx }) {
  const cur = ctx.currency;
  const [e, setE] = useState(p.economics);
  useEffect(() => { setE(p.economics); }, [p.economics]);
  const dirty = JSON.stringify(e) !== JSON.stringify(p.economics);
  const inputs = p.computed.allocationInputs;
  // Re-allocate against your stock at the batch size being edited: cash covers only what must be bought.
  const bom = useMemo(() => bomWithAllocation(p.plan.bom, allocate(p.plan.bom, inputs?.inventory || [], e.batchQty, inputs?.reserved || {})), [p.plan.bom, inputs, e.batchQty]);
  const r = useMemo(() => computeEconomics(bom, e), [bom, e]);
  const prices = useMemo(() => {
    const base = Math.max(1, e.price || r.breakEvenPrice || 10);
    return Array.from({ length: 21 }, (_, i) => Math.round(base * (0.4 + i * 0.06) * 100) / 100);
  }, [e.price, r.breakEvenPrice]);
  const sens = useMemo(() => priceSensitivity(bom, e, prices), [bom, e, prices]);
  const vols = useMemo(() => {
    const q = Math.max(1, e.batchQty);
    return volumeScenarios(bom, e, [...new Set([0, Math.round(q * 0.25), Math.round(q * 0.5), Math.round(q * 0.75), q])]);
  }, [bom, e]);
  const set = (k, v) => setE((x) => ({ ...x, [k]: v ?? 0 }));
  const channels = p.strategy?.channels || [];
  const pu = r.perUnit;

  const rows = [
    ['Materials (cash purchases)', pu.materialCash, 'Σ qty × price of BOM lines you must buy'],
    [`Materials you own${e.includeOwnedValue ? '' : ' (excluded)'}`, e.includeOwnedValue ? pu.materialOwnedValue : 0, 'replacement value of owned BOM lines'],
    ['Packaging', pu.packaging, 'input'],
    [`Labour${e.includeLabor ? '' : ' (excluded)'}`, pu.labor, `${e.laborMinutesPerUnit} min ÷ 60 × ${e.laborRatePerHour}`],
    ['= Production cost (COGS)', pu.productionCost, 'materials + packaging + labour', true],
    ['Shipping', pu.shipping, 'input'],
    ['Advertising', pu.ads, 'input'],
    ['Marketplace + payment fees', pu.fees, `${e.price} × (${e.marketplaceFeePct}% + ${e.paymentFeePct}%) + ${e.marketplaceFixedFee} + ${e.paymentFixedFee}`],
    ['Expected refunds', pu.refunds, `${e.price} × ${e.returnRatePct}%`],
    ['= Full cost per unit sold', pu.fullCost, '', true],
  ];

  return (
    <div className="stack-lg">
      <Banner tone="info" icon={Info}>All figures are computed by the app from your bill of materials and these inputs. They are planning estimates, not guaranteed earnings. Changes update instantly — save to keep them.</Banner>
      <div className="grid g-4">
        <div className="card"><Stat label="Net profit / unit" value={money(pu.netProfit, cur)} tone={pu.netProfit < 0 ? 'danger' : 'ok'} foot={`Net margin ${pct(pu.netMarginPct)}`} /></div>
        <div className="card"><Stat label="Gross profit / unit" value={money(pu.grossProfit, cur)} foot={`Gross margin ${pct(pu.grossMarginPct)}`} /></div>
        <div className="card"><Stat label="Break-even price" value={money(r.breakEvenPrice, cur)} foot={r.breakEvenPrice == null ? 'Fees + returns ≥ 100% — no price breaks even' : e.price < r.breakEvenPrice ? 'Your price is BELOW break-even' : 'Your price covers all costs'} tone={r.breakEvenPrice != null && e.price < r.breakEvenPrice ? 'danger' : undefined} /></div>
        <div className="card"><Stat label={`Cash needed for ${r.batch.qty} units`} value={money(r.batch.cashOutlay, cur)} foot={r.breakEvenQty != null ? `One-off costs recovered after ${r.breakEvenQty} sales` : `Profit if all sell: ${money(r.batch.netProfitIfAllSold, cur)}`} /></div>
      </div>

      <div className="grid g-main" style={{ alignItems: 'start' }}>
        <Card title="Assumptions" actions={dirty && (<><Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setE(p.economics)}>Reset</Button><Button size="sm" variant="primary" icon={Save} loading={action.busy === 'patch'} onClick={() => patch({ economics: e }, 'Economics saved')}>Save</Button></>)}>
          <div className="stack-lg">
            {INPUTS.map((g) => (
              <div key={g.group}>
                <div className="label" style={{ marginBottom: 8 }}>{g.group}</div>
                <div className="form-grid">
                  {g.fields.map(([k, label, unit]) => (
                    <Field key={k} label={label}><NumberInput value={e[k]} min={0} onChange={(v) => set(k, v)} suffix={unit === 'cur' ? cur : unit} /></Field>
                  ))}
                </div>
              </div>
            ))}
            <div className="row">
              <label className="checkbox small"><input type="checkbox" checked={e.includeOwnedValue} onChange={(ev) => setE({ ...e, includeOwnedValue: ev.target.checked })} />Count value of materials I already own (economic cost)</label>
              <label className="checkbox small"><input type="checkbox" checked={e.includeLabor} onChange={(ev) => setE({ ...e, includeLabor: ev.target.checked })} />Include my labour as a cost</label>
            </div>
            {channels.length > 0 && (
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Apply a channel's fee assumption</div>
                <div className="row" style={{ gap: 6 }}>
                  {channels.slice(0, 5).map((c) => (
                    <button key={c.name} className="chip" onClick={() => setE({ ...e, marketplaceFeePct: c.feePctAssumption, marketplaceFixedFee: c.fixedFeeAssumption })}>{c.name} · {c.feePctAssumption}%</button>
                  ))}
                </div>
                <p className="hint" style={{ marginTop: 4 }}>Fee assumptions are estimates — verify current fees on each platform.</p>
              </div>
            )}
          </div>
        </Card>
        <Card title="Per-unit breakdown" sub={`At ${money(e.price, cur)}`}>
          <table className="table">
            <tbody>
              {rows.map(([l, v, f, strong]) => (
                <tr key={l}>
                  <td className={strong ? 'strong' : 'text-2'}>{l}{f && <div className="xs muted mono">{f}</div>}</td>
                  <td className={`num mono ${strong ? 'strong' : ''}`}>{money(v, cur)}</td>
                </tr>
              ))}
              <tr><td className="strong">Net profit per unit</td><td className={`num mono strong ${pu.netProfit < 0 ? 'danger-text' : 'ok-text'}`}>{money(pu.netProfit, cur)}</td></tr>
            </tbody>
          </table>
          <div className="formula" style={{ marginTop: 10 }}>break-even = (COGS + shipping + ads + fixed fees) ÷ (1 − fee% − return%)</div>
        </Card>
      </div>

      <div className="grid g-2">
        <Card title="Profit at different prices" sub="Net profit per unit; dashed orange line = your price">
          <SensitivityChart data={sens} currency={cur} currentPrice={e.price} />
        </Card>
        <Card title="If only part of the batch sells" sub={`Batch of ${r.batch.qty} — production paid up front`}>
          <table className="table">
            <thead><tr><th className="num">Sold</th><th className="num">Unsold</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
            <tbody>
              {vols.map((v) => (
                <tr key={v.sold}><td className="num">{v.sold}</td><td className="num">{v.unsold}</td><td className="num mono">{money(v.revenue, cur)}</td><td className={`num mono ${v.profit < 0 ? 'danger-text' : 'ok-text'}`}>{money(v.profit, cur)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="xs muted" style={{ marginTop: 8 }}>Profit = revenue − selling costs of sold units − production cost of the whole batch − one-off costs. Unsold stock keeps its material value but is counted as spent cash here.</p>
          <div className="row" style={{ marginTop: 8 }}><Badge tone="info">Tip</Badge><span className="small text-2">Start with a small batch to validate demand before committing cash.</span></div>
        </Card>
      </div>
    </div>
  );
}
