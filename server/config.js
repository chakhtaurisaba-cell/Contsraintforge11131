import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// Vercel sets VERCEL=1 in its builds and functions.
const onVercel = Boolean(process.env.VERCEL);

export const config = {
  port: num(process.env.PORT, 8787),
  onVercel,
  // On Vercel only /tmp is writable — and it is temporary (see README → Deploying to Vercel).
  dbPath: process.env.DB_PATH || (onVercel ? '/tmp/constraintforge.db' : './data/constraintforge.db'),
  dbIsTemporary: onVercel && (!process.env.DB_PATH || process.env.DB_PATH.startsWith('/tmp')),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',

  ai: {
    // Google Gemini through the official @google/genai SDK.
    provider: 'gemini',
    // Multimodal (text + images) with structured JSON output.
    model: 'gemini-3.8-flash',
    // Server-side secret, read only from GEMINI_API_KEY. Never sent to the browser, never logged,
    // never put in a VITE_ variable (those are bundled into the frontend).
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    // Tests only: point the SDK at a local stand-in server instead of Google.
    baseUrl: (process.env.GEMINI_BASE_URL || '').trim() || undefined,
    enabled: process.env.AI_ENABLED !== 'false',
    // Candidate ideas asked from the model per request; unrealistic and repeated ones are filtered out afterwards.
    maxIdeas: Math.max(1, Math.min(10, num(process.env.AI_MAX_IDEAS, 8))),
    // One Gemini call may take this long before it is cancelled with a clear "took too long" error.
    // On Vercel the whole function is stopped at 300 s (vercel.json), so one call stays well below it.
    timeoutMs: num(process.env.AI_TIMEOUT_MS, onVercel ? 120000 : 180000),
  },

  search: {
    // Real web searches the server runs for research and the assistant: duckduckgo | searxng | off.
    provider: (process.env.SEARCH_PROVIDER || 'duckduckgo').toLowerCase(),
    searxngUrl: (process.env.SEARXNG_URL || '').trim(),
    maxPageChars: num(process.env.SEARCH_MAX_PAGE_CHARS, 6000),
  },

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
    scopes: process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_orders',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-07',
    // Public URL of this API server that Shopify redirects back to.
    callbackBase: process.env.SHOPIFY_CALLBACK_BASE || `http://localhost:${num(process.env.PORT, 8787)}`,
  },

  uploads: {
    maxImageBytes: num(process.env.MAX_IMAGE_MB, 8) * 1024 * 1024,
    maxImages: 6,
  },
};

export const shopifyConfigured = () => Boolean(config.shopify.apiKey && config.shopify.apiSecret);
