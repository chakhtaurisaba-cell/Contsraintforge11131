import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { Card, Badge, Banner } from '../../components/ui.jsx';
import { AssemblyView, CutListDiagram } from '../../components/Diagrams.jsx';
import { mm } from '../../utils/format.js';

export default function DesignTab({ project: p }) {
  const plan = p.plan;
  const [hl, setHl] = useState([]);
  const [exploded, setExploded] = useState(false);
  const hasGeometry = plan.components.some((c) => c.instances?.length);
  const flagTone = { info: 'info', caution: 'warn', high: 'danger' };

  return (
    <div className="stack-lg">
      {plan.dimensionsValidated ? (
        <Banner tone="ok" icon={CheckCircle2}>Every dimension this design depends on comes from confirmed measurements in your inventory.</Banner>
      ) : (
        <Banner tone="warn" icon={AlertTriangle}>
          <strong>Not dimensionally validated.</strong> Confirm these with a tape measure before cutting, then update the inventory and regenerate the plan:
          <ul className="list" style={{ marginTop: 6 }}>{plan.validationNotes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Banner>
      )}
      {plan.riskFlags?.map((f) => (
        <Banner key={f.text} tone={flagTone[f.level]} icon={f.level === 'high' ? ShieldAlert : Info}>{f.text}</Banner>
      ))}

      <div className="grid g-main" style={{ alignItems: 'start' }}>
        <Card title="Assembly view" sub="Drawn from the plan’s sizes — a guide, not an exact drawing." actions={hasGeometry && <button type="button" className={`chip ${exploded ? 'active' : ''}`} aria-pressed={exploded} onClick={() => setExploded((x) => !x)}>{exploded ? 'Exploded' : 'Assembled'}</button>}>
          {hasGeometry ? (
            <div className="blueprint" style={{ padding: 12 }}>
              <AssemblyView components={plan.components} highlight={hl} height={340} explode={exploded ? 0.6 : 0} />
            </div>
          ) : (
            <p className="muted small">This product has no rigid parts to draw (e.g. fabric or poured items). See the components table and build guide.</p>
          )}
          <p className="xs muted" style={{ marginTop: 8 }}>Hover a component in the table to highlight it.</p>
        </Card>
        <Card title="Overall size">
          <div className="grid g-3" style={{ gap: 8 }}>
            {[['Length', plan.overall.length], ['Depth', plan.overall.width], ['Height', plan.overall.height]].map(([l, v]) => (
              <div key={l} className="card tight" style={{ background: 'var(--bg)', textAlign: 'center' }}>
                <div className="xs muted">{l}</div>
                <div className="strong mono">{mm(v)}</div>
              </div>
            ))}
          </div>
          <p className="small text-2" style={{ marginTop: 12 }}>{plan.summary}</p>
          <hr className="divider" />
          <div className="label" style={{ marginBottom: 6 }}>Design constraints</div>
          <ul className="list small">{plan.designConstraints.map((c) => <li key={c}>{c}</li>)}</ul>
          {plan.tolerances?.length > 0 && (
            <>
              <div className="label" style={{ margin: '12px 0 6px' }}>Tolerances & fit</div>
              <ul className="list small">{plan.tolerances.map((c) => <li key={c}>{c}</li>)}</ul>
            </>
          )}
        </Card>
      </div>

      <Card title="Components" sub="Finished part dimensions in millimetres">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Part</th><th className="num">Qty</th><th className="num">Length</th><th className="num">Width</th><th className="num">Thickness</th><th>Material / source</th><th className="hide-sm">Role</th></tr></thead>
            <tbody>
              {plan.components.map((c) => (
                <tr key={c.id} onMouseEnter={() => setHl([c.id])} onMouseLeave={() => setHl([])} onFocus={() => setHl([c.id])} tabIndex={0}>
                  <td><span className="strong">{c.name}</span> <span className="mono xs muted">{c.id}</span></td>
                  <td className="num">{c.quantity}</td>
                  <td className="num mono">{c.cutLength ?? '—'}</td>
                  <td className="num mono">{c.cutWidth ?? '—'}</td>
                  <td className="num mono">{c.thickness ?? '—'}</td>
                  <td>{c.material}<div>{c.fromInventory ? <Badge tone="ok">from “{c.fromInventory}”</Badge> : <Badge tone="warn">to buy</Badge>}</div></td>
                  <td className="hide-sm small text-2">{c.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {plan.cutList && (
        <Card title="Cut list" sub={`${plan.cutList.boardsNeeded} board(s) per unit · ${plan.cutList.utilisationPct}% material utilisation · 3 mm saw kerf and 10 mm end trim included`}>
          <div className="blueprint" style={{ padding: 14 }}>
            <CutListDiagram cutList={plan.cutList} />
          </div>
          {plan.cutList.warnings?.map((w) => <div key={w} style={{ marginTop: 8 }}><Banner tone="warn">{w}</Banner></div>)}
        </Card>
      )}

      <Card title="Assumptions">
        {plan.assumptions.length ? (
          <ul className="list-plain stack" style={{ gap: 6 }}>
            {plan.assumptions.map((a) => (
              <li key={a.text} className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                {a.needsMeasurement ? <Badge tone="warn">measure</Badge> : <Badge>note</Badge>}
                <span className="text-2">{a.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No assumptions — the plan uses your confirmed measurements.</p>
        )}
      </Card>
    </div>
  );
}
