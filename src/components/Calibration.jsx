// Method E — manual calibration. The user clicks both ends of a reference of known
// length, then both ends of the object edge to measure. Length is computed from the
// pixel ratio, which is only valid when both lie in roughly the same plane and the
// photo is taken square-on — the UI states this and attaches an uncertainty.
import { useRef, useState } from 'react';
import { Ruler, RotateCcw, Plus } from 'lucide-react';
import { Button, Field, NumberInput, Badge, Banner } from './ui.jsx';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function CalibrationTool({ image, onUseMeasurement }) {
  const img = useRef(null);
  const [ref, setRef] = useState([]);
  const [target, setTarget] = useState([]);
  const [refLen, setRefLen] = useState(null);
  const [unit, setUnit] = useState('mm');
  const [label, setLabel] = useState('length');
  const [measurements, setMeasurements] = useState([]);

  const phase = ref.length < 2 ? 'ref' : target.length < 2 ? 'target' : 'done';

  function click(e) {
    const el = img.current;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * image.width;
    const y = ((e.clientY - rect.top) / rect.height) * image.height;
    if (phase === 'ref') setRef((r) => [...r, { x, y }]);
    else if (phase === 'target') setTarget((t) => [...t, { x, y }]);
  }

  const refPx = ref.length === 2 ? dist(ref[0], ref[1]) : null;
  const targetPx = target.length === 2 ? dist(target[0], target[1]) : null;
  const value = refPx && targetPx && refLen ? Math.round((targetPx / refPx) * refLen * 10) / 10 : null;
  // Uncertainty grows when the reference is short relative to the measured edge (click error ≈ 3 px each end).
  const uncertainty = refPx && targetPx ? Math.min(40, Math.round((6 / refPx + 6 / targetPx) * 100 + 5)) : null;

  const reset = () => { setRef([]); setTarget([]); };
  const stroke = Math.max(image.width, image.height) / 300;

  return (
    <div className="stack">
      <Banner tone="info">
        {phase === 'ref' && <>Step 1 — click <strong>both ends of a reference</strong> of known length (ruler marks, a credit card's long edge = 85.6 mm, an A4 sheet = 297 mm).</>}
        {phase === 'target' && <>Step 2 — click <strong>both ends of the edge you want to measure</strong>. Keep it in the same plane as the reference.</>}
        {phase === 'done' && <>Measured. Save it, or reset to measure another edge.</>}
      </Banner>
      <div style={{ position: 'relative', cursor: phase === 'done' ? 'default' : 'crosshair', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-strong)' }}>
        <img ref={img} src={image.url} alt="Photo to calibrate" onClick={click} style={{ width: '100%', display: 'block', userSelect: 'none' }} draggable={false} />
        <svg viewBox={`0 0 ${image.width} ${image.height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {[{ pts: ref, color: 'var(--info)' }, { pts: target, color: 'var(--accent-bright)' }].map(({ pts, color }, i) => (
            <g key={i}>
              {pts.length === 2 && <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke={color} strokeWidth={stroke * 1.5} />}
              {pts.map((p, k) => <circle key={k} cx={p.x} cy={p.y} r={stroke * 4} fill={color} stroke="var(--bg)" strokeWidth={stroke / 2} />)}
            </g>
          ))}
        </svg>
      </div>
      <div className="form-grid">
        <Field label="Reference length"><NumberInput value={refLen} min={0} onChange={setRefLen} /></Field>
        <Field label="Unit">
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>{['mm', 'cm', 'in'].map((u) => <option key={u}>{u}</option>)}</select>
        </Field>
        <Field label="This edge is the…">
          <select className="select" value={label} onChange={(e) => setLabel(e.target.value)}>{['length', 'width', 'thickness', 'height', 'diameter'].map((u) => <option key={u}>{u}</option>)}</select>
        </Field>
      </div>
      <div className="row-between">
        <div className="row">
          {value != null ? (
            <>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }} className="num">{value} {unit}</span>
              <Badge tone="info">Calibrated ±{uncertainty}%</Badge>
            </>
          ) : (
            <span className="muted small">{!refLen ? 'Enter the reference length.' : 'Click the points on the photo.'}</span>
          )}
        </div>
        <div className="row">
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset</Button>
          <Button size="sm" icon={Plus} disabled={value == null} onClick={() => { setMeasurements((m) => [...m, { label, value, unit, uncertainty }]); setTarget([]); }}>Keep & measure another edge</Button>
        </div>
      </div>
      {(measurements.length > 0 || value != null) && (
        <div className="card tight" style={{ background: 'var(--bg)' }}>
          <div className="row-between">
            <div className="row small">
              <Ruler size={14} className="muted" />
              {measurements.map((m, i) => <Badge key={i} tone="info">{m.label}: {m.value} {m.unit}</Badge>)}
              {value != null && <Badge tone="accent">{label}: {value} {unit} (current)</Badge>}
            </div>
            <Button size="sm" variant="primary" onClick={() => onUseMeasurement([...measurements, ...(value != null ? [{ label, value, unit, uncertainty }] : [])])}>Use for an item</Button>
          </div>
        </div>
      )}
      <p className="xs muted">Assumes the reference and the object are the same distance from the camera and the photo is taken square-on; tilt and lens distortion add error. Confirm with a tape measure before cutting.</p>
    </div>
  );
}
