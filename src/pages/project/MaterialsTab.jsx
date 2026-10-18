import { useEffect, useMemo, useState } from 'react';
import { Save, ShoppingCart, AlertTriangle, CheckCircle2, Wrench, Check, X, PackageCheck } from 'lucide-react';
import { Card, Button, Badge, Provenance, Banner, NumberInput } from '../../components/ui.jsx';
import { materialCosts } from '../../../shared/economics.js';
import { allocate, bomWithAllocation, STATUS } from '../../../shared/allocation.js';
import { money } from '../../utils/format.js';

export default function MaterialsTab({ project: p, patch, action, ctx, goTo }) {
  const cur = ctx.currency;
  const [bom, setBom] = useState(p.plan.bom);
  useEffect(() => { setBom(p.plan.bom); }, [p.plan.bom]);
  const dirty = JSON.stringify(bom) !== JSON.stringify(p.plan.bom);
  const batch = p.economics.batchQty;
  const inputs = p.computed.allocationInputs;
  // Same deterministic allocation as the server, re-run live while editing.
  const alloc = useMemo(() => allocate(bom, inputs?.inventory || [], batch, inputs?.reserved || {}), [bom, inputs, batch]);
  const mat = materialCosts(bomWithAllocation(bom, alloc));
  const edit = (i, k, v) => setBom((b) => b.map((x, j) => (j === i ? { ...x, [k]: v, ...(k === 'unitPrice' ? { priceSource: 'user' } : {}) } : x)));
  const required = alloc.lines.filter((l) => !l.optional);
  const optional = alloc.lines.filter((l) => l.optional);
  const reservedBy = inputs?.reservedBy || {};

  return (
    <div className="stack-lg">
      {alloc.everythingOwned ? (
        <Banner tone="ok" icon={CheckCircle2}><strong>You already have everything needed</strong> to make {batch}.</Banner>
      ) : (
        <Banner tone="warn" icon={ShoppingCart}>
          <div className="row-between">
            <span>
              You need {alloc.purchases.length === 1 ? '1 more item' : `${alloc.purchases.length} more items`}{alloc.purchases.some((x) => x.unitPrice) ? ` (about ${money(alloc.purchases.reduce((s, x) => s + x.quantity * x.unitPrice, 0), cur)})` : ''}.
              {alloc.reduceBatchTo ? ` We can make ${alloc.reduceBatchTo} with what you have now.` : ''}
            </span>
            <div className="row">
              {alloc.reduceBatchTo && <Button size="sm" onClick={() => patch({ economics: { batchQty: alloc.reduceBatchTo } }, `Batch set to ${alloc.reduceBatchTo} — nothing to buy`)}>Make {alloc.reduceBatchTo} instead</Button>}
              <Button size="sm" variant="primary" icon={ShoppingCart} onClick={() => goTo('sourcing')}>See what to buy</Button>
            </div>
          </div>
        </Banner>
      )}
      {alloc.needsConfirmation.length > 0 && <Banner tone="info">{alloc.needsConfirmation.map((n) => <div key={n}>{n}</div>)}</Banner>}

      <Card
        title="Materials"
        sub={`For ${batch} unit${batch === 1 ? '' : 's'}. Your own stock is used first.`}
        actions={dirty && <Button variant="primary" size="sm" icon={Save} loading={action.busy === 'patch'} onClick={() => patch({ bom }, 'Materials saved')}>Save changes</Button>}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Component</th><th className="num">Per unit</th><th className="num">Batch needs</th><th>From your stock</th><th>Action</th><th className="num">Unit price</th></tr>
            </thead>
            <tbody>
              {required.map((l) => {
                const b = bom[l.index];
                const st = STATUS[l.status];
                return (
                  <tr key={l.index}>
                    <td><div className="strong">{b.name}</div>{b.spec && <div className="xs muted">{b.spec}</div>}{l.upgrade && <Badge>Upgrade you added</Badge>}</td>
                    <td className="num" style={{ width: 120 }}><div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><NumberInput className="input-sm" value={b.quantity} min={0} onChange={(v) => edit(l.index, 'quantity', v ?? 0)} aria-label={`Quantity of ${b.name} per unit`} /><span className="xs muted">{b.unit}</span></div></td>
                    <td className="num mono">{l.needTotal} {l.unit}</td>
                    <td className="small">
                      {l.sources.length ? l.sources.map((s) => (
                        <div key={`${s.itemId}-${s.kind}`}>
                          {s.kind === 'substitute' ? <Badge tone="info">substitute</Badge> : null} {s.name} <span className="mono muted">{s.qty} {s.unit}</span>
                          {reservedBy[s.itemId] && <div className="xs muted">Some of this stock is planned for: {reservedBy[s.itemId].join(', ')}</div>}
                        </div>
                      )) : <span className="muted">—</span>}
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <Badge tone={st.tone}>{st.label}{l.shortage ? ` · ${l.shortage} ${l.unit}` : ''}</Badge>
                      {l.note && <div className="xs muted" style={{ marginTop: 4 }}>{l.note}</div>}
                      {(l.status === 'required_purchase' || l.status === 'insufficient') && !b.ownedOverride && (
                        <button className="chip" style={{ height: 26, marginTop: 6, fontSize: 12 }} onClick={() => edit(l.index, 'ownedOverride', true)}><Check size={12} />I already have this</button>
                      )}
                      {b.ownedOverride && <button className="chip" style={{ height: 26, marginTop: 6, fontSize: 12 }} onClick={() => edit(l.index, 'ownedOverride', false)}><X size={12} />Undo “I have this”</button>}
                    </td>
                    <td className="num" style={{ width: 130 }}>
                      <NumberInput className="input-sm" value={b.unitPrice} min={0} onChange={(v) => edit(l.index, 'unitPrice', v ?? 0)} aria-label={`Unit price of ${b.name}`} />
                      <div style={{ marginTop: 4 }}><Provenance source={b.priceSource} /></div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="right muted">Cash to buy per unit</td><td className="num mono strong">{money(mat.cashPerUnit, cur)}</td></tr>
              <tr><td colSpan={5} className="right muted">Value of your own materials per unit</td><td className="num mono">{money(mat.ownedValuePerUnit, cur)}</td></tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {optional.length > 0 && (
        <Card title="Optional upgrades" sub="Not needed to build it — never added to your shopping list unless you include them.">
          <div className="stack" style={{ gap: 8 }}>
            {optional.map((l) => {
              const b = bom[l.index];
              return (
                <div key={l.index} className="row-between small" style={{ flexWrap: 'nowrap' }}>
                  <span><span className="strong">{b.buyName || b.name}</span> <span className="muted">— {b.whyNeeded || b.role}</span>{l.ownedFraction >= 1 && <> <Badge tone="ok">you have it</Badge></>}</span>
                  <Button size="sm" variant="ghost" onClick={() => edit(l.index, 'included', true)}>Include</Button>
                </div>
              );
            })}
            {bom.some((b) => b.optional && b.included) && (
              <div className="xs muted">Included upgrades appear in the table above. {bom.map((b, i) => (b.optional && b.included ? <button key={i} className="chip" style={{ height: 24, fontSize: 11, marginLeft: 6 }} onClick={() => edit(i, 'included', false)}>Remove {b.buyName || b.name}</button> : null))}</div>
            )}
          </div>
        </Card>
      )}

      {p.plan.toolNotes?.length > 0 ? (
        <Card title="Tools">
          <ul className="list-plain stack" style={{ gap: 8 }}>
            {p.plan.toolNotes.map((t) => (
              <li key={t.tool} className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Badge tone={t.userHasIt ? 'ok' : 'warn'} icon={t.userHasIt ? Check : Wrench}>{t.tool}</Badge>
                <span className="text-2">{t.usedFor}{!t.userHasIt && (t.alternative ? <> — <strong>no {t.tool.toLowerCase()}?</strong> {t.alternative}</> : <> — needed for this design.</>)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : p.computed.tools?.some((t) => t.have) ? (
        <Card title="Tools">
          <div className="row" style={{ gap: 6 }}>{p.computed.tools.filter((t) => t.have).map((t) => <Badge key={t.name} tone="ok" icon={Check}>{t.name}</Badge>)}</div>
        </Card>
      ) : null}

      <div className="row">
        {alloc.everythingOwned ? (
          <Button variant="primary" icon={PackageCheck} onClick={() => goTo('build')}>Start building</Button>
        ) : (
          <Button variant="primary" icon={ShoppingCart} onClick={() => goTo('sourcing')}>Source {alloc.purchases.length} missing item(s)</Button>
        )}
        {dirty && <span className="small warn-text row" style={{ gap: 6 }}><AlertTriangle size={14} />Unsaved changes</span>}
      </div>
    </div>
  );
}
