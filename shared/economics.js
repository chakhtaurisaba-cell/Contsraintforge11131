// Deterministic unit-economics engine shared by the server and the browser.
// All money values are in the project currency. Nothing here calls an AI model:
// AI may *propose* inputs (e.g. estimated prices) but every total is computed here.

export const DEFAULT_ECONOMICS = {
  price: 0,
  batchQty: 10,
  packagingPerUnit: 0,
  laborMinutesPerUnit: 0,
  laborRatePerHour: 0,
  includeLabor: false,
  includeOwnedValue: true, // count replacement value of materials you already own
  shippingPerUnit: 0, // seller-paid shipping / fulfilment per unit sold
  marketplaceFeePct: 0,
  marketplaceFixedFee: 0,
  paymentFeePct: 0,
  paymentFixedFee: 0,
  adSpendPerUnit: 0,
  returnRatePct: 0,
  otherFixedCosts: 0, // one-off costs for the batch (tools, jigs, samples)
};

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Material cost for ONE finished unit from bill-of-materials lines.
 * BOM line: { name, quantity (per unit), unitPrice, owned (bool), ownedQuantity }
 */
export function materialCosts(bom = []) {
  let cash = 0;
  let ownedValue = 0;
  // Optional upgrades are not part of the design's cost unless explicitly included.
  const lines = bom.filter((line) => !line.optional || line.included).map((line) => {
    const qty = n(line.quantity);
    const price = n(line.unitPrice);
    const lineTotal = qty * price;
    // ownedFraction (from the reuse-first allocation) splits a partly-owned line into owned value + cash to buy.
    const f = line.ownedFraction != null ? Math.max(0, Math.min(1, Number(line.ownedFraction))) : line.owned ? 1 : 0;
    ownedValue += lineTotal * f;
    cash += lineTotal * (1 - f);
    return { name: line.name, qty, price, lineTotal: r2(lineTotal), owned: f >= 1, ownedFraction: f };
  });
  return { cashPerUnit: r2(cash), ownedValuePerUnit: r2(ownedValue), totalPerUnit: r2(cash + ownedValue), lines };
}

/** Fees charged by marketplace + payment processor for one unit at `price`. */
export function feesAt(price, e) {
  return (
    price * (n(e.marketplaceFeePct) + n(e.paymentFeePct)) / 100 + n(e.marketplaceFixedFee) + n(e.paymentFixedFee)
  );
}

/**
 * Full unit economics. Definitions (documented in the UI):
 *  materialPerUnit  = cash materials + (owned materials if includeOwnedValue)
 *  productionCost   = materialPerUnit + packaging + labour (if included)       -> "COGS"
 *  variableSelling  = shipping + advertising per unit
 *  fees             = price × (marketplace% + payment%) + fixed fees
 *  expectedRefunds  = price × returnRate   (refunded revenue; fees assumed non-refundable)
 *  grossProfit      = price − productionCost
 *  netProfit        = price − expectedRefunds − fees − productionCost − variableSelling
 *  breakEvenPrice   = (productionCost + variableSelling + fixedFees) / (1 − returnRate − feePct)
 *  breakEvenQty     = otherFixedCosts / netProfit (only when netProfit > 0)
 */
