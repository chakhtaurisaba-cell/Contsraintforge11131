// Sales-channel recommendation and launch-plan generation.
import { aiEnabled, structured, webResearch, extractJSON, normalizeUrl } from '../ai/client.js';
import { ChannelResult } from '../ai/schemas.js';
import { SYSTEM_CHANNELS } from '../ai/prompts.js';
import { fromUSD } from '../engine/units.js';

// Generic channel TYPES for the demo engine. Fee numbers are rough planning
// placeholders and are always shown as "assumption — verify on the platform".
const CHANNEL_TYPES = [
  { id: 'local_classifieds', name: 'Local classifieds', type: 'Classifieds', fee: 0, fixed: 0, difficulty: 'easy', traffic: 'built-in', local: true,
    setup: 'Create an account, photograph the product, write a listing with dimensions and price, and arrange pickup or courier delivery.',
    listing: 'Single listing with 4–6 photos, dimensions, material, price, pickup area and delivery options.',
    marketing: 'Post 2 listing variants (different main photo or price) and compare the number of messages after 7 days.',
    risks: 'Price-driven buyers; time spent on messages; no buyer protection.' },
  { id: 'social_marketplace', name: 'Social-media marketplace & local groups', type: 'Social marketplace', fee: 0, fixed: 0, difficulty: 'easy', traffic: 'built-in', local: true,
    setup: 'List the product in a marketplace feature or community buy/sell groups in your city.',
    listing: 'Short post: hero photo, 1-line benefit, price, dimensions, delivery/pickup.',
    marketing: 'Post in 3 relevant community groups; track messages per post.',
    risks: 'Availability of marketplace features varies by country; group rules may ban commercial posts.' },
  { id: 'content_social', name: 'Instagram / TikTok content + direct messages', type: 'Social content', fee: 0, fixed: 0, difficulty: 'moderate', traffic: 'audience', local: false,
    setup: 'Create a business profile, post process videos and finished-product photos, and take orders by direct message with a payment link or bank transfer.',
    listing: 'Carousel or short video: making-of → finished product → price and how to order.',
    marketing: 'Publish 3 short process videos in a week; measure profile visits and DMs.',
    risks: 'Slow to build an audience; needs consistent content time.' },
  { id: 'handmade_marketplace', name: 'Handmade / craft marketplace', type: 'Handmade marketplace', fee: 10, fixed: 0.5, difficulty: 'moderate', traffic: 'built-in', local: false,
    setup: 'Open a seller shop, verify identity and payout method, set shipping profiles and policies.',
    listing: 'Keyword-rich title, 10 photos, materials, dimensions, processing time, shipping cost.',
    marketing: 'Launch 3–5 listings; adjust titles/photos based on views after 2 weeks.',
    risks: 'Seller availability and payouts depend on your country; international shipping of bulky items is expensive.' },
  { id: 'general_marketplace', name: 'General online marketplace', type: 'Marketplace', fee: 15, fixed: 0, difficulty: 'hard', traffic: 'built-in', local: false,
    setup: 'Seller registration, tax details, product identifiers where required, and fulfilment setup.',
    listing: 'Structured listing with bullet points, specifications and packaging dimensions.',
    marketing: 'Only after validating demand elsewhere; sponsored listings cost extra.',
    risks: 'High competition with mass-produced goods; strict performance requirements.' },
  { id: 'own_store', name: 'Own website / Shopify-type store', type: 'Own store', fee: 3, fixed: 0.3, difficulty: 'moderate', traffic: 'none', local: false,
    setup: 'Choose a store platform, connect a payment provider available in your country, and add products, shipping and policies.',
    listing: 'Product page: story, detailed photos, dimensions, FAQ, delivery info.',
    marketing: 'Needs traffic from social media or ads; start once you have repeat interest.',
    risks: 'Monthly subscription; no built-in traffic.' },
  { id: 'retail_consignment', name: 'Local shops (consignment / retail)', type: 'Physical retail', fee: 35, fixed: 0, difficulty: 'moderate', traffic: 'built-in', local: true,
    setup: 'Approach 3–5 gift, décor or concept shops with samples and a price sheet.',
    listing: 'Sample units + price sheet with retail and consignment terms.',
    marketing: 'Offer a 30-day consignment trial at one shop.',
    risks: 'Commission typically takes a large share; slow payment cycles.' },
  { id: 'markets', name: 'Craft markets & fairs', type: 'Physical market', fee: 0, fixed: 0, difficulty: 'easy', traffic: 'built-in', local: true,
    setup: 'Book a stall, prepare display, price tags, a card reader or QR payment.',
    listing: 'Table display with price tags; collect contacts for later orders.',
    marketing: 'One market day = fast direct feedback on price and design.',
    risks: 'Stall fees and a full day of time; weather/seasonality.' },
  { id: 'b2b', name: 'B2B / wholesale (cafés, offices, hotels, event companies)', type: 'B2B', fee: 0, fixed: 0, difficulty: 'hard', traffic: 'outreach', local: true,
    setup: 'Prepare a wholesale price list (often ~50–60% of retail), samples and lead times.',
    listing: 'One-page catalogue with photos, MOQ, price breaks and lead time.',
    marketing: 'Contact 10 targeted businesses; measure replies and sample requests.',
    risks: 'Lower unit price; larger order commitments.' },
  { id: 'preorders', name: 'Pre-orders / demand validation', type: 'Validation', fee: 0, fixed: 0, difficulty: 'easy', traffic: 'audience', local: false,
    setup: 'Show a prototype photo and take deposits or sign-ups before producing a batch.',
    listing: 'Prototype photos, price, expected delivery date, deposit terms.',
    marketing: 'Share with friends, community groups and social followers; target N sign-ups.',
    risks: 'Must deliver on time; be transparent about lead times.' },
];

