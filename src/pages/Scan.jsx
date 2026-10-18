import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanLine, Trash2, X, Ruler, Wand2, Pencil, Boxes, Plus, Eye, HelpCircle, Save, Check, AlertTriangle, RotateCcw, Camera, Sparkles, Lightbulb } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Card, Button, Badge, Banner, Field, NumberInput, Modal, Empty, LoadingBlock, DimensionTag, Tabs, Stagger, StaggerItem } from '../components/ui.jsx';
import { CameraCapture, normaliseImage, AI_MAX_SIDE } from '../components/Camera.jsx';
import { CalibrationTool } from '../components/Calibration.jsx';
import { InventoryItemForm, dimsSummary } from '../components/InventoryEditor.jsx';
import { checkImageQuality } from '../utils/imageQuality.js';
import { applyKnownMeasurement, METHOD_TO_STATUS, DIM_KEYS } from '../../shared/measure.js';
import { nameSimilarity, keyFor, matchesKey } from '../../shared/lexicon.js';

/** Method D: report real device support for depth-capable AR instead of assuming it. */
function useDepthSupport() {
  const [s, setS] = useState('checking');
  useEffect(() => {
    if (!navigator.xr?.isSessionSupported) return setS('unsupported');
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => setS(ok ? 'ar' : 'unsupported')).catch(() => setS('unsupported'));
  }, []);
  return s;
}

// Recommended photos per goal — starting points, never requirements.
const GOALS = [
  { id: 'identify', label: 'Identify', shots: ['One clear, well-lit photo'], hint: 'One photo is usually enough.' },
  { id: 'shape', label: 'Shape', shots: ['Front', 'Side', 'Top or another useful angle'], hint: 'Three angles help with form and proportions.' },
  { id: 'dimensions', label: 'Measure', shots: ['Overview with a ruler, tape or bank card beside it', 'Side view (shows thickness)', 'Top view', 'Close-up of any printed size'], hint: '3–4 views, one with something of known size.' },
  { id: 'inventory', label: 'Several items', shots: ['Wide overview of everything', 'Close-ups only where items overlap'], hint: 'One overview, plus close-ups if needed.' },
];

const METHOD_LABEL = { visible_marking: 'read from marking', reference_calibrated: 'scaled from reference', multi_view: 'from several views', ai_inferred: 'AI estimate', user_confirmed: 'your measurement' };

const toItem = (o) => {
  const d = o.dimensions || {};
  const hasDims = DIM_KEYS.some((k) => d[k]);
  return {
    name: o.name,
    material: o.material,
    category: o.category,
    quantity: o.quantity,
    unit: o.unit || 'pcs',
    condition: o.condition,
    potentialUses: o.potentialUses,
    notes: [o.shapeDescription, o.visibleMarkings && `Marking: ${o.visibleMarkings}`, o.missingInfo?.length ? `Missing info: ${o.missingInfo.join('; ')}` : '', o.requiresInspection ? 'Needs a closer look before use' : ''].filter(Boolean).join(' · ') || null,
    source: 'ai_scan',
    confidence: o.confidence,
    dimensions: hasDims
      ? { length: d.length, width: d.width, height: d.height, diameter: d.diameter, thickness: d.thickness, unit: d.unit, status: METHOD_TO_STATUS[d.method] || 'ai_inferred', uncertaintyPct: d.uncertaintyPct, method: d.reasoning?.slice(0, 200) }
      : null,
  };
};

