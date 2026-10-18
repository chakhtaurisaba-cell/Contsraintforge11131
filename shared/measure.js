// Measurement helpers shared by the server (scan pipeline) and the browser
// (post-scan "enter one known measurement" calibration).

const FACTORS = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
export const toMM = (value, unit = 'mm') => (value == null || !Number.isFinite(Number(value)) ? null : Number(value) * (FACTORS[unit] ?? 1));
export const DIM_KEYS = ['length', 'width', 'height', 'diameter', 'thickness'];

// Scan method → provenance status stored on the inventory item.
export const METHOD_TO_STATUS = {
  visible_marking: 'from_marking',
  reference_calibrated: 'reference_calibrated',
  multi_view: 'ai_inferred',
  ai_inferred: 'ai_inferred',
  user_confirmed: 'user_confirmed',
};

/**
 * Method B — one user-provided measurement calibrates the scene. Objects seen in the
 * same photo(s) as the reference are rescaled by known/estimated; the reference itself
 * becomes user-confirmed. Assumes a similar distance from the camera, so the result is
 * labelled "calibrated" with an uncertainty, never "verified".
 * @param objects detected objects: {name, imageIndex, seenInImages?, dimensions:{...,unit,method,uncertaintyPct}}
 * @param known   {objectName, dimension, value, unit}
 */
export function applyKnownMeasurement(objects, known) {
  if (!known?.objectName || !(Number(known.value) > 0)) return { objects, applied: false, reason: 'No measurement given.' };
  const target = known.objectName.toLowerCase();
  const ref = objects.find((o) => o.name.toLowerCase() === target) || objects.find((o) => o.name.toLowerCase().includes(target) || target.includes(o.name.toLowerCase()));
  if (!ref) return { objects, applied: false, reason: `“${known.objectName}” was not found among the detected items.` };
  const dimKey = known.dimension || 'length';
  const knownMM = toMM(known.value, known.unit || 'mm');
  const est = toMM(ref.dimensions?.[dimKey], ref.dimensions?.unit);
  const refImages = new Set([ref.imageIndex, ...(ref.seenInImages || [])]);
  const factor = est ? knownMM / est : null;
  const out = objects.map((o) => {
    const d = { ...o.dimensions };
    if (o === ref) {
      for (const k of DIM_KEYS) if (d[k] != null && factor) d[k] = Math.round(toMM(d[k], d.unit) * factor * 10) / 10;
      else if (d[k] != null) d[k] = toMM(d[k], d.unit);
      d.unit = 'mm';
      d[dimKey] = knownMM;
      // One label per item: only "user confirmed" if every size it has came from the user.
      const derived = DIM_KEYS.some((k) => k !== dimKey && d[k] != null);
      return {
        ...o,
        dimensions: {
          ...d,
          method: derived ? 'reference_calibrated' : 'user_confirmed',
          uncertaintyPct: derived ? Math.max(10, Math.round((o.dimensions.uncertaintyPct || 20) / 2)) : 0,
          reasoning: derived ? `${dimKey} ${knownMM} mm entered by you; its other sizes are scaled from it — confirm them before cutting.` : `${dimKey} entered by you (${knownMM} mm).`,
          confirmedDims: [dimKey],
        },
      };
    }
    const shares = [o.imageIndex, ...(o.seenInImages || [])].some((i) => refImages.has(i));
    if (!factor || !shares || ['user_confirmed', 'visible_marking'].includes(d.method)) return o;
    for (const k of DIM_KEYS) if (d[k] != null) d[k] = Math.round(toMM(d[k], d.unit) * factor * 10) / 10;
    d.unit = 'mm';
    return { ...o, dimensions: { ...d, method: 'reference_calibrated', uncertaintyPct: Math.max(15, Math.round((d.uncertaintyPct || 30) / 2)), reasoning: `Scaled ×${factor.toFixed(2)} from your measurement of “${ref.name}”. Assumes a similar distance from the camera.` } };
  });
  return { objects: out, applied: true, factor };
}
