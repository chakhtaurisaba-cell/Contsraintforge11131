// Web research BEFORE ideation: a few real searches that combine the user's materials, to discover
// what people actually build from them. Only titles and snippets are used (no page downloads), so
// it is quick, and it starts from the raw text — in parallel with material parsing, without
// waiting for an AI call. The results are evidence for the model, never answers: the model must
// still check each possibility against the exact inventory, and the app re-checks it afterwards.
//
// Search failures never stop ideation: the ideas are then the model's own reasoning.
import { webSearch, searchAvailable } from '../ai/search.js';
import { config } from '../config.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // query → { at, results }
const DEADLINE_MS = 8000;

const TOOL_WORDS = /\b(saw|hand ?saw|hacksaw|jigsaw|hammer|drill|driver|screwdriver|scissors|knife|cutter|glue gun|sander|clamps?|tape measure|ruler|pliers|wrench|spanner|sewing machine|needle|soldering iron|chisel|file|plane|brush|stapler)\b/i;
const LEADING_AMOUNT = /^(about |around |roughly |approx\.? )?((\d+([.,]\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen|half|a few|few|some|several|lots of|a lot of|many|pair of|a pair of)\s+)?((box|bag|pack|roll|bottle|tube|sheet|piece|pieces|pcs|kg|g|m|cm|mm|metres?|meters?|litres?|liters?|l)\s+(of\s+)?)?/i;

/** Material and tool phrases from free text ("3 pine boards, screws and a hammer"), no AI call. */
export function phrasesFromText(text) {
  const parts = String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+\s*(x|×)\s*\d+(\s*(x|×)\s*\d+)?\s*(mm|cm|m)?/g, ' ')
    .split(/[,;\n]+|\band\b|\bplus\b|&|\+|\bwith\b|\bi have\b|\bi've got\b|\bi got\b/)
    // Twice: "a box of 100 wood screws" → "100 wood screws" → "wood screws".
    .map((p) => p.trim().replace(LEADING_AMOUNT, '').trim().replace(LEADING_AMOUNT, '').replace(/[^\p{L}\p{N} -]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 3 && p.length <= 40 && /\p{L}{3}/u.test(p));
  const unique = [...new Set(parts)];
  return { materials: unique.filter((p) => !TOOL_WORDS.test(p)), tools: unique.filter((p) => TOOL_WORDS.test(p)) };
}

/** 2–3 search queries that combine the materials (fewer with DuckDuckGo, which is throttled). */
export function researchQueries({ materials, tools }) {
  const m = materials.slice(0, 4);
  if (!m.length) return [];
  const qs = [
    `DIY projects ${m.slice(0, 3).join(' ')}`,
    `things to make from ${m[0]}${m[1] ? ` and ${m[1]}` : ''}`,
    m.length > 1 ? `${m.slice(0, 2).join(' ')} ${tools[0] ? `${tools[0]} ` : ''}useful build ideas` : `useful ${m[0]} upcycling ideas`,
  ];
  const max = config.search.provider === 'duckduckgo' ? 2 : 3;
  return [...new Set(qs)].slice(0, max);
}

/** Tests only: forget cached searches. */
export const resetResearchCache = () => cache.clear();

async function cachedSearch(query) {
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;
  const results = await webSearch(query, { max: 6 });
  cache.set(key, { at: Date.now(), results });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return results;
}

/**
 * Runs the searches in parallel with a deadline. Returns { sources: [{n, url, title, snippet}],
 * queries, error } — sources are numbered for the prompt (sourceRefs) and deduplicated by URL.
 */
export async function researchIdeas({ text = '', inventory = [] } = {}) {
  if (!config.ai.ideaResearch) return { sources: [], queries: [], skipped: 'off' };
  if (!searchAvailable()) return { sources: [], queries: [], skipped: 'no_search' };
  const fromText = phrasesFromText(text);
  const phrases = {
    materials: [...new Set([...fromText.materials, ...inventory.filter((i) => !TOOL_WORDS.test(i.name)).map((i) => i.name.toLowerCase())])],
    tools: fromText.tools,
  };
  const queries = researchQueries(phrases);
  if (!queries.length) return { sources: [], queries: [] };
  const t0 = Date.now();
  const settled = await Promise.race([
    Promise.allSettled(queries.map(cachedSearch)),
    new Promise((resolve) => setTimeout(() => resolve(null), DEADLINE_MS)),
  ]);
  if (!settled) {
    console.warn(`[research] idea research gave up after ${DEADLINE_MS / 1000}s`);
    return { sources: [], queries, error: 'Web research took too long, so the ideas are the AI’s own reasoning.' };
  }
  const seen = new Set();
  const sources = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const s of r.value) {
      const key = s.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ n: sources.length + 1, url: s.url, title: s.title.slice(0, 140), snippet: (s.snippet || '').slice(0, 260) });
    }
  }
  const failed = settled.filter((r) => r.status === 'rejected');
  console.log(`[research] ${queries.length} searches → ${sources.length} results in ${((Date.now() - t0) / 1000).toFixed(1)}s${failed.length ? ` (${failed.length} failed: ${failed[0].reason?.message})` : ''}`);
  return {
    sources: sources.slice(0, 14),
    queries,
    ...(failed.length === settled.length ? { error: 'Web research is unavailable right now, so the ideas are the AI’s own reasoning.' } : {}),
  };
}

/** The numbered evidence block for the ideation prompt. */
export function evidenceForPrompt(research) {
  if (!research?.sources?.length) return '';
  return [
    'Web research results (evidence of what people build from similar materials — NOT a list of answers; check each against the exact inventory and tools):',
    ...research.sources.map((s) => `[${s.n}] ${s.title}${s.snippet ? ` — ${s.snippet}` : ''} (${new URL(s.url).hostname.replace(/^www\./, '')})`),
  ].join('\n');
}
