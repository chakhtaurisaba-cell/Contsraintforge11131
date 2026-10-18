// Live supplier search. Uses the app's web search (ai/search.js); every returned listing URL is
// cross-checked against the URLs the search tool actually returned, and anything
// that cannot be matched is discarded. Without AI, no listings are produced — the
// user gets outbound search links and can record quotes manually.
import { aiEnabled, webResearch, normalizeUrl } from '../ai/client.js';
import { searchAvailable } from '../ai/search.js';
import { SourcingResult } from '../ai/schemas.js';
import { SYSTEM_SOURCING } from '../ai/prompts.js';
import { searchLinks } from '../../shared/sourcing.js';
import { uid } from '../db.js';

const REGION_CITY = { GE: { country: 'GE', city: 'Tbilisi' }, US: { country: 'US' }, GB: { country: 'GB' }, DE: { country: 'DE' }, TR: { country: 'TR' }, PL: { country: 'PL' }, UA: { country: 'UA' }, CA: { country: 'CA' }, AU: { country: 'AU' } };

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function searchSuppliers(item, { region, currency, quantity }) {
  const query = [item.name, item.spec].filter(Boolean).join(' ');
  const links = searchLinks(query, region);
  if (!aiEnabled() || !searchAvailable()) {
    return {
      engine: 'none',
      live: false,
      options: [],
      links,
      retrievedAt: null,
      note: 'Live supplier search isn’t available right now. Use the search links and add the prices you find to compare them.',
    };
  }
  const prompt = `Find where to buy: "${item.name}"${item.spec ? ` (spec: ${item.spec})` : ''}. Quantity needed: ${quantity} ${item.unit || 'pcs'}. Buyer region: ${region}. Preferred currency: ${currency}. Find 3-6 real listings, preferring sellers that deliver to the buyer region.`;
  const { text, sources } = await webResearch({ system: SYSTEM_SOURCING, prompt, userLocation: REGION_CITY[region], schema: SourcingResult });
  const parsed = SourcingResult.safeParse(extractJSON(text));
  if (!parsed.success) {
    return { engine: 'ai_web_search', live: true, options: [], links, retrievedAt: new Date().toISOString(), note: 'The search completed but returned no usable structured listings. Use the search links below.' };
  }
  let dropped = 0;
  const options = [];
  for (const o of parsed.data.options) {
    const match = sources.get(normalizeUrl(o.url));
    if (!match) {
      dropped += 1;
      continue;
    }
    options.push({
      id: uid(),
      title: o.title,
      supplier: o.supplier,
      url: match.url,
      price: o.price,
      currency: o.currency,
      packQuantity: o.packQuantity,
      shippingCost: null,
      shipping: o.shipping,
      delivery: o.delivery,
      deliveryDays: null,
      specs: o.specs,
      compatibility: o.compatibility,
      compatible: true,
      source: 'web_search',
      retrievedAt: new Date().toISOString(),
    });
  }
  return {
    engine: 'ai_web_search',
    live: true,
    options,
    alternatives: parsed.data.alternatives,
    links,
    retrievedAt: new Date().toISOString(),
    note: `${parsed.data.notes || ''} Prices are as shown in search results at retrieval time and may have changed — confirm on the seller's page.${dropped ? ` ${dropped} result(s) were discarded because their URL could not be verified against the search results.` : ''}`.trim(),
  };
}
