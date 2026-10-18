import { useEffect, useState } from 'react';
import { ShoppingBag, CheckCircle2, Hammer } from 'lucide-react';
import { api } from '../../api/client.js';
import { Card, Empty, Stat, Progress, Button, Banner } from '../../components/ui.jsx';
import { PurchaseItem } from '../../components/PurchaseItem.jsx';
import { money } from '../../utils/format.js';

export default function SourcingTab({ project: p, setProject, ctx, reload, goTo }) {
  const [checked, setChecked] = useState(false);
  // Purchase gate: re-check against the current inventory before showing anything to buy.
  useEffect(() => {
    let live = true;
    api.post(`/projects/${p.id}/purchases/sync`).then((r) => { if (live) { setProject(r); setChecked(true); } }).catch(() => setChecked(true));
    return () => { live = false; };
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = p.purchases;
  const open = items.filter((i) => !i.purchased);
  const cur = ctx.currency;
  const bought = items.filter((i) => i.purchased).length;
  const est = open.reduce((s, i) => s + (i.chosenOption?.price != null ? i.chosenOption.price * Math.ceil(i.quantity / (i.chosenOption.packQuantity || 1)) + (i.chosenOption.shippingCost || 0) : (i.estUnitPrice || 0) * i.quantity), 0);
  const spent = items.filter((i) => i.purchased).reduce((s, i) => s + (i.actualCost ?? (i.estUnitPrice || 0) * i.quantity), 0);

  if (!items.length) {
    return (
      <Empty icon={CheckCircle2} title="You already have everything needed for this design." action={<Button variant="primary" icon={Hammer} onClick={() => goTo?.('build')}>Start building</Button>}>
        {checked ? 'Checked against your current inventory — nothing to buy.' : 'Checking your inventory…'}
      </Empty>
    );
  }
  return (
    <div className="stack-lg">
      <Banner tone="info">Only the shortage after using your stock and safe substitutes is listed. Each item says why it is needed.</Banner>
      <div className="grid g-3">
        <div className="card"><Stat icon={ShoppingBag} label="Purchase checklist" value={`${bought}/${items.length}`} foot={<Progress value={Math.round((bought / items.length) * 100)} />} /></div>
        <div className="card"><Stat label="Still to spend" value={money(est, cur)} foot={`For a ${p.economics.batchQty}-unit batch · chosen quotes where available`} /></div>
        <div className="card"><Stat label="Spent so far" value={money(spent, cur)} foot="Actual amounts where entered, otherwise estimates" /></div>
      </div>
      <Card title="What to buy" sub={`Shortages for a batch of ${p.economics.batchQty} — a smaller batch may need less.`}>
        <div className="stack">
          {items.map((i) => <PurchaseItem key={i.id} item={i} region={ctx.settings?.region} onChange={reload} />)}
        </div>
      </Card>
    </div>
  );
}
