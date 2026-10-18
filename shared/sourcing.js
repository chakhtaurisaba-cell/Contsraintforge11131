// Deterministic comparison of purchase options. "Best" is not simply the lowest
// sticker price: it accounts for pack size, waste, shipping, delivery and fit.

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function evaluateOption(option, quantityNeeded) {
  const price = n(option.price);
  const pack = n(option.packQuantity) || 1;
  const shipping = n(option.shippingCost) ?? 0;
  if (price == null) return { ...option, packsNeeded: null, totalCost: null, wasteUnits: null, comparable: false };
  const packsNeeded = Math.max(1, Math.ceil(quantityNeeded / pack));
  const totalCost = Math.round((packsNeeded * price + shipping) * 100) / 100;
  const wasteUnits = packsNeeded * pack - quantityNeeded;
  return {
    ...option,
    packsNeeded,
    totalCost,
    wasteUnits: Math.round(wasteUnits * 100) / 100,
    costPerNeededUnit: Math.round((totalCost / quantityNeeded) * 100) / 100,
    comparable: true,
  };
}

/** Ranks options; returns {ranked, bestId, reasons}. */
export function compareOptions(options, quantityNeeded, { currency } = {}) {
  const evaluated = options.map((o) => evaluateOption(o, quantityNeeded));
  const comparable = evaluated.filter((o) => o.comparable && (!currency || !o.currency || o.currency === currency));
  if (!comparable.length) return { ranked: evaluated, bestId: null, reasons: ['No options with a price in your currency to compare yet.'] };
  const minCost = Math.min(...comparable.map((o) => o.totalCost));
  const scored = comparable.map((o) => {
    let score = 100 * (minCost / o.totalCost);
    if (o.compatible === false) score -= 40;
    const days = n(o.deliveryDays);
    if (days != null) score -= Math.min(20, Math.max(0, days - 3) * 1.5);
    if (o.wasteUnits > quantityNeeded) score -= 5;
    return { ...o, score: Math.round(score) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const reasons = [
    `Lowest total including shipping: ${minCost}${currency ? ` ${currency}` : ''}.`,
    best.totalCost === minCost ? 'The recommended option is also the cheapest in total.' : `Recommended option costs ${Math.round((best.totalCost - minCost) * 100) / 100} more but scores higher on delivery time or compatibility.`,
  ];
  if (best.wasteUnits > 0) reasons.push(`It leaves ${best.wasteUnits} spare unit(s) from the pack size.`);
  const unranked = evaluated.filter((o) => !scored.find((s) => s.id === o.id));
  return { ranked: [...scored, ...unranked], bestId: best.id, reasons };
}

/** Outbound search links (not listings) for manual price research. */
export function searchLinks(query, region) {
  const q = encodeURIComponent(query);
  const links = [
    { label: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${q}` },
    { label: 'Google (local)', url: `https://www.google.com/search?q=${q}${region === 'GE' ? '+tbilisi+buy' : '+buy'}` },
    { label: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
    { label: 'Amazon', url: `https://www.amazon.com/s?k=${q}` },
  ];
  return links;
}
