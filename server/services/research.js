// Real web research for product ideas and selected products. Searches (and page
// reads) are executed by the app itself (ai/search.js) before the model sees them. Every source
// returned to the app must be a URL those tools actually produced; anything else is
// dropped and counted. Nothing here is mocked or cached across different inputs.
import { webResearch, extractJSON, normalizeUrl } from '../ai/client.js';
import { SYSTEM_RESEARCH_CANDIDATES, SYSTEM_RESEARCH_PRODUCT } from '../ai/prompts.js';
import { CandidateResearch, ProductResearch } from '../ai/schemas.js';

/** Keep only sources whose URL the tools really returned; use the tool's URL verbatim. */
function verified(sources, toolSources) {
  const kept = [];
  let dropped = 0;
  for (const s of sources || []) {
    const hit = toolSources.get(normalizeUrl(s.url));
    if (!hit) { dropped += 1; continue; }
    kept.push({ ...s, url: hit.url, title: s.title || hit.title });
  }
  return { kept, dropped };
}

const materialsLine = (inventory) => inventory.map((i) => `${i.name}${i.quantity ? ` ×${i.quantity}${i.unit ? ` ${i.unit}` : ''}` : ''}`).join(', ');

/** One research pass across all candidate ideas (search only). */
export async function researchCandidates(ideas, inventory, region) {
  const list = ideas.map((i, n) => `${n}. ${i.name} — search hint: ${i.researchQuery || i.name}`).join('\n');
  const prompt = `User's materials: ${materialsLine(inventory)}\nRegion: ${region || 'unspecified'}\n\nCandidate products:\n${list}\n\nFind real build guides or credible references for each candidate.`;
  const { text, sources, searches } = await webResearch({ system: SYSTEM_RESEARCH_CANDIDATES, prompt, maxUses: Math.min(10, Math.max(3, Math.ceil(ideas.length * 1.2))), schema: CandidateResearch });
  const parsed = CandidateResearch.safeParse(extractJSON(text));
  const retrievedAt = new Date().toISOString();
  if (!parsed.success) return { retrievedAt, searches, byIndex: {}, dropped: 0, error: 'The research finished but returned no usable results.' };
  const byIndex = {};
  let dropped = 0;
  for (const c of parsed.data.candidates) {
    if (c.index < 0 || c.index >= ideas.length) continue;
    const v = verified(c.sources, sources);
    dropped += v.dropped;
    byIndex[c.index] = { sources: v.kept.slice(0, 3), note: c.note };
  }
  return { retrievedAt, searches, byIndex, dropped };
}

/** Deeper research for the selected product (search + reading pages). */
export async function researchProduct(project, inventory, region) {
  const idea = project.idea || {};
  const prompt = `Product to build: ${idea.name || project.name}\nDescription: ${idea.description || ''}\nUser's materials: ${materialsLine(inventory)}\nUser's tools: ${(idea.userTools || []).join(', ') || 'not stated'}\nRegion: ${region || 'unspecified'}\n${idea.researchQuery ? `Suggested search: ${idea.researchQuery}\n` : ''}${idea.research?.sources?.length ? `Already found (start from these if useful): ${idea.research.sources.map((s) => s.url).join(' , ')}\n` : ''}\nResearch how to build this product from these materials.`;
  const { text, sources, searches, fetches } = await webResearch({ system: SYSTEM_RESEARCH_PRODUCT, prompt, maxUses: 6, fetch: true, maxFetches: 3, schema: ProductResearch });
  const parsed = ProductResearch.safeParse(extractJSON(text));
  const retrievedAt = new Date().toISOString();
  if (!parsed.success) {
    return { retrievedAt, searches, fetches, summary: '', sources: [], typicalDimensions: [], limited: true, limitationNote: 'The research finished but its result could not be read. The plan below is the AI’s own proposal.', dropped: 0 };
  }
  const v = verified(parsed.data.sources, sources);
  const limited = parsed.data.limited || v.kept.length === 0;
  return {
    ...parsed.data,
    sources: v.kept,
    limited,
    limitationNote: limited ? parsed.data.limitationNote || 'No reliable build guides were found. The plan below is the AI’s own proposal.' : '',
    retrievedAt,
    searches,
    fetches,
    dropped: v.dropped,
  };
}
