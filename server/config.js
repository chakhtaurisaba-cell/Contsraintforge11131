import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),
  dbPath: process.env.DB_PATH || './data/constraintforge.db',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',

  ai: {
    // Local Ollama server. No API key: the model runs on this machine.
    provider: 'ollama',
    baseUrl: (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    // Must support image input for photo scanning (e.g. qwen3-vl, gemma3, llava). The
    // instruct variant answers directly; thinking variants are far slower on small GPUs.
    model: process.env.OLLAMA_MODEL || 'qwen3-vl:4b-instruct',
    enabled: process.env.AI_ENABLED !== 'false',
    // One context size for every call (changing it reloads the model). 6144 holds a 4B model
    // fully on a 4 GB GPU; 8192 no longer fits and 16384 ran at ~3 tok/s. A request that
    // genuinely needs more (e.g. many photos) gets a larger context for that call only.
    numCtx: num(process.env.OLLAMA_NUM_CTX, 6144),
    // Candidate ideas asked from the model per request (≈200 tokens ≈ 4–5 s each at full GPU speed);
    // unrealistic and repeated ones are filtered out afterwards.
    maxIdeas: Math.max(1, Math.min(10, num(process.env.AI_MAX_IDEAS, 8))),
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    // GPU layers to offload (num_gpu). Unset = Ollama decides, which on a 4 GB laptop GPU put only
    // 12 of 37 layers on the GPU (~12 tok/s); 99 = all layers (~45–50 tok/s) when they fit. If the
    // GPU can't hold them the client falls back to Ollama's automatic split.
    numGpu: process.env.OLLAMA_NUM_GPU === undefined || process.env.OLLAMA_NUM_GPU === '' ? null : num(process.env.OLLAMA_NUM_GPU, null),
    // Let "thinking" models reason before answering. Better plans, much slower locally.
    think: process.env.OLLAMA_THINK === 'true',
    // Local models on modest GPUs are slow. A request fails if Ollama sends nothing for
    // AI_TIMEOUT_MS (covers model loading), or runs longer than AI_MAX_REQUEST_MS overall.
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 120000),
    maxRequestMs: num(process.env.AI_MAX_REQUEST_MS, 600000),
  },

  search: {
    provider: (process.env.SEARCH_PROVIDER || 'duckduckgo').toLowerCase(),
    searxngUrl: (process.env.SEARXNG_URL || '').trim(),
    ollamaApiKey: (process.env.OLLAMA_API_KEY || '').trim(),
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
