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
// Research must never hold up the ideas: whatever has arrived after this long is used, and the
// rest is dropped (each search request also gives up on its own after this long).
const DEADLINE_MS = Math.max(300, Number(process.env.AI_RESEARCH_TIMEOUT_MS) || 2000);
// When a whole research round returns nothing (provider down, blocked with 403/429, timing out),
// research is skipped for this long, so each request doesn't wait on the same broken provider.
const FAILURE_PAUSE_MS = 10 * 60 * 1000;
let pausedUntil = 0;
let pausedWhy = '';

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
  // Different angles, so the results discover different projects: the materials together; what
  // the tools allow (or, with no tools, projects that need nothing else); the main material alone.
  const qs = [
    `DIY projects ${m.slice(0, 3).join(' ')}`,
    tools.length ? `${m.slice(0, 2).join(' ')} ${tools.slice(0, 2).join(' ')} DIY` : `things to make from ${m[0]}${m[1] ? ` and ${m[1]}` : ''} without extra materials`,
    m.length > 1 ? `products made from ${m.slice(0, 2).join(' and ')}` : `useful ${m[0]} upcycling ideas`,
  ];
  const max = config.search.provider === 'duckduckgo' ? 2 : 3;
  return [...new Set(qs)].slice(0, max);
}

/** Tests only: forget cached searches. */
export const resetResearchCache = () => {
  cache.clear();
  pausedUntil = 0;
};

async function cachedSearch(query) {
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;
  const results = await webSearch(query, { max: 6, timeoutMs: DEADLINE_MS });
  cache.set(key, { at: Date.now(), results });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return results;
}

/**
 * Runs the searches in parallel with a deadline. Returns { sources: [{n, url, title, snippet}],
 * queries, error } — sources are numbered for the prompt (sourceRefs) and deduplicated by URL.
 */
export async function researchIdeas({ text = '', inventory = [], tools = [] } = {}) {
  if (!config.ai.ideaResearch) return { sources: [], queries: [], skipped: 'off' };
  if (!searchAvailable()) return { sources: [], queries: [], skipped: 'no_search' };
  if (pausedUntil > Date.now()) {
    return { sources: [], queries: [], skipped: 'paused', error: `Web research is paused for ${Math.ceil((pausedUntil - Date.now()) / 60000)} min after it failed (${pausedWhy}), so the ideas are the AI’s own reasoning.` };
  }
  const fromText = phrasesFromText(text);
  const phrases = {
    materials: [...new Set([...fromText.materials, ...inventory.filter((i) => !TOOL_WORDS.test(i.name)).map((i) => i.name.toLowerCase())])],
    tools: [...new Set([...fromText.tools, ...tools.map((t) => String(t).toLowerCase()), ...inventory.filter((i) => TOOL_WORDS.test(i.name)).map((i) => i.name.toLowerCase())])],
  };
  const queries = researchQueries(phrases);
  if (!queries.length) return { sources: [], queries: [] };
  const t0 = Date.now();
  // Searches run in parallel; results are kept as they arrive, so a slow search only loses its
  // own results — the ones that finished in time are still used.
  const done = queries.map(() => null); // { ok: results } | { error }
  const all = Promise.all(queries.map((q, i) => cachedSearch(q).then((value) => { done[i] = { ok: value }; }, (error) => { done[i] = { error }; })));
  let timer;
  await Promise.race([all, new Promise((resolve) => { timer = setTimeout(resolve, DEADLINE_MS); })]);
  clearTimeout(timer);
  // A search aborted by its own time limit is "too slow", like one still running.
  const late = done.filter((d) => !d || /abort|time ?out/i.test(d.error?.message || '')).length;
  if (late) console.warn(`[research] ${late} of ${queries.length} searches still running after ${DEADLINE_MS} ms — continuing without them`);
  const seen = new Set();
  const perSite = {};
  const sources = [];
  for (const r of done) {
    if (!r?.ok) continue;
    for (const s of r.ok) {
      const key = s.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (seen.has(key)) continue;
      // Variety: at most 3 results from one site.
      const site = new URL(s.url).hostname.replace(/^www\./, '');
      if ((perSite[site] = (perSite[site] || 0) + 1) > 3) continue;
      seen.add(key);
      sources.push({ n: sources.length + 1, url: s.url, title: s.title.slice(0, 140), snippet: (s.snippet || '').slice(0, 260) });
    }
  }
  const failed = done.filter((d) => d?.error && !/abort|time ?out/i.test(d.error.message || ''));
  console.log(`[research] ${queries.length} searches → ${sources.length} results in ${((Date.now() - t0) / 1000).toFixed(1)}s${failed.length ? ` (${failed.length} failed: ${failed[0].error?.message})` : ''}`);
  const nothing = !done.some((d) => d?.ok);
  if (nothing) {
    pausedUntil = Date.now() + FAILURE_PAUSE_MS;
    pausedWhy = late ? 'too slow' : failed[0]?.error?.message?.slice(0, 80) || 'no results';
    console.warn(`[research] no results (${pausedWhy}) — skipping web research for ${FAILURE_PAUSE_MS / 60000} min`);
  }
  return {
    sources: sources.slice(0, 14),
    queries,
    ...(nothing ? { error: late > 0 && !failed.length ? 'Web research took too long, so the ideas are the AI’s own reasoning.' : 'Web research is unavailable right now, so the ideas are the AI’s own reasoning.' } : {}),
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