const REGION_NOTES = {
  GE: 'In Georgia, local classified sites (e.g. ss.ge, mymarket.ge) and Facebook/Instagram are commonly used — verify current listing rules and fees yourself.',
};

function demoChannels(project, ctx) {
  const idea = project.idea || {};
  const price = Number(project.economics?.price) || Number(idea.priceLow) || 0;
  const priceUSD = price / (fromUSD(1, ctx.currency) || 1);
  const o = project.plan?.overall || {};
  const longest = Math.max(o.length || 0, o.width || 0, o.height || 0);
  const bulky = longest > 450;
  const delivery = ctx.delivery || ['pickup', 'courier'];
  const lowMarketingTime = (Number(ctx.marketingHoursPerWeek) || 0) < 3;
  const hasAudience = (Number(ctx.audienceSize) || 0) >= 300;
  const scored = CHANNEL_TYPES.map((c) => {
    let s = 60;
    const why = [];
    if (bulky && c.local) { s += 15; why.push('bulky item — local sale avoids expensive shipping'); }
    if (bulky && !c.local) { s -= 12; why.push('shipping a bulky item is costly'); }
    if (priceUSD < 15 && c.fixed > 0) { s -= 8; why.push('fixed fees weigh heavily on a low price'); }
    if (priceUSD < 15 && c.fee >= 30) { s -= 10; }
    if (lowMarketingTime && c.traffic === 'built-in') { s += 10; why.push('brings its own buyers, suits limited marketing time'); }
    if (lowMarketingTime && c.traffic !== 'built-in') s -= 10;
    if (hasAudience && (c.id === 'content_social' || c.id === 'preorders')) { s += 15; why.push('you already have an audience'); }
    if (c.id === 'preorders') { s += 8; why.push('validates demand before you spend on materials'); }
    if (!delivery.includes('post') && !delivery.includes('courier') && !c.local) s -= 20;
    if (ctx.goal === 'scalable' && (c.id === 'b2b' || c.id === 'own_store')) { s += 10; why.push('scales beyond one-off sales'); }
    if (c.difficulty === 'hard') s -= 6;
    const feeAmt = (price * c.fee) / 100 + fromUSD(c.fixed, ctx.currency);
    return {
      name: c.name,
      type: c.type,
      fitScore: Math.max(5, Math.min(98, s)),
      whyItFits: why.length ? `${why.join('; ')}.` : 'General fit for this product type.',
      likelyCustomers: (idea.targetCustomers || []).join(', ') || 'Local buyers interested in handmade goods',
      costs: c.fee || c.fixed ? `Planning assumption: ~${c.fee}% + ${fromUSD(c.fixed, ctx.currency)} ${ctx.currency} per sale (≈ ${feeAmt.toFixed(2)} ${ctx.currency} at your price). Placeholder — verify current fees on the platform.` : 'No platform commission assumed; payment, delivery and your time still cost money. Verify any listing fees.',
      feePctAssumption: c.fee,
      fixedFeeAssumption: fromUSD(c.fixed, ctx.currency),
      setup: c.setup,
      difficulty: c.difficulty,
      listingFormat: c.listing,
      marketingTest: c.marketing,
      risks: c.risks,
      firstStep: c.id === 'preorders' ? 'Post prototype photos with a price and collect 5 pre-order sign-ups before buying batch materials.' : `Create one listing on this channel this week and record views/messages.`,
      regionalNote: c.local ? REGION_NOTES[ctx.region] || 'Check which local platforms and markets are active in your city.' : 'Check that this channel accepts sellers and pays out in your country.',
    };
  }).sort((a, b) => b.fitScore - a.fitScore);
  const name = idea.name || project.name;
  const dims = o.length ? `${o.length}×${o.width}×${o.height} mm` : '';
  const material = project.plan?.components?.[0]?.material || '';
  return {
    channels: scored.slice(0, 6),
    launchPlan: {
      title: `Handmade ${name}${material ? ` – ${material}` : ''}${dims ? ` – ${dims}` : ''}`,
      description: `${idea.description || ''}\n\nSize: ${dims || 'see photos'}. Made by hand in small batches${material ? ` from ${material}` : ''}. ${project.plan?.finalInspection?.length ? 'Every unit is inspected before shipping.' : ''}`.trim(),
      keywords: [...new Set([name, idea.category, material, 'handmade', 'gift', ...(idea.targetCustomers || []).slice(0, 2)].filter(Boolean).map((k) => k.toLowerCase()))],
      photos: ['Hero shot on a clean, neutral background in daylight', 'In-use lifestyle photo (on a shelf/desk/table)', 'Close-up of material and finish', 'Photo with a ruler or a common object for scale', 'Packaging photo'],
      listingStructure: ['Title with product + material + size', 'One-sentence benefit', 'Dimensions and materials', 'Care instructions', 'Delivery / pickup options and timing', 'Returns policy'],
      pricingStrategy: `Launch at your calculated price (${price || '—'} ${ctx.currency}); test a second price 15% higher on a separate listing or day and compare inquiries. Never go below the break-even price shown in Economics.`,
      experiments: ['Two main photos A/B (lifestyle vs plain background) for one week each', 'Price test: base vs +15%', 'Bundle test: 2 units at a small discount', 'Pre-order post before producing the next batch'],
      audience: (idea.targetCustomers || []).join(', ') || 'Local buyers of home goods and gifts',
      checklist: ['Prototype finished and photographed', 'Price checked against break-even', 'Delivery method and cost decided', 'Listing written', 'First listing published', 'Inquiries and sales recorded in ConstraintForge'],
      kpis: ['Inquiries per listing per week', 'Units sold per channel', 'Net profit per unit by channel', 'Days to sell a unit', 'Return/complaint rate'],
    },
    caveats: 'General guidance, not researched for your region. Fees are rough placeholders — check each platform before listing.',
  };
}

