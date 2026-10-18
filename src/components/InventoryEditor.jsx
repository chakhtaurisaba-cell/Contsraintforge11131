import { useState } from 'react';
import { Ruler } from 'lucide-react';
import { Field, NumberInput, Button, DimensionTag } from './ui.jsx';
import { DIMENSION_STATUS } from '../../shared/constants.js';

const EMPTY = { name: '', material: '', quantity: 1, unit: 'pcs', dimensions: null, unitValue: null, condition: '', notes: '' };

/** Editable form for one inventory item, including qualified dimensions. */
export function InventoryItemForm({ initial, onSubmit, onCancel, submitLabel = 'Save item', busy, currency }) {
  const [item, setItem] = useState({ ...EMPTY, ...initial });
  const [showDims, setShowDims] = useState(Boolean(initial?.dimensions));
  const dims = item.dimensions || { unit: 'mm', status: 'user_confirmed' };
  const set = (k, v) => setItem((x) => ({ ...x, [k]: v }));
  const setDim = (k, v) => setItem((x) => ({ ...x, dimensions: { ...dims, [k]: v } }));

  function submit(e) {
    e.preventDefault();
    const d = showDims && item.dimensions ? item.dimensions : null;
    const hasAny = d && ['length', 'width', 'height', 'thickness', 'diameter'].some((k) => d[k] > 0);
    onSubmit({
      name: item.name.trim(),
      material: item.material || null,
      category: item.category || null,
      quantity: Number(item.quantity) || 0,
      unit: item.unit || 'pcs',
      dimensions: hasAny ? { ...d, length: d.length || null, width: d.width || null, height: d.height || null, thickness: d.thickness || null, diameter: d.diameter || null } : null,
      unitValue: item.unitValue ?? null,
      condition: item.condition || null,
      notes: item.notes || null,
      potentialUses: item.potentialUses || [],
      source: item.source === 'ai_scan' ? 'ai_scan' : 'user',
      confidence: item.confidence ?? null,
    });
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
        <Field label="Name *"><input className="input" required maxLength={120} value={item.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pine boards" /></Field>
        <Field label="Material"><input className="input" maxLength={80} value={item.material || ''} onChange={(e) => set('material', e.target.value)} placeholder="e.g. Pine wood" /></Field>
        <Field label="Quantity"><NumberInput value={item.quantity} min={0} onChange={(v) => set('quantity', v)} /></Field>
        <Field label="Unit"><input className="input" maxLength={20} value={item.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs, m, kg" /></Field>
        <Field label={`Replacement value / unit${currency ? ` (${currency})` : ''}`} hint="Optional — used for economic cost"><NumberInput value={item.unitValue} min={0} onChange={(v) => set('unitValue', v)} /></Field>
        <Field label="Condition"><input className="input" maxLength={200} value={item.condition || ''} onChange={(e) => set('condition', e.target.value)} placeholder="new, used, scratched…" /></Field>
      </div>
      {!showDims ? (
        <Button type="button" size="sm" icon={Ruler} onClick={() => { setShowDims(true); if (!item.dimensions) set('dimensions', { unit: 'mm', status: 'user_confirmed' }); }} style={{ alignSelf: 'flex-start' }}>
          Add dimensions
        </Button>
      ) : (
        <div className="card tight" style={{ background: 'var(--bg)' }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="label">Dimensions (per piece)</span>
            <DimensionTag status={dims.status} uncertainty={dims.uncertaintyPct} />
          </div>
          <div className="form-grid">
            {['length', 'width', 'thickness', 'height', 'diameter'].map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><NumberInput value={dims[k]} min={0} onChange={(v) => setDim(k, v)} className="input-sm" /></Field>
            ))}
            <Field label="Unit">
              <select className="select input-sm" value={dims.unit} onChange={(e) => setDim('unit', e.target.value)}>
                {['mm', 'cm', 'm', 'in', 'ft'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="How was this measured?">
              <select className="select input-sm" value={dims.status} onChange={(e) => setDim('status', e.target.value)}>
                {Object.entries(DIMENSION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{DIMENSION_STATUS[dims.status]?.note} Designs only count as dimensionally validated when measurements are user-confirmed or verified.</p>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export function dimsSummary(d) {
  if (!d) return null;
  const parts = ['length', 'width', 'thickness', 'height', 'diameter'].filter((k) => d[k]).map((k) => `${k[0].toUpperCase()} ${d[k]}`);
  return parts.length ? `${parts.join(' × ')} ${d.unit}` : null;
}