export function computeEconomics(bom, inputs = {}) {
  const e = { ...DEFAULT_ECONOMICS, ...inputs };
  const mat = materialCosts(bom);
  const price = n(e.price);
  const materialPerUnit = mat.cashPerUnit + (e.includeOwnedValue ? mat.ownedValuePerUnit : 0);
  const labor = e.includeLabor ? (n(e.laborMinutesPerUnit) / 60) * n(e.laborRatePerHour) : 0;
  const productionCost = materialPerUnit + n(e.packagingPerUnit) + labor;
  const variableSelling = n(e.shippingPerUnit) + n(e.adSpendPerUnit);
  const fees = feesAt(price, e);
  const returnRate = n(e.returnRatePct) / 100;
  const refunds = price * returnRate;
  const grossProfit = price - productionCost;
  const netProfit = price - refunds - fees - productionCost - variableSelling;
  const feePct = (n(e.marketplaceFeePct) + n(e.paymentFeePct)) / 100;
  const fixedFees = n(e.marketplaceFixedFee) + n(e.paymentFixedFee);
  const denom = 1 - returnRate - feePct;
  const breakEvenPrice = denom > 0 ? (productionCost + variableSelling + fixedFees) / denom : null;
  const breakEvenQty = netProfit > 0 ? Math.ceil(n(e.otherFixedCosts) / netProfit) : null;

  const batchQty = Math.max(0, Math.round(n(e.batchQty)));
  // Cash needed to produce a batch: only materials you must buy + packaging + one-off costs.
  const batchCashOutlay = batchQty * (mat.cashPerUnit + n(e.packagingPerUnit)) + n(e.otherFixedCosts);

  return {
    inputs: e,
    material: mat,
    perUnit: {
      materialCash: r2(mat.cashPerUnit),
      materialOwnedValue: r2(mat.ownedValuePerUnit),
      material: r2(materialPerUnit),
      packaging: r2(n(e.packagingPerUnit)),
      labor: r2(labor),
      productionCost: r2(productionCost),
      shipping: r2(n(e.shippingPerUnit)),
      ads: r2(n(e.adSpendPerUnit)),
      fees: r2(fees),
      refunds: r2(refunds),
      fullCost: r2(productionCost + variableSelling + fees + refunds),
      grossProfit: r2(grossProfit),
      netProfit: r2(netProfit),
      grossMarginPct: price > 0 ? r2((grossProfit / price) * 100) : null,
      netMarginPct: price > 0 ? r2((netProfit / price) * 100) : null,
    },
    breakEvenPrice: r2(breakEvenPrice),
    breakEvenQty,
    batch: {
      qty: batchQty,
      cashOutlay: r2(batchCashOutlay),
      netProfitIfAllSold: r2(batchQty * netProfit - n(e.otherFixedCosts)),
    },
  };
}

/** Net profit per unit across a range of prices (for sensitivity charts). */
export function priceSensitivity(bom, inputs, prices) {
  return prices.map((p) => {
    const r = computeEconomics(bom, { ...inputs, price: p });
    return { price: r2(p), netProfit: r.perUnit.netProfit, netMarginPct: r.perUnit.netMarginPct };
  });
}

/** Profit for a batch when only some of it sells (inventory exposure). */
export function volumeScenarios(bom, inputs, soldCounts) {
  const base = computeEconomics(bom, inputs);
  const e = base.inputs;
  return soldCounts.map((sold) => {
    const revenue = sold * n(e.price);
    const sellingCosts = sold * (base.perUnit.fees + base.perUnit.shipping + base.perUnit.ads + base.perUnit.refunds);
    const productionTotal = base.batch.qty * base.perUnit.productionCost + n(e.otherFixedCosts);
    return {
      sold,
      unsold: Math.max(0, base.batch.qty - sold),
      revenue: r2(revenue),
      profit: r2(revenue - sellingCosts - productionTotal),
    };
  });
}

/** Simulate a change in batch size: cash outlay and unsold-inventory exposure. */
export function simulateBatchChange(bom, inputs, { fromQty, toQty, expectedSales }) {
  const before = computeEconomics(bom, { ...inputs, batchQty: fromQty });
  const after = computeEconomics(bom, { ...inputs, batchQty: toQty });
  const unsoldBefore = Math.max(0, fromQty - expectedSales);
  const unsoldAfter = Math.max(0, toQty - expectedSales);
  return {
    cashOutlayBefore: before.batch.cashOutlay,
    cashOutlayAfter: after.batch.cashOutlay,
    cashSaved: r2(before.batch.cashOutlay - after.batch.cashOutlay),
    unsoldBefore,
    unsoldAfter,
    inventoryExposureBefore: r2(unsoldBefore * before.perUnit.productionCost),
    inventoryExposureAfter: r2(unsoldAfter * after.perUnit.productionCost),
  };
}

/** Simulate a price change at an assumed sales volume. */
export function simulatePriceChange(bom, inputs, { newPrice, unitsBefore, unitsAfter }) {
  const before = computeEconomics(bom, inputs);
  const after = computeEconomics(bom, { ...inputs, price: newPrice });
  return {
    netPerUnitBefore: before.perUnit.netProfit,
    netPerUnitAfter: after.perUnit.netProfit,
    marginBefore: before.perUnit.netMarginPct,
    marginAfter: after.perUnit.netMarginPct,
    profitBefore: r2(before.perUnit.netProfit * unitsBefore),
    profitAfter: r2(after.perUnit.netProfit * unitsAfter),
  };
}

export const money = (v, currency = 'GEL') => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${Number(v).toFixed(2)} ${currency}`;
  }
};