const RESEARCH_SYSTEM = `Research where a small maker in the given region can sell the given handmade product: which marketplaces, social shops and local channels actually accept sellers there, and their CURRENT seller fees. Only report what you found with web search, with exact URLs. After researching reply with ONLY JSON:
{"findings":[{"channel":"","availableInRegion":"yes|no|unclear","feeSummary":"","url":""}],"notes":""}`;

/** Live research on channel availability and fees for the seller's region. */
async function researchChannels(project, ctx) {
  const prompt = `Product: ${project.name} (${project.idea?.category || 'handmade'}), price about ${project.economics.price} ${ctx.currency}, size ${project.plan?.overall ? `${project.plan.overall.length}×${project.plan.overall.width}×${project.plan.overall.height} mm` : 'unknown'}.\nSeller region: ${ctx.region}. Delivery options: ${(ctx.delivery || []).join(', ')}.`;
  const { text, sources } = await webResearch({ system: RESEARCH_SYSTEM, prompt, maxUses: 6 });
  const parsed = extractJSON(text);
  const findings = (parsed?.findings || []).filter((f) => f && f.url && sources.has(normalizeUrl(f.url))).map((f) => ({ ...f, url: sources.get(normalizeUrl(f.url)).url }));
  return { findings, notes: parsed?.notes || '', retrievedAt: new Date().toISOString() };
}

export async function recommendChannels(project, ctx) {
  if (!aiEnabled()) return { ...demoChannels(project, ctx), engine: 'demo', generatedAt: new Date().toISOString() };
  let research = null;
  try {
    research = await researchChannels(project, ctx);
  } catch (err) {
    research = { findings: [], notes: `Live research failed (${err.message}).`, retrievedAt: new Date().toISOString() };
  }
  const researched = research.findings.length
    ? `Live research (cite these URLs in sourceUrls where relevant; do not invent others):\n${research.findings.map((f) => `- ${f.channel}: available=${f.availableInRegion}; fees: ${f.feeSummary}; ${f.url}`).join('\n')}`
    : 'No live research is available: say in "costs" that fees are unverified, and leave sourceUrls empty.';
  const content = `Product (JSON):\n${JSON.stringify({ name: project.name, idea: project.idea, overall: project.plan?.overall, economics: project.economics }, null, 2)}\n\nSeller context (JSON):\n${JSON.stringify(ctx, null, 2)}\n\n${researched}\n\nRank 4-6 channels and write the launch plan. Currency: ${ctx.currency}.`;
  const result = await structured({ system: SYSTEM_CHANNELS, content, schema: ChannelResult, effort: 'medium', maxTokens: 2500, label: 'sales channels' });
  const allowed = new Set(research.findings.map((f) => f.url));
  result.channels = result.channels.map((c) => ({ ...c, sourceUrls: (c.sourceUrls || []).filter((u) => allowed.has(u)) })).sort((a, b) => b.fitScore - a.fitScore);
  return { ...result, research, engine: 'ai', generatedAt: new Date().toISOString() };
}
