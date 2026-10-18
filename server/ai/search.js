// Real web search + page reading for the research features. The app runs every search
// itself (the model only proposes queries), so the set of URLs a reply may cite is
// exactly the set these functions returned — nothing the model writes is trusted.
//
// Providers (SEARCH_PROVIDER):
//   duckduckgo (default) — keyless, uses DuckDuckGo's HTML results page
//   searxng              — your own SearXNG instance (SEARXNG_URL), keyless
//   ollama               — Ollama's hosted web search (needs OLLAMA_API_KEY)
//   off                  — research disabled; features say so instead of guessing
import { isIP } from 'node:net';
import { config } from '../config.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ConstraintForge/0.1';

export class SearchError extends Error {
  constructor(message, code = 'search_failed') {
    super(message);
    this.code = code;
  }
}

export function searchStatus() {
  const s = config.search;
  const missing = s.provider === 'searxng' && !s.searxngUrl ? 'SEARXNG_URL' : s.provider === 'ollama' && !s.ollamaApiKey ? 'OLLAMA_API_KEY' : null;
  return { provider: s.provider, available: s.provider !== 'off' && !missing, missing };
}
export const searchAvailable = () => searchStatus().available;

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function getText(url, init = {}, timeoutMs = 15000) {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new SearchError(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res;
}

/* ------------------------------ providers ------------------------------ */

// DuckDuckGo shows a captcha when searches arrive in quick bursts; keep them spaced out.
let ddgNext = 0;
async function ddgTurn() {
  const wait = ddgNext - Date.now();
  ddgNext = Math.max(Date.now(), ddgNext) + 2500;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function searchDuckDuckGo(query, max) {
  await ddgTurn();
  const res = await getText('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query, kl: '' }).toString(),
  });
  const html = await res.text();
  if (/anomaly-modal|captcha/i.test(html) && !/result__a/.test(html)) throw new SearchError('DuckDuckGo asked for a captcha (too many searches). Try again in a few minutes.', 'search_rate_limited');
  const out = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1);
  for (const b of blocks) {
    if (/result--ad/.test(b)) continue;
    const a = b.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let href = decodeEntities(a[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\//.test(href)) continue;
    const snip = b.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ url: href, title: stripTags(a[2]), snippet: snip ? stripTags(snip[1]) : '' });
    if (out.length >= max) break;
  }
  return out;
}

async function searchSearxng(query, max) {
  const u = new URL('/search', config.search.searxngUrl);
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'json');
  const data = await (await getText(u.toString(), { headers: { accept: 'application/json' } })).json();
  return (data.results || []).slice(0, max).map((r) => ({ url: r.url, title: r.title || '', snippet: r.content || '' }));
}

async function searchOllama(query, max) {
  const res = await getText('https://ollama.com/api/web_search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.search.ollamaApiKey}` },
    body: JSON.stringify({ query, max_results: max }),
  });
  const data = await res.json();
  return (data.results || []).map((r) => ({ url: r.url, title: r.title || '', snippet: (r.content || '').slice(0, 400) }));
}

/** One real web search. Returns [{url, title, snippet}]. */
export async function webSearch(query, { max = 5 } = {}) {
  const st = searchStatus();
  if (!st.available) throw new SearchError(st.missing ? `Web search needs ${st.missing} in .env.` : 'Web search is turned off (SEARCH_PROVIDER=off).', 'search_not_configured');
  const fn = { duckduckgo: searchDuckDuckGo, searxng: searchSearxng, ollama: searchOllama }[st.provider];
  if (!fn) throw new SearchError(`Unknown SEARCH_PROVIDER "${st.provider}".`, 'search_not_configured');
  try {
    return (await fn(String(query).slice(0, 300), max)).filter((r) => r.url && r.title);
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw new SearchError(`Search failed: ${err.message}`);
  }
}

/* ------------------------------ page reading ------------------------------ */

/** Only public http(s) hosts — never the local machine or private networks. */
export function isPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (isIP(h) === 6 && (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))) return false;
  return true;
}

function htmlToText(html) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = decodeEntities(body.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2)
    .join('\n');
  return { title, text };
}

/** Download a page and return its readable text (truncated). */
export async function fetchPage(url, { maxChars = config.search.maxPageChars } = {}) {
  if (!isPublicUrl(url)) throw new SearchError('Only public web pages can be read.', 'fetch_blocked');
  if (config.search.provider === 'ollama' && config.search.ollamaApiKey) {
    const res = await getText('https://ollama.com/api/web_fetch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.search.ollamaApiKey}` }, body: JSON.stringify({ url }) }, 20000);
    const d = await res.json();
    return { url, title: d.title || '', text: String(d.content || '').slice(0, maxChars) };
  }
  const res = await getText(url, { headers: { accept: 'text/html,text/plain;q=0.9' } }, 15000);
  const type = res.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new SearchError(`Not a readable page (${type.split(';')[0] || 'unknown type'}).`, 'fetch_unreadable');
  const raw = (await res.text()).slice(0, 2_000_000);
  const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: '', text: raw };
  return { url: res.url || url, title, text: text.slice(0, maxChars) };
}
