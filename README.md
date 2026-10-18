# ConstraintForge

Turn the materials, tools, skills and budget you already have into products you can build, sell and improve.

**Resources → ideas → feasibility → build plan → sourcing → costs → sales strategy → real sales → advisor**

## Quick start

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite`; developed on Node 24).

```bash
cd constraintforge
npm install
cp .env.example .env
ollama pull qwen3-vl:4b-instruct   # local vision model — no API key
npm run dev                 # API on :8787 + web app on http://localhost:5173
```

Production build: `npm run build && npm start`, which serves the app and the API on `:8787`.
Tests: `npm test` (fast, no model needed). `npm run test:live` sends real requests to your local Ollama model through the running API (scan, ideas, assistant); it takes several minutes on a small GPU.

All AI runs locally in [Ollama](https://ollama.com). If Ollama isn't running or the model isn't installed, AI features say so and offer a retry. They never show made-up results.

## Site structure & themes

- `/` is the public website: hero, discovery, how-it-works, product preview, business intelligence demo. The workspace only opens when you choose it.
- `/app/*` is the workspace: overview, create, scan, projects, sourcing, sales strategy, analytics, advisor, integrations, settings. Pre-redesign URLs such as `/analytics` redirect to their `/app/...` equivalents.
- There are two themes: **light** (white and forest green) and **dark** (black and forge orange). Both are built from one token set in `src/styles/app.css`. The toggle works on every page.
  - The choice is saved in `localStorage` (`cf-theme`). On a first visit the app follows the OS setting.
  - `public/theme-init.js` applies the theme before first paint, so there is no flash.
  - Switching uses a circular reveal where the browser supports View Transitions; elsewhere it uses a short cross-fade.
- Motion uses Framer Motion and respects `prefers-reduced-motion`.

## What works

| Area | Without AI | With Ollama running |
|---|---|---|
| Inventory | Manual entry, editing, qualified dimensions | Same |
| Camera / upload | Real `getUserMedia` capture, multiple photos, upload, retake/remove | Same |
| Object recognition | Not available (stated clearly) | Local vision model (Ollama) → editable detected-item cards with confidence (photos sent at ≤1024 px) |
| Dimensions | Method E: click-to-calibrate against a known reference in the photo | Plus Method A (reference object detected), B (one known measurement rescales the same photo), C (multi-view) |
| Product ideas | Not available (stated clearly, no generic suggestions) | Open-ended local-model ideation from your materials, validated with zod; gibberish is rejected |
| Ranking | — | Deterministic: buildable now → confirm a size/amount → needs a tool → needs a purchase; then share of parts from your stock, shortage cost, difficulty (model scores are not used) |
| Build plan | Parametric: dimensions, cut list packed onto your board sizes (kerf + trim), BOM, measured steps, inspection | Local-model plan (cuboid geometry, steps, BOM) |
| Assembly view | Isometric drawing from component cuboids; step highlighting | Same |
| Inventory sufficiency | Computed: max units from stock, shortfall per batch | Same |
| Economics | Deterministic engine (`shared/economics.js`): cash vs owned cost, fees, returns, break-even price and quantity, sensitivity, partial-sell scenarios | Same |
| Sourcing | Purchase checklist, outbound search links, manual quotes, best-option ranking by landed cost | Plus live web search; every listing URL is checked against the actual search results |
| Sales channels | Transparent rule-based ranking of channel types; fee numbers are labelled placeholders | Region-aware local-model ranking + launch plan |
| Analytics | From recorded/imported sales only; per-sale profit audit; CSV export; conversion only when visit data exists | Same |
| Advisor | Rules for scenarios A–G with evidence, effect, assumptions, risks, test; simulator; approve/apply; before/after results | Plus plain-language AI explanations |
| Assistant | Page guidance | Conversational, sees the current page's data |
| Shopify | OAuth + GraphQL import/draft publish implemented; shows "not configured" without credentials | Same (credentials are separate from AI) |

Example projects are loaded only on request, carry an **Example** badge, and use simulated sales. They can be excluded from totals or removed with one click.

## Configuration

See `.env.example`.

- **AI (Ollama, no key):** install Ollama, `ollama pull qwen3-vl:4b-instruct`, and set `OLLAMA_MODEL` in `.env` if you use another model.
  - The model must accept images for photo scanning. Instruct (non-thinking) variants are much faster on small GPUs.
  - On startup, and on each health check while it is down, the server checks that Ollama is running and the model is installed. The result is logged and shown in Settings → AI engine.
  - Every structured call sends its zod schema as Ollama's `format`, so the model is constrained to valid JSON. Output is validated again server-side, and malformed output is retried once. Totals and margins are never taken from model text.
  - Every string and list in that schema gets a length cap (Ollama enforces it while generating), so a small model that starts repeating itself stops at the cap instead of running until the token limit. Requests ask for at most `AI_MAX_IDEAS` ideas (default 4) and a matching token budget.
  - Speed (measured on an RTX 3050 Laptop, 4 GB): with `OLLAMA_NUM_GPU=99` all 37 layers of `qwen3-vl:4b-instruct` sit on the GPU, ≈45–50 tokens/s. Ollama's default split kept only 12 layers there (≈12 tokens/s). The client falls back to the automatic split if a forced offload fails.
  - Every call uses the same `OLLAMA_NUM_CTX` (default 6144), because changing it reloads the model; only a request that does not fit (many photos) gets a larger context for that call. The server loads the model at start-up and keeps it warm (`OLLAMA_KEEP_ALIVE`, default 30m).
  - Photos are downscaled to 1024 px before analysis: a 1600 px photo cost ≈1 900 prompt tokens and ≈29 s to encode, a 1024 px one ≈1 050 tokens and ≈10 s.
  - Each call has a task-sized output budget (material parsing 700 tokens, ideas ≈450 per idea, scan 2 500, build plan 4 000). Each call logs its load, prompt and generation time (`[ai] product ideas: load 0.0s · prompt 994 tok 0.1s · output 1345 tok 27.1s (50 tok/s)`).
  - Idea generation streams real progress to the browser (reading → ideas drafted so far → checking against stock) and can be cancelled; cancelling stops the model. Web research only runs when you ask for it ("Find build guides online").
  - A request fails if Ollama goes silent for `AI_TIMEOUT_MS` (120 s) or runs longer than `AI_MAX_REQUEST_MS` (10 min).

### How ideas are grounded

The model proposes about 8 candidates; the app checks each one and shows only those that hold up (usually 3–7). For every idea:

- **physical sense** (`server/services/feasibility.js`): each product kind has rules — its main material must suit it (a shelf, stool or anything named for carrying weight must be wood or metal, so plastic bottles or cardboard are rejected), it must be made of a material you own, parts need a way to join that fits the material (screws for wood, glue or tape for cardboard), and cutting/sewing needs a tool that can do it. A product whose name needs a part you don't have ("zipped bag", "clock") gets that part on the shopping list. Rejected ideas are listed with their reason under the results;
- the model's own tool list is only used where it fits the materials (a soldering iron for electronics), and an unknown amount of glue, sandpaper or thread doesn't hold up a build;
- at most two ideas of the same kind are shown, and near-identical names count as one;

- each "uses your X" claim must match a real inventory item (or something you typed); claims about items you don't have are dropped, and an idea that uses nothing you own is not shown;
- owned parts and the model's shopping list go through the deterministic allocator (`shared/allocation.js`), so quantities are checked against your stock and only the exact shortfall is ever bought. Reusable equipment (a melting pot, scissors) is never multiplied by the batch;
- missing tools are computed from your tools, and the finished size is checked against your boards when sizes are known;
- materials you only typed are saved to your inventory when you open a blueprint, so the plan and bill of materials reuse them;
- build plans are checked too: a part cut larger than the stock it comes from, or a "cut" step when none of your tools can cut, is flagged at the top of the build guide.

Ideas are ordered by: buildable now → needs a size/amount confirmed → needs a tool → needs a purchase, then by the share of parts from your stock, the cost of any shortage, and difficulty. The model's own scores are not used.
- **Web research (no key):** `SEARCH_PROVIDER=duckduckgo` (default), `searxng` with `SEARXNG_URL`, `ollama` with `OLLAMA_API_KEY`, or `off`.
  - The server runs the searches and reads the pages itself. The model only sees those results and may only cite their URLs; any other link is removed before it reaches the user.
  - Page reading is limited to public http(s) hosts.

### Photo scanning

1. **Pick a goal.** It drives the photo guidance: *Identify* needs 1 photo, *Shape* 3 angles, *Measure* 3–4 including a ruler, tape or bank card, and *Several items* an overview plus close-ups. These are suggestions, not requirements.
2. **Quality check.** Each photo is checked locally for darkness, glare, low contrast and blur before upload.
3. **Analysis.** Photos are sent together as one scene. The model reports a measurement method for each size:
   - *visible marking*: read from a printed or stamped size;
   - *reference-calibrated*: scaled from a ruler, tape or card in the photo;
   - *multi-view*: combined from several angles;
   - *AI estimate*: a guess, with its uncertainty.

   It asks for an extra view or one measurement only when that would change the result.
4. **Review.** One known measurement rescales the other sizes in the same photo, which are labelled *Calibrated* rather than *Confirmed*. You can correct anything. Items that already exist are merged by default (quantities add up), never silently duplicated. "Find products I can make" hands the inventory to the idea generator.

### Reuse first

Ideas, plans, purchase lists and costs all go through `shared/allocation.js`, a deterministic allocator. For each component it uses your stock first, then safe substitutes such as nails instead of screws or glue-only joints. It also adapts the design itself, for example a gusset shelf when you have no brackets, or tote straps cut from your fabric. Only then does it list the exact shortage.

- Each component is marked **Available**, **Available — adapt**, **Use substitute**, **Short**, **Must buy** (with the reason) or **Optional**. Optional upgrades never enter the shopping list unless you include them.
- Stock committed to other active projects isn't counted twice.
- AI suggestions are cross-checked against your inventory, so a model can't put something you own on your shopping list.
- Load-bearing wall fixings and candle safety labels deliberately have no improvised substitutes.
- Materials are only deducted from inventory when you tick that option while recording production.
- **Shopify:**
  1. Create a Shopify app.
  2. Set its redirect URL to `<SHOPIFY_CALLBACK_BASE>/api/integrations/shopify/callback`.
  3. Set `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`.
  4. Connect from Integrations.

  For local development Shopify needs a public HTTPS callback, such as a tunnel. The flow checks a one-time `state` value and verifies the callback HMAC. The token stays server-side. Products are created as **DRAFT** only after you confirm.

## Architecture

```
shared/        deterministic logic used by server and browser (economics, reuse-first allocation, measurement, lexicon, sourcing comparison)
server/
  ai/          Ollama client, prompts, zod schemas, web search
  engine/      demo engine: lexicon, parametric templates, cut-list packing, units
  services/    ideation, vision, channels, sourcing, analytics, advisor, shopify, examples
  routes/      Express routers (input validated with zod)
  db.js        SQLite schema (node:sqlite) behind small helpers — portable to PostgreSQL
src/           React + Vite app (pages, project workspace tabs, components, charts)
tests/         node:test: deterministic core, reuse scenarios, AI pipeline against a local Ollama API mock
  live/        end-to-end tests against the real Ollama model (npm run test:live)
```

Provenance is tracked for important values:

- BOM prices: your value / AI estimate / placeholder.
- Dimensions: AI estimate / from marking / calibrated / user-confirmed / verified.
- Sales: manual / CSV / Shopify / example.
- Supplier options: web search / your quote.

## Security & privacy

- Secrets stay in `.env` on the server. Store tokens are never sent to the browser.
- Helmet with CSP, zod validation on every write route, and a JSON body limit.
- Image uploads: images only, at most 8 MB and 6 files, kept in memory and never stored. They are downscaled in the browser, which also strips EXIF data.
- In-memory rate limits on AI routes. Formula-injection-safe CSV export.
- Nothing is purchased, published or repriced without explicit confirmation.

## Known limitations

- **Single-user, no login.** It is meant for local use. Put it behind your own authentication before exposing it on a network.
- **Dimensions from photos are estimates.** Calibration assumes the reference and the object share a plane and the photo is square-on. Depth sensing (WebXR) is only detected, not used. Always measure before cutting.
- The demo engine's library covers 8 product types: shelf, organiser, planter, stand, key holder, candles, coasters and tote bag. Its prices are static placeholders converted with fixed approximate rates.
- Channel fee numbers in demo mode are planning placeholders. Live platform fees are not fetched.
- Shopify: orders and draft products only. Fees and payouts are not imported. Other marketplaces are supported through CSV and manual recording only.
- **Local model quality.** With full GPU offload an idea list takes ≈25–35 s and a build plan ≈50–60 s on a 4 GB laptop GPU. A 4B model's reasoning is weak: in testing it suggested near-identical ideas, used a drill "to cut", and planned parts larger than the stock. The app catches oversize parts, missing cutting tools, invented materials and unnecessary purchases, but not every mistake (e.g. mismatched panel lengths) — check plans before cutting.
- **Previews are concept illustrations** drawn in SVG from the product type and material (22 kinds). They show what the product is, not its exact proportions; the Design tab has the measured assembly view.
- `npm test` runs against a local stand-in for the Ollama HTTP API (`tests/ollama-mock.js`) to cover request shape, images, schema output, validation, retries and error handling; the app itself never uses it. `npm run test:live` checks the real model end to end, but only that answers are valid and relevant, not how good they are.
- DuckDuckGo search is keyless but unofficial and may rate-limit heavy use. Use SearXNG for heavier research.
- The Shopify flow was not run against a live store.

## Workflow

**Enter materials → choose a realistic product → Build it → Sell it.**

- **Create:** describe what you have (amounts and sizes help but are optional). The only extra inputs are the tools you own and an optional spending limit. Ideas answer "can I build one?".
- **Project page:** a summary (picture, what you already have, anything missing), then two tabs. **Build it** is the step-by-step guide with progress. **Sell it** suggests 2–3 places to sell that product, a listing and a cautious price, generated when you open it — no questionnaire. Prices and fees are labelled as general guidance (not checked against live listings); the margin uses the app's cost calculation. Materials list, purchases, measured drawing, costs, production & sales and notes are under "More".
- **Analyze** (Analytics and Advisor pages): computes revenue, costs, profit, units, stock and per-product/per-channel results from recorded sales, says which records were used (and how many are example data), and asks the local model to explain only those numbers. With no sales it says "You haven't added any sales data yet." and offers to record a sale or import a CSV.

## Product pictures

Each idea card shows either an **example photo** or a **concept illustration**, and says which.

- **Example photos** (`public/products/`, 23 images) come from Wikimedia Commons and Openverse (Flickr) under free licences — CC0, public domain, CC BY or CC BY-SA. Each was reviewed by eye before being added. A photo shows that *kind* of product in that material (a wooden wall shelf, a jar candle, a fabric zip pouch…), not the user's exact design. `src/components/productPhotos.js` decides when one fits: kind and material must match, and the product's name must not describe a different design (a "two-tier shelf unit" doesn't get the single-shelf photo). One photo is never shown twice in the same list. Credits are on the About page (`/about#credits`) and in each photo's tooltip.
- **Concept illustrations** are drawn in SVG for everything else (cardboard organisers, bottle planters, bookshelves… — no suitable licensed photo was found). They show the product type in its material, not exact proportions. If a photo ever fails to load, the drawing is shown instead.

## About us

`/about` (linked next to Overview in the workspace and in the public navigation) explains the problem, the three steps, and what the app actually does, with a material-to-product animation built from the example photos. Motion respects reduced-motion settings.

## Deploying to Vercel

Locally the AI runs in your own Ollama. On Vercel there is no Ollama, so the server uses the **Ollama Cloud API** (`https://ollama.com`) instead — chosen automatically when the `VERCEL` environment variable is present (Vercel sets it).

How it fits together:

- `vercel.json` builds the Vite frontend into `dist/` and sends every `/api/*` request to `api/index.js`, which runs the same Express app as `npm run dev` (`server/app.js`). The function may run up to 300 s (the Hobby maximum); AI calls give up after 270 s with a clear "took too long" message instead of a cut connection.
- The API key is read only on the server (`OLLAMA_API_KEY`) and sent only to `ollama.com` in an `Authorization: Bearer` header. It never appears in the frontend, in API responses or in logs. Do not create a `VITE_` variable for it — those are bundled into browser code.
- Default cloud model: `gemma4:31b` — listed by `https://ollama.com/api/tags` and reported by `/api/show` with `vision` (photo input). Other current cloud models with vision include `kimi-k2.6`, `mistral-large-4` and `minimax-m3`; set `OLLAMA_MODEL` to switch.
- Photos are downscaled to 1024 px in the browser before analysis, which keeps uploads under Vercel's 4.5 MB request limit.
- Settings → AI engine and `GET /api/health` show the provider, model and what to fix (missing key, rejected key, rate limit, unknown model).
- On Ollama Cloud the app does not rely on structured outputs (`AI_JSON_MODE=prompt`): the JSON shape is described in the prompt, the reply is prefilled with its opening (`{"ideas": [ {`) so the model writes entries, and the answer is extracted from prose or code fences, repaired (trailing commas, quotes, numbers sent as text, missing fields) and validated, with one corrective retry. `AI_DEBUG=1` logs raw replies to the Vercel logs.

**Environment variables (Vercel → Project → Settings → Environment Variables):**

| Name | Required | Value |
|---|---|---|
| `OLLAMA_API_KEY` | yes | your key from https://ollama.com/settings/keys |
| `OLLAMA_MODEL` | no | defaults to `gemma4:31b` on Ollama Cloud |

Check the key before deploying: put `OLLAMA_API_KEY` in your local `.env` (git-ignored) and run `npm run test:cloud` — the full live suite (photo scan, ideas, build plan, selling guide, assistant) against Ollama Cloud.

**Storage limitation:** the app stores inventory and projects in SQLite. On Vercel the only writable place is `/tmp`, which is temporary and not shared between server instances — saved projects can disappear or be missing on the next request. The AI works fully; for lasting data on Vercel, move the database to a hosted service (e.g. Turso/libSQL or Postgres), or run the app on a host with a persistent disk (`npm run build && npm start`). Settings shows a warning while storage is temporary.
