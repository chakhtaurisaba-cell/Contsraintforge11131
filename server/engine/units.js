// Unit conversion and the demo engine's static price table.

export const toMM = (value, unit = 'mm') => {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  return { mm: v, cm: v * 10, m: v * 1000, in: v * 25.4, ft: v * 304.8 }[unit] ?? v;
};

export const roundTo = (v, step = 1) => Math.round(v / step) * step;

// Approximate static conversion used ONLY to express demo placeholder prices in the
// user's currency. Never presented as live exchange rates.
const USD_TO = { USD: 1, GEL: 2.7, EUR: 0.92, GBP: 0.79, TRY: 41, UAH: 41.5, PLN: 3.9, CAD: 1.37, AUD: 1.52 };
export const fromUSD = (usd, currency = 'USD') => Math.round(usd * (USD_TO[currency] ?? 1) * 100) / 100;

/** Normalised dimensions (mm) of an inventory item, plus how trustworthy they are. */
export function itemDimsMM(item) {
  const d = item?.dimensions;
  if (!d) return null;
  const unit = d.unit || 'mm';
  const out = {
    length: toMM(d.length, unit),
    width: toMM(d.width, unit),
    height: toMM(d.height, unit),
    thickness: toMM(d.thickness, unit),
    diameter: toMM(d.diameter, unit),
    status: d.status || d.method || 'user_confirmed',
  };
  return out;
}
