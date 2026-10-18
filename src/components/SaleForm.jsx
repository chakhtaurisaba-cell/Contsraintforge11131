import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import { useAction } from '../hooks/useApi.js';
import { Button, Field, NumberInput } from './ui.jsx';
import { money, today } from '../utils/format.js';

export function SaleForm({ projects, fixedProjectId, defaultPrice, channels = [], currency, onSaved }) {
  const { toast } = useApp();
  const { busy, run } = useAction(toast);
  const blank = { projectId: fixedProjectId || projects[0]?.id || null, date: today(), channel: channels[0] || '', quantity: 1, unitPrice: defaultPrice ?? null, fees: 0, shippingCost: 0, adCost: 0, refund: 0, returnedUnits: 0, note: '' };
  const [s, setS] = useState(blank);
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    run('sale', async () => {
      await api.post('/sales', { ...s, note: s.note || undefined, fees: s.fees ?? 0, shippingCost: s.shippingCost ?? 0, adCost: s.adCost ?? 0, refund: s.refund ?? 0, returnedUnits: s.returnedUnits ?? 0 });
      setS({ ...blank, channel: s.channel, projectId: s.projectId, unitPrice: s.unitPrice });
      onSaved?.();
    }, 'Sale recorded');
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        {!fixedProjectId && (
          <Field label="Product">
            <select className="select" value={s.projectId || ''} onChange={(e) => set('projectId', e.target.value || null)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">Unassigned</option>
            </select>
          </Field>
        )}
        <Field label="Date"><input type="date" className="input" value={s.date} max={today()} required onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Channel *">
          <input className="input" list="channel-list" required maxLength={80} value={s.channel} onChange={(e) => set('channel', e.target.value)} placeholder="e.g. Local market" />
          <datalist id="channel-list">{[...new Set([...channels, 'Local classifieds', 'Instagram DM', 'Craft market', 'Handmade marketplace', 'Shopify', 'Friends & family'])].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Quantity *"><NumberInput value={s.quantity} min={1} step={1} required onChange={(v) => set('quantity', v)} /></Field>
        <Field label="Unit price *"><NumberInput value={s.unitPrice} min={0} required onChange={(v) => set('unitPrice', v)} suffix={currency} /></Field>
        <Field label="Fees paid"><NumberInput value={s.fees} min={0} onChange={(v) => set('fees', v)} suffix={currency} /></Field>
        <Field label="Shipping you paid"><NumberInput value={s.shippingCost} min={0} onChange={(v) => set('shippingCost', v)} suffix={currency} /></Field>
        <Field label="Ad spend"><NumberInput value={s.adCost} min={0} onChange={(v) => set('adCost', v)} suffix={currency} /></Field>
        <Field label="Refunded"><NumberInput value={s.refund} min={0} onChange={(v) => set('refund', v)} suffix={currency} /></Field>
        <Field label="Units returned"><NumberInput value={s.returnedUnits} min={0} step={1} onChange={(v) => set('returnedUnits', v)} /></Field>
      </div>
      <div className="row-between">
        <span className="small muted">Revenue: <span className="num text-2">{money((s.quantity || 0) * (s.unitPrice || 0), currency)}</span></span>
        <Button type="submit" variant="primary" icon={Plus} loading={busy === 'sale'}>Record sale</Button>
      </div>
    </form>
  );
}
