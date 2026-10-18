// The Sell step: where to sell ONE product, a listing draft and a cautious price — from what
// the app already knows about the product (no questionnaire). The model writes the guide;
// costs and margins come from the deterministic economics, and nothing is presented as
// live-verified market data.
import { aiEnabled, aiConfigured, structured, AIError } from '../ai/client.js';
import { SellGuide } from '../ai/schemas.js';
import { SYSTEM_SELL } from '../ai/prompts.js';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Search pages whose URL format is stable and public. Used to check comparable listings —
// opening one is a search, not a connected account.
const COMPARE = [
  [/etsy/i, (q) => `https://www.etsy.com/search?q=${q}`],
  [/ebay/i, (q) => `https://www.ebay.com/sch/i.html?_nkw=${q}`],
  [/facebook/i, (q) => `https://www.facebook.com/marketplace/search/?query=${q}`],
  [/amazon/i, (q) => `https://www.amazon.com/s?k=${q}`],
];

/**
 * @param project  the project (name, idea, plan)
 * @param unit     deterministic per-unit costs: { productionCost, materialCash }
 * @param settings { region, currency }
 */
export async function generateSellGuide(project, unit, settings) {
  if (!aiEnabled()) {
    throw aiConfigured()
      ? new AIError('Selling suggestions come from the local AI, which is unavailable right now. Please try again shortly.', 503, 'ai_unavailable', true)
      : new AIError('Selling suggestions need the local AI model, which isn’t set up on this installation.', 503, 'ai_not_configured');
  }
  const idea = project.idea || {};
  const size = project.plan?.overall || idea.size || null;
  const materials = (idea.usesExisting || []).map((u) => u.inventoryName).filter(Boolean);
  const facts = {
    product: project.name,
    description: idea.summary || idea.description || '',
    sizeMm: size ? { length: size.length, width: size.width, height: size.height } : 'unknown',
    materials,
    region: settings.region || 'unspecified',
    currency: settings.currency,
    productionCostPerUnit: unit.productionCost > 0 ? r2(unit.productionCost) : 'unknown (materials owned, no prices entered)',
  };
  const guide = await structured({ system: SYSTEM_SELL, content: `Product (JSON):\n${JSON.stringify(facts)}\n\nWrite the selling guide.`, schema: SellGuide, effort: 'low', maxTokens: 900, label: 'sell guide' });

  const low = Math.max(0, r2(Math.min(guide.priceLow, guide.priceHigh)));
  const high = Math.max(low, r2(Math.max(guide.priceLow, guide.priceHigh)));
  const cost = unit.productionCost > 0 ? r2(unit.productionCost) : null;
  const q = encodeURIComponent(guide.listingTitle || project.name);
  return {
    kind: 'sell_guide',
    channels: guide.channels.slice(0, 3).map((c) => ({ ...c, compareUrl: COMPARE.find(([re]) => re.test(c.name))?.[1](q) || null })),
    listingTitle: guide.listingTitle.slice(0, 120),
    listingDescription: guide.listingDescription,
    price: { low, high, reason: guide.priceReason, verified: false },
    // Margin before platform fees, shipping and your time — fees differ per channel and were not looked up.
    costPerUnit: cost,
    // Of which cash to spend (materials you must buy); the rest is the value of materials you own.
    cashPerUnit: r2(unit.materialCash || 0),
    marginBeforeFees: cost != null && high > 0 ? { low: r2(low - cost), high: r2(high - cost) } : null,
    nextAction: guide.nextAction,
    basis: 'general guidance — prices and fees not checked against live listings',
    currency: settings.currency,
    generatedAt: new Date().toISOString(),
  };
}