/** Best existing inventory match for a detected item (possible duplicate). */
function findDuplicate(item, inventory) {
  let best = null;
  let bestScore = 0;
  const key = keyFor(`${item.name} ${item.material || ''}`);
  for (const inv of inventory) {
    let score = nameSimilarity(item.name, inv.name);
    if (key && matchesKey(inv, key)) score = Math.max(score, 0.7);
    if (score > bestScore) { best = inv; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}

function DetectedCard({ obj, onToggle, onEdit, onRemove, onMergeChange }) {
  const d = obj.item.dimensions;
  const method = obj.raw.dimensions?.method;
  return (
    <motion.div layout className="card" style={{ opacity: obj.include ? 1 : 0.55 }}>
      <div className="row-between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <label className="checkbox" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={obj.include} onChange={onToggle} style={{ marginTop: 3 }} />
          <span>
            <span className="strong">{obj.item.name}</span>
            <span className="small muted"> × {obj.item.quantity} {obj.item.unit}{!obj.raw.quantityCountable ? ' (approx.)' : ''}</span>
            <div className="small text-2">{obj.item.material} · {obj.item.condition || 'condition unknown'}</div>
          </span>
        </label>
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <Badge tone={obj.raw.confidence >= 0.75 ? 'ok' : obj.raw.confidence >= 0.5 ? 'info' : 'warn'}>{Math.round(obj.raw.confidence * 100)}%</Badge>
          <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label="Edit" />
          <Button size="sm" variant="ghost" icon={X} onClick={onRemove} aria-label="Remove" />
        </div>
      </div>
      {obj.raw.shapeDescription && <p className="xs muted" style={{ marginTop: 6 }}>{obj.raw.shapeDescription}</p>}
      <div className="row small" style={{ marginTop: 10 }}>
        <Ruler size={13} className="muted" />
        {d ? <span className="mono">{dimsSummary(d)}</span> : <span className="muted">No dimensions</span>}
        {d && <DimensionTag status={d.status} uncertainty={d.uncertaintyPct} />}
        {d && method && <span className="xs muted">{METHOD_LABEL[method] || method}</span>}
        {obj.raw.isReferenceObject && <Badge tone="info">Scale reference</Badge>}
        {obj.raw.requiresInspection && <Badge tone="warn" icon={AlertTriangle}>Check in person</Badge>}
      </div>
      {obj.raw.dimensions?.reasoning && <p className="xs muted" style={{ marginTop: 4 }}>{obj.raw.dimensions.reasoning}</p>}
      {obj.item.potentialUses?.length > 0 && <p className="xs text-2" style={{ marginTop: 6 }}>Uses: {obj.item.potentialUses.join(', ')}</p>}
      {obj.raw.missingInfo?.length > 0 && <p className="xs warn-text" style={{ marginTop: 4 }}>Needs: {obj.raw.missingInfo.join('; ')}</p>}
      {obj.duplicate && obj.include && (
        <div className="callout row small" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
          <span style={{ flex: 1 }}>Already in your inventory as <strong>{obj.duplicate.name}</strong> ({obj.duplicate.quantity} {obj.duplicate.unit}).</span>
          <select className="select input-sm" style={{ width: 'auto' }} value={obj.mergeIntoId ? 'merge' : 'new'} onChange={(e) => onMergeChange(e.target.value === 'merge' ? obj.duplicate.id : null)} aria-label="Duplicate handling">
            <option value="merge">Add quantity to it</option>
            <option value="new">Save as a new item</option>
          </select>
        </div>
      )}
    </motion.div>
  );
}

export default function Scan() {
  const { aiEnabled, health, toast, currency, setPageContext } = useApp();
  const inv = useApi('/inventory');
  const { busy, run } = useAction(toast);
  const nav = useNavigate();
  const depth = useDepthSupport();
  const [images, setImages] = useState([]);
  const [active, setActive] = useState(0);
  const [goal, setGoal] = useState('identify');
  const [hint, setHint] = useState('');
  const [known, setKnown] = useState({ objectName: '', dimension: 'length', value: null, unit: 'mm' });
  const [detected, setDetected] = useState(null);
  const [scanMeta, setScanMeta] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [measure, setMeasure] = useState(null); // in-review "enter one measurement"
  const [editing, setEditing] = useState(null); // {index} | {inventoryId} | {new: prefill}
  const [tab, setTab] = useState('capture');
  const items = useMemo(() => inv.data || [], [inv.data]);
  const goalDef = GOALS.find((g) => g.id === goal);

  useEffect(() => {
    setPageContext('scan', { goal, images: images.length, detected: detected?.map((d) => d.item), inventoryCount: inv.data?.length });
  }, [goal, images.length, detected, inv.data, setPageContext]);

  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addImage = (img) => {
    setImages((list) => {
      if (list.length >= 6) {
        toast('Up to 6 photos per scan.', 'error');
        return list;
      }
      setActive(list.length);
      return [...list, { ...img, quality: null }];
    });
    // Local quality check — advice only; nothing is uploaded for this.
    checkImageQuality(img.blob).then((quality) => setImages((list) => list.map((x) => (x.url === img.url ? { ...x, quality } : x))));
  };
  const removeImage = (i) => {
    URL.revokeObjectURL(images[i].url);
    setImages((l) => l.filter((_, k) => k !== i));
    setActive(0);
  };

  const prepare = (objects) =>
    objects.map((o) => {
      const item = toItem(o);
      const duplicate = findDuplicate(item, items);
      return { raw: o, item, include: !o.isReferenceObject, edited: false, duplicate, mergeIntoId: duplicate && nameSimilarity(item.name, duplicate.name) >= 0.8 ? duplicate.id : null };
    });

  async function analyse() {
    const fd = new FormData();
    // The full-size photos stay in the browser for measuring; a 1024 px copy is analysed.
    const small = await Promise.all(images.map((img) => normaliseImage(img.blob, AI_MAX_SIDE).then((r) => (URL.revokeObjectURL(r.url), r.blob))));
    small.forEach((blob, i) => fd.append('images', blob, `photo-${i}.jpg`));
    fd.append('goal', goal);
    if (hint) fd.append('hint', hint);
    if (known.objectName && known.value) fd.append('known', JSON.stringify(known));
    setScanning(true);
    setScanError(null);
    try {
      const r = await api.upload('/scan', fd);
      setDetected(prepare(r.objects));
      setScanMeta(r);
      setSaved(null);
      setTab('review');
    } catch (err) {
      setScanError(err); // photos stay in place so the user can retry
    } finally {
      setScanning(false);
    }
  }

  /** Apply one known measurement to the scan results (same maths as the server). */
  function applyMeasurement() {
    const { objects, applied, reason } = applyKnownMeasurement(detected.map((d) => d.raw), measure);
    if (!applied) return toast(reason || 'Could not apply that measurement.', 'error');
    setDetected((list) => list.map((d, i) => (d.edited ? { ...d, raw: objects[i] } : { ...d, raw: objects[i], item: { ...toItem(objects[i]) } })));
    setScanMeta((m) => ({ ...m, measurementRequests: (m.measurementRequests || []).filter((q) => q.objectName !== measure.objectName), knownMeasurementApplied: true }));
    toast('Measurement applied — sizes in the same photo were rescaled.');
    setMeasure(null);
  }

  async function saveDetected() {
    const chosen = detected.filter((d) => d.include);
    if (!chosen.length) return toast('Select at least one item.', 'error');
    await run('save', async () => {
      await api.post('/inventory/bulk', { items: chosen.map((d) => ({ ...d.item, mergeIntoId: d.mergeIntoId || null })) });
      await inv.reload();
      setSaved({ added: chosen.filter((d) => !d.mergeIntoId).length, merged: chosen.filter((d) => d.mergeIntoId).length, names: chosen.map((d) => d.item.name) });
      setDetected(null);
    });
  }

  function useMeasurements(ms) {
    const dims = { unit: ms[0].unit, status: 'reference_calibrated', uncertaintyPct: Math.max(...ms.map((m) => m.uncertainty || 10)) };
    for (const m of ms) dims[m.label] = m.value;
    setEditing({ new: { name: '', dimensions: dims } });
  }

  const current = images[active];
  const qualityIssues = images.flatMap((img, i) => (img.quality?.issues || []).map((q) => ({ ...q, photo: i + 1 })));
  const aiState = health?.ai?.status;

  return (
    <Page eyebrow="Scan" title="Show us what you have" sub="Every measurement says how it was obtained.">
      {health && !aiEnabled && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warn">
            {aiState?.configured
              ? 'Photo recognition is temporarily unavailable on this installation.'
              : 'Photo recognition isn’t set up on this installation yet.'}{' '}
            You can still take photos, <strong>measure objects with the calibration tool</strong>, and add items by hand — nothing is faked.
          </Banner>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'capture', label: 'Capture', icon: ScanLine, badge: images.length || null },
          { id: 'measure', label: 'Measure', icon: Ruler },
          { id: 'review', label: 'Review detections', icon: Eye, badge: detected?.length ?? null },
          { id: 'inventory', label: 'My inventory', icon: Boxes, badge: items.length || null },
        ]}
      />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {tab === 'capture' && (
            <div className="grid g-main" style={{ alignItems: 'start' }}>
              <Card>
                <AnimatePresence>
                  {scanning && (
                    <motion.div className="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status" aria-live="polite">
                      <div className="analyzing-thumbs">
                        {images.map((img, i) => (
                          <motion.div key={img.url} className="analyzing-thumb" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.08 }}>
                            <img src={img.url} alt="" />
                            <motion.span className="scan-line" initial={{ top: '0%' }} animate={{ top: ['0%', '100%', '0%'] }} transition={{ repeat: Infinity, duration: 2, delay: i * 0.2, ease: 'easeInOut' }} />
                          </motion.div>
                        ))}
                      </div>
                      <div className="row"><span className="spinner" />Identifying objects in {images.length} photo{images.length === 1 ? '' : 's'}…</div>
                      <span className="xs muted">Waiting for the vision model — usually 10–40 seconds.</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <CameraCapture onCapture={addImage} disabled={scanning} />
                {images.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="label" style={{ marginBottom: 8 }}>Photos in this scan ({images.length}/6)</div>
                    <div className="thumbs">
                      {images.map((img, i) => (
                        <div key={img.url} className={`thumb ${i === active ? 'active' : ''}`} onClick={() => setActive(i)} title={img.quality?.issues?.map((q) => q.text).join(' ') || undefined}>
                          <img src={img.url} alt={`Captured photo ${i + 1}`} />
                          {img.quality && !img.quality.ok && <span className="badge badge-warn" style={{ position: 'absolute', left: 3, bottom: 3, height: 18, padding: '0 5px' }}><AlertTriangle size={10} /></span>}
                          <button className="btn btn-sm btn-icon" style={{ width: 22, height: 22 }} onClick={(e) => { e.stopPropagation(); removeImage(i); }} aria-label={`Remove photo ${i + 1}`}><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                    {qualityIssues.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <Banner tone="warn">
                          {qualityIssues.map((q) => <div key={`${q.photo}-${q.code}`}>Photo {q.photo}: {q.text}</div>)}
                          <div className="xs muted" style={{ marginTop: 4 }}>You can keep it, or remove it and take another.</div>
                        </Banner>
                      </div>
                    )}
                  </div>
                )}
                {scanError && !scanning && (
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="danger">
                      <div className="row-between">
                        <span>{scanError.message}</span>
                        {(scanError.retryable || scanError.code === 'network') && <Button size="sm" icon={RotateCcw} onClick={analyse}>Try again</Button>}
                      </div>
                      <div className="xs muted" style={{ marginTop: 4 }}>Your photos are still here.</div>
                    </Banner>
                  </div>
                )}
              </Card>
              <div className="stack">
                <Card title="What do you need?" sub={goalDef.hint}>
                  <div className="stack">
                    <div className="row" style={{ gap: 6 }}>
                      {GOALS.map((g) => (
                        <button key={g.id} type="button" className={`chip ${goal === g.id ? 'active' : ''}`} aria-pressed={goal === g.id} onClick={() => setGoal(g.id)}>{g.label}</button>
                      ))}
                    </div>
                    <ul className="list-plain stack" style={{ gap: 6 }} aria-label="Suggested photos">
                      {goalDef.shots.map((s, i) => {
                        const done = images.length > i;
                        return (
                          <li key={s} className="row small" style={{ flexWrap: 'nowrap', color: done ? 'var(--text)' : 'var(--text-2)' }}>
                            <span className="step-num" style={{ width: 20, height: 20, fontSize: 10, ...(done ? { background: 'var(--ok)', borderColor: 'var(--ok)', color: 'var(--bg)' } : {}) }}>{done ? <Check size={11} /> : i + 1}</span>
                            {s}
                          </li>
                        );
                      })}
                    </ul>
                    <hr className="divider" style={{ margin: '4px 0' }} />
                    <Field label="Optional note to the AI" hint="e.g. boards are pine, all the same size"><input className="input" maxLength={1000} value={hint} onChange={(e) => setHint(e.target.value)} /></Field>
                    <div className="label">One known measurement (optional)</div>
                    <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <input className="input" placeholder="Object, e.g. board" value={known.objectName} onChange={(e) => setKnown({ ...known, objectName: e.target.value })} maxLength={120} aria-label="Object with known measurement" />
                      <select className="select" value={known.dimension} onChange={(e) => setKnown({ ...known, dimension: e.target.value })} aria-label="Dimension">{['length', 'width', 'thickness', 'height', 'diameter'].map((d) => <option key={d}>{d}</option>)}</select>
                      <NumberInput value={known.value} min={0} onChange={(v) => setKnown({ ...known, value: v })} placeholder="Value" aria-label="Measured value" />
                      <select className="select" value={known.unit} onChange={(e) => setKnown({ ...known, unit: e.target.value })} aria-label="Unit">{['mm', 'cm', 'in'].map((d) => <option key={d}>{d}</option>)}</select>
                    </div>
                    <div className="row xs muted"><HelpCircle size={12} />Depth sensing: {depth === 'checking' ? 'checking…' : depth === 'ar' ? 'WebXR AR is available on this device, but depth measurement is not used in this version.' : 'not available in this browser/device — using photo-based methods.'}</div>
                  </div>
                </Card>
                <Button variant="primary" size="lg" icon={Wand2} disabled={!images.length || !aiEnabled} loading={scanning} onClick={analyse}>
                  {aiEnabled ? `Identify objects in ${images.length || ''} photo${images.length === 1 ? '' : 's'}` : 'Photo recognition unavailable'}
                </Button>
                <Button icon={Ruler} disabled={!images.length} onClick={() => setTab('measure')}>Measure manually in a photo</Button>
                <Button variant="ghost" icon={Plus} onClick={() => setEditing({ new: {} })}>Add an item by hand</Button>
                <p className="xs muted">Photos are resized in your browser, sent only for analysis, and never stored on the server.</p>
              </div>
            </div>
          )}

          {tab === 'measure' && (
            current ? (
              <div className="grid g-main" style={{ alignItems: 'start' }}>
                <Card title="Calibrate & measure (Method E)" sub={`Photo ${active + 1} of ${images.length}`}>
                  <CalibrationTool key={current.url} image={current} onUseMeasurement={useMeasurements} />
                </Card>
                <Card title="Photos">
                  <div className="thumbs">
                    {images.map((img, i) => (
                      <div key={img.url} className={`thumb ${i === active ? 'active' : ''}`} onClick={() => setActive(i)}><img src={img.url} alt={`Photo ${i + 1}`} /></div>
                    ))}
                  </div>
                </Card>
              </div>
            ) : (
              <Empty icon={Ruler} title="No photo to measure" action={<Button onClick={() => setTab('capture')}>Capture a photo</Button>}>Take or upload a photo that includes a reference object of known size.</Empty>
            )
          )}

          {tab === 'review' && (
            detected ? (
              <div className="stack-lg">
                {scanMeta?.knownMeasurementApplied && <Banner tone="info">Sizes in the same photo were rescaled from your measurement. Calibrated values assume a similar distance from the camera.</Banner>}
                {scanMeta?.referenceObjectFound && <Banner tone="ok">Scale reference found: {scanMeta.referenceDescription}</Banner>}
                {scanMeta?.scaleStatus === 'none' && !scanMeta?.knownMeasurementApplied && (
                  <Banner tone="warn">No scale in these photos, so sizes are rough AI estimates. Enter one real measurement below before using them for cutting.</Banner>
                )}

                {(scanMeta?.measurementRequests?.length > 0 || scanMeta?.additionalViews?.length > 0) && (
                  <Card title="To improve accuracy" sub="Only what would make a real difference">
                    <div className="stack">
                      {scanMeta.measurementRequests?.map((q) => (
                        <div key={`${q.objectName}-${q.dimension}`} className="row small" style={{ flexWrap: 'nowrap' }}>
                          <Ruler size={14} className="accent-text" />
                          <span style={{ flex: 1 }}>Measure the <strong>{q.dimension}</strong> of <strong>{q.objectName}</strong> — {q.reason}</span>
                          <Button size="sm" onClick={() => setMeasure({ objectName: q.objectName, dimension: q.dimension, value: null, unit: 'mm' })}>Enter it</Button>
                        </div>
                      ))}
                      {scanMeta.additionalViews?.map((v) => (
                        <div key={v.view} className="row small" style={{ flexWrap: 'nowrap' }}>
                          <Camera size={14} className="accent-text" />
                          <span style={{ flex: 1 }}>Add a <strong>{v.view}</strong>{v.forObject ? ` of ${v.forObject}` : ''} — {v.reason}</span>
                          <Button size="sm" onClick={() => setTab('capture')}>Add photo</Button>
                        </div>
                      ))}
                      {!scanMeta.measurementRequests?.length && <Button size="sm" variant="ghost" icon={Ruler} style={{ alignSelf: 'flex-start' }} onClick={() => setMeasure({ objectName: detected[0]?.item.name || '', dimension: 'length', value: null, unit: 'mm' })}>Enter a measurement</Button>}
                    </div>
                  </Card>
                )}
                {scanMeta?.questionsForUser?.length > 0 && <p className="small text-2"><Lightbulb size={13} style={{ verticalAlign: -2 }} /> {scanMeta.questionsForUser.join(' ')}</p>}

                <Stagger className="grid g-2">
                  {detected.map((d, i) => (
                    <StaggerItem key={i}>
                      <DetectedCard
                        obj={d}
                        onToggle={() => setDetected((list) => list.map((x, k) => (k === i ? { ...x, include: !x.include } : x)))}
                        onEdit={() => setEditing({ index: i })}
                        onRemove={() => setDetected((list) => list.filter((_, k) => k !== i))}
                        onMergeChange={(id) => setDetected((list) => list.map((x, k) => (k === i ? { ...x, mergeIntoId: id } : x)))}
                      />
                    </StaggerItem>
                  ))}
                </Stagger>
                <div className="row">
                  <Button variant="primary" icon={Save} loading={busy === 'save'} onClick={saveDetected}>Save {detected.filter((d) => d.include).length} confirmed item(s)</Button>
                  <Button variant="ghost" onClick={() => setDetected(null)}>Discard</Button>
                </div>
              </div>
            ) : saved ? (
              <Card className="ws-hero">
                <div className="stack" style={{ alignItems: 'flex-start' }}>
                  <Badge tone="ok" icon={Check}>Saved to your inventory</Badge>
                  <h2>{saved.added} new{saved.merged ? `, ${saved.merged} merged into existing items` : ''}.</h2>
                  <p className="text-2">{saved.names.join(', ')}</p>
                  <div className="row">
                    <Button variant="primary" icon={Sparkles} onClick={() => nav('/app/create', { state: { fromScan: saved.names } })}>Find products I can make</Button>
                    <Button icon={Boxes} onClick={() => setTab('inventory')}>View inventory</Button>
                    <Button variant="ghost" icon={Camera} onClick={() => { setSaved(null); setTab('capture'); }}>Scan more</Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Empty icon={Eye} title="Nothing to review yet" action={<Button onClick={() => setTab('capture')}>Capture photos</Button>}>Detected objects appear here as editable cards before anything is saved.</Empty>
            )
          )}

          {tab === 'inventory' && (
            <Card title="Material inventory" sub="Used to generate product ideas and build plans" actions={<Button size="sm" icon={Plus} onClick={() => setEditing({ new: {} })}>Add item</Button>}>
              {inv.loading && <LoadingBlock />}
              {!inv.loading && !items.length && <Empty icon={Boxes} title="Inventory is empty">Scan or add the materials you own.</Empty>}
              {items.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Item</th><th className="num">Qty</th><th>Dimensions</th><th className="hide-sm">Source</th><th /></tr></thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td><div className="strong">{i.name}</div><div className="xs muted">{i.material}{i.condition ? ` · ${i.condition}` : ''}</div></td>
                          <td className="num">{i.quantity} {i.unit}</td>
                          <td>{i.dimensions ? <div className="stack" style={{ gap: 4 }}><span className="mono xs">{dimsSummary(i.dimensions)}</span><DimensionTag status={i.dimensions.status} uncertainty={i.dimensions.uncertaintyPct} /></div> : <span className="muted small">—</span>}</td>
                          <td className="hide-sm">{i.source === 'ai_scan' ? <Badge tone="info">AI scan, confirmed</Badge> : <Badge>Manual</Badge>}</td>
                          <td className="right nowrap">
                            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing({ inventoryId: i.id })} aria-label={`Edit ${i.name}`} />
                            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run('del', async () => { await api.del(`/inventory/${i.id}`); await inv.reload(); }, 'Item removed')} aria-label={`Delete ${i.name}`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      <Modal
        open={Boolean(measure)}
        onClose={() => setMeasure(null)}
        title="Enter one real measurement"
        footer={<><Button variant="ghost" onClick={() => setMeasure(null)}>Cancel</Button><Button variant="primary" disabled={!measure?.value || !measure?.objectName} onClick={applyMeasurement}>Apply</Button></>}
      >
        {measure && (
          <div className="stack">
            <p className="small text-2">Measure one object with a tape. Other sizes in the same photo are rescaled from it and marked as calibrated.</p>
            <div className="form-grid">
              <Field label="Object">
                <select className="select" value={measure.objectName} onChange={(e) => setMeasure({ ...measure, objectName: e.target.value })}>
                  {detected?.map((d) => <option key={d.raw.name}>{d.raw.name}</option>)}
                </select>
              </Field>
              <Field label="Dimension"><select className="select" value={measure.dimension} onChange={(e) => setMeasure({ ...measure, dimension: e.target.value })}>{DIM_KEYS.map((k) => <option key={k}>{k}</option>)}</select></Field>
              <Field label="Value"><NumberInput value={measure.value} min={0} onChange={(v) => setMeasure({ ...measure, value: v })} /></Field>
              <Field label="Unit"><select className="select" value={measure.unit} onChange={(e) => setMeasure({ ...measure, unit: e.target.value })}>{['mm', 'cm', 'in'].map((u) => <option key={u}>{u}</option>)}</select></Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} wide title={editing?.index != null ? 'Correct detected item' : editing?.inventoryId ? 'Edit inventory item' : 'Add inventory item'}>
        {editing && (
          <InventoryItemForm
            currency={currency}
            initial={editing.index != null ? detected[editing.index].item : editing.inventoryId ? items.find((i) => i.id === editing.inventoryId) : editing.new}
            busy={busy === 'edit'}
            submitLabel={editing.index != null ? 'Apply correction' : 'Save item'}
            onCancel={() => setEditing(null)}
            onSubmit={(item) => {
              if (editing.index != null) {
                setDetected((list) => list.map((x, k) => (k === editing.index ? { ...x, item: { ...item, source: 'ai_scan' }, include: true, edited: true } : x)));
                setEditing(null);
              } else if (editing.inventoryId) {
                run('edit', async () => { await api.put(`/inventory/${editing.inventoryId}`, item); await inv.reload(); setEditing(null); }, 'Item updated');
              } else {
                run('edit', async () => { await api.post('/inventory', item); await inv.reload(); setEditing(null); setTab('inventory'); }, 'Item added');
              }
            }}
          />
        )}
      </Modal>
    </Page>
  );
}
