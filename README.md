# ConstraintForge

Turn the materials, tools, skills and budget you already have into products you can build, sell and improve.

**Resources → ideas → feasibility → build plan → sourcing → costs → sales strategy → real sales → advisor**

## Quick start

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite`; developed on Node 24).

```bash
cd constraintforge
npm install
cp .env.example .env        # then set GEMINI_API_KEY (https://aistudio.google.com/apikey)
npm run dev                 # API on :8787 + web app on http://localhost:5173
```

Production build: `npm run build && npm start`, which serves the app and the API on `:8787`.
Tests: `npm test` (fast, no API key needed). `npm run test:live` sends real requests to Google Gemini through the running API (photo, scan, ideas, build plan, selling guide, assistant); it needs `GEMINI_API_KEY` and uses API quota.

All AI runs on **Google Gemini** (`gemini-3.8-flash`, via the official `@google/genai` SDK), called only from the server. If the key is missing or rejected, or Gemini is unavailable, AI features say so and offer a retry. They never show made-up results.

## Site structure & themes

- `/` is the public website: hero, discovery, how-it-works, product preview, business intelligence demo. The workspace only opens when you choose it.
- `/app/*` is the workspace: overview, create, scan, projects, sourcing, sales strategy, analytics, advisor, integrations, settings. Pre-redesign URLs such as `/analytics` redirect to their `/app/...` equivalents.
- There are two themes: **light** (white and forest green) and **dark** (black and forge orange). Both are built from one token set in `src/styles/app.css`. The toggle works on every page.
  - The choice is saved in `localStorage` (`cf-theme`). On a first visit the app follows the OS setting.
  - `public/theme-init.js` applies the theme before first paint, so there is no flash.
  - Switching uses a circular reveal where the browser supports View Transitions; elsewhere it uses a short cross-fade.
- Motion uses Framer Motion and respects `prefers-reduced-motion`.

## What works

| Area | Without AI | With Gemini configured |
|---|---|---|
| Inventory | Manual entry, editing, qualified dimensions | Same |
| Camera / upload | Real `getUserMedia` capture, multiple photos, upload, retake/remove | Same |
| Object recognition | Not available (stated clearly) | Gemini multimodal input → editable detected-item cards with confidence (photos sent at ≤1024 px) |
| Dimensions | Method E: click-to-calibrate against a known reference in the photo | Plus Method A (reference object detected), B (one known measurement rescales the same photo), C (multi-view) |
| Product ideas | Not available (stated clearly, no generic suggestions) | Open-ended Gemini ideation from your materials (structured JSON, validated with zod); gibberish is rejected |
| Ranking | — | Deterministic: buildable now → confirm a size/amount → needs a tool → needs a purchase; then share of parts from your stock, shortage cost, difficulty (model scores are not used) |
| Build plan | Parametric: dimensions, cut list packed onto your board sizes (kerf + trim), BOM, measured steps, inspection | Gemini plan (cuboid geometry, steps, BOM) |
| Assembly view | Isometric drawing from component cuboids; step highlighting | Same |
| Inventory sufficiency | Computed: max units from stock, shortfall per batch | Same |
| Economics | Deterministic engine (`shared/economics.js`): cash vs owned cost, fees, returns, break-even price and quantity, sensitivity, partial-sell scenarios | Same |
| Sourcing | Purchase checklist, outbound search links, manual quotes, best-option ranking by landed cost | Plus live web search; every listing URL is checked against the actual search results |
| Sales channels | Transparent rule-based ranking of channel types; fee numbers are labelled placeholders | Region-aware AI ranking + launch plan |
| Analytics | From recorded/imported sales only; per-sale profit audit; CSV export; conversion only when visit data exists | Same |
| Advisor | Rules for scenarios A–G with evidence, effect, assumptions, risks, test; simulator; approve/apply; before/after results | Plus plain-language AI explanations |
| Assistant | Page guidance | Conversational, sees the current page's data |
| Shopify | OAuth + GraphQL import/draft publish implemented; shows "not configured" without credentials | Same (credentials are separate from AI) |

Example projects are loaded only on request, carry an **Example** badge, and use simulated sales. They can be excluded from totals or removed with one click.

## Configuration

See `.env.example`.

- **AI (Google Gemini):** set `GEMINI_API_KEY` in `.env` (create a key at https://aistudio.google.com/apikey). The model is `gemini-3.8-flash`, called with the official `@google/genai` SDK (`server/ai/client.js`).
  - The key is read only from `GEMINI_API_KEY`, only on the server. It is never sent to the browser, never put in a `VITE_` variable, and never logged; health and Settings only say *where* it comes from.
  - On startup, and on each health check while it is down, the server checks the key and the model with a metadata call (no tokens used). The result is logged and shown in Settings → AI engine with what to fix (missing key, rejected key, rate limit, model unavailable).
  - Every structured call uses Gemini's structured output: `responseMimeType: application/json` plus the zod schema converted to the JSON Schema subset Gemini accepts (`toGeminiSchema` in `server/ai/json.js`). The reply is validated again with zod server-side; invalid output is retried once with the reason, and a second failure is reported as a retryable error — never replaced by made-up results. Totals and margins are never taken from model text.
  - Photos are sent as `inlineData` parts (multimodal input) after being downscaled to 1024 px in the browser.
  - Ideas come from two structured calls that run at the same time, each asked for half of `AI_MAX_IDEAS` (default 12) from a complementary angle (practical storage and household items / other purposes such as garden, kitchen, gifts and play), with a matching token budget; each call logs its time and token counts (`[ai] product ideas 1/2: 9.8s · prompt 2100 tok · output 4800 tok · STOP`).
  - Idea generation streams real progress to the browser (reading → ideas drafted so far → checking against stock) and can be cancelled; cancelling aborts the Gemini request. Web research only runs when you ask for it ("Find build guides online").
  - A Gemini request is aborted after `AI_TIMEOUT_MS` (120 s on Vercel, 180 s locally) with a clear "took too long" message. Rate limits (429) and Gemini outages (5xx) give retryable messages; a rejected key or unavailable model switches AI off until a re-probe succeeds.

### How ideas are generated

1. **Research first** (`server/services/ideaResearch.js`): while Gemini reads the description, the server already runs 2–3 real web searches that combine the materials ("DIY projects plastic bottle tape", "things to make from glass jar and tape"). Only titles and snippets are used (no page downloads), results are cached for an hour, and the whole step gives up after 8 s. If search fails, ideation continues on the model's own reasoning and the results say so.
2. **Two designers in parallel**: both get the inventory, the tools and the numbered research results, and are told that results are evidence, not answers — every possibility must be checked against the exact materials, amounts and tools. They name the results an idea relies on (`sourceRefs`); only real result numbers become "Inspired by" links.
3. **Checks** (below), then **duplicates**: names are compared by purpose ("pencil holder", "pen organizer" and "desk pencil container" are one idea), and at most two ideas of the same specific kind are kept.
4. **Only buildable ideas become cards** — buildable now, or after confirming an amount. Ideas that need a tool or material the user lacks are listed under "left out" with the reason.
5. **One-item unlock**: when fewer than 3 strong projects remain, the result names the ONE addition that unlocks the most. It is computed from the checked ideas whose only gap is that single item (and labelled as checked); otherwise it is the model's suggestion (labelled as not yet checked), and never something the user already owns. With no buildable idea at all the result says "I couldn't find a strong, realistic project using only these materials." and shows that one item and the projects it unlocks, with a button that adds it and generates again.

### Final quality gate

Every idea passes `server/services/qualityGate.js` before it can become a card (and is listed under "left out" with the reason otherwise):

- **Clear steps:** steps like "prepare the materials", "assemble the components" or "attach securely" are removed; fewer than two real steps, or no physical action at all, rejects the idea.
- **Exact tools:** every tool a step uses (scissors, knife, saw, drill, screwdriver, hammer, needle, hot-glue gun, stapler, pliers, clamps…) must be in the user's tools — the same list the feasibility check uses. A cut with no cutting tool, a drilled hole with no drill, or screws with only a hammer marks the idea as "needs a tool" (not a card; it can become the one-item suggestion). When the user does own the cutting tool, a cut step that doesn't name it gets "(use your scissors)" / "(use your hand saw)".
- **Glass safety:** cutting, drilling or breaking glass is rejected; glass may not hang from tape or glue (a cord, wire or hook is required), and a hanging jar gets a short safety note.
- **Real transformations:** an owned object under a new name for what it already does — a jar "vase", a box "storage box", a cup "pencil holder", a bottle "water container" — is rejected unless something structural is done (cut, folded, drilled, a part added) or a new function is created (hanging holder, funnel, scoop, feeder…). Decoration alone (wrapping, painting) does not count.
- **Material properties** are also spelled out in the prompt (glass is brittle; tape is light fastening only; cord can't make rigid surfaces; bottles can only be cut with a cutting tool; wood needs a saw and a joining method; cardboard is weak when wet).

### How ideas are grounded

The app checks every candidate and shows only those that hold up. For every idea:

- **physical sense** (`server/services/feasibility.js`): each product kind has rules — its main material must suit it (a shelf, stool or anything named for carrying weight must be wood or metal, so plastic bottles or cardboard are rejected), it must be made of a material you own, parts need a way to join that fits the material (screws for wood, glue or tape for cardboard), and cutting/sewing needs a tool that can do it (cutting only when the build steps actually cut). Steps that say nothing ("Assemble the materials") are removed, and an idea left with fewer than two real steps is not shown. A product whose name needs a part you don't have ("zipped bag", "clock") gets that part on the shopping list. Rejected ideas are listed with their reason under the results;
- the model's own tool list is used where it fits the materials (a soldering iron for electronics) or where its own steps use the tool; steps that drill, sew or solder imply that tool. An unknown amount of glue, sandpaper or thread doesn't hold up a build;
- each "uses your X" claim must match a real inventory item (or something you typed); claims about items you don't have are dropped, and an idea that uses nothing you own is not shown;
- owned parts and the model's shopping list go through the deterministic allocator (`shared/allocation.js`), so quantities are checked against your stock and only the exact shortfall is ever bought. Reusable equipment (a melting pot, scissors) is never multiplied by the batch;
- missing tools are computed from your tools, and the finished size is checked against your boards when sizes are known;
- materials you only typed are saved to your inventory when you open a blueprint, so the plan and bill of materials reuse them;
- build plans are checked too: a part cut larger than the stock it comes from, or a "cut" step when none of your tools can cut, is flagged at the top of the build guide.

Ideas are ordered by: buildable now → needs an amount or size confirmed, then by the model's best-first order (it is told to rank by feasibility with exactly these items, usefulness, fit to the materials, little waste and simplicity — no invented scores), then the share of parts from your stock and difficulty. Photo identifications the vision model was unsure about (< 60 % confidence) are marked as uncertain in the prompt, so they don't carry a design.
- **Web research (no key):** `SEARCH_PROVIDER=duckduckgo` (default), `searxng` with `SEARXNG_URL`, or `off`. The assistant uses Gemini function calling (`web_search`, `web_fetch`); the server runs those tools itself.
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
  ai/          Gemini client, prompts, zod schemas, web search
  engine/      demo engine: lexicon, parametric templates, cut-list packing, units
  services/    ideation, vision, channels, sourcing, analytics, advisor, shopify, examples
  routes/      Express routers (input validated with zod)
  db.js        SQLite schema (node:sqlite) behind small helpers — portable to PostgreSQL
src/           React + Vite app (pages, project workspace tabs, components, charts)
tests/         node:test: deterministic core, reuse scenarios, AI pipeline against a local Gemini API mock
  live/        end-to-end tests against the real Gemini API (npm run test:live, needs GEMINI_API_KEY)
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
- **Model mistakes.** The prompt forbids invented materials, impossible tool use and quantities beyond your stock, and the app independently catches oversize parts, missing cutting tools, invented materials and unnecessary purchases — but not every mistake (e.g. mismatched panel lengths). Check plans before cutting.
- **Pictures are AI-generated previews** of each project, drawn from its own materials, look and steps. They can still differ from the finished build in details (exact proportions, tape colour); the Design tab has the measured assembly view. Without image access (no billing on the key) cards show a neutral "no picture" panel.
- `npm test` runs against a local stand-in for the Gemini REST API (`tests/gemini-mock.js`) to cover request shape, images, schema output, validation, retries and error handling; the app itself never uses it. `npm run test:live` checks the real model end to end, but only that answers are valid and relevant, not how good they are.
- DuckDuckGo search is keyless but unofficial and may rate-limit heavy use. Use SearXNG for heavier research.
- The Shopify flow was not run against a live store.

## Build guides

The project page's guide (`generatePlan`) is generated for the exact card that was chosen: the prompt contains the card's own steps and `look` (the same description its picture is drawn from) and the complete list of the user's tools ("none — no cutting, drilling or sawing is possible" when empty). It asks for one physical action per step (usually 6–12): which object, which side, what to cut/fold/attach, where, with which owned tool, roughly how far, and what it looks like afterwards. A guide with vague steps is requested once more naming them, and any step that uses a tool the user doesn't own is flagged at the top of the guide.

## Workflow

**Enter materials → choose a realistic product → Build it → Sell it.**

- **Create:** describe what you have (amounts and sizes help but are optional). The only extra inputs are the tools you own and an optional spending limit. Ideas answer "can I build one?".
- **Project page:** a summary (picture, what you already have, anything missing), then two tabs. **Build it** is the step-by-step guide with progress. **Sell it** suggests 2–3 places to sell that product, a listing and a cautious price, generated when you open it — no questionnaire. Prices and fees are labelled as general guidance (not checked against live listings); the margin uses the app's cost calculation. Materials list, purchases, measured drawing, costs, production & sales and notes are under "More".
- **Analyze** (Analytics and Advisor pages): computes revenue, costs, profit, units, stock and per-product/per-channel results from recorded sales, says which records were used (and how many are example data), and asks the AI to explain only those numbers. With no sales it says "You haven't added any sales data yet." and offers to record a sale or import a CSV.

## Product pictures

Every idea card — and every saved project — shows a picture generated for **that exact project**, or an honest state: a skeleton while it is being made, or a neutral "No picture yet / Picture unavailable" panel. There are no stock photos and no generic category drawings on cards any more: earlier versions matched a licensed photo or an SVG drawing to the product *kind* (so a "Bottle rolling pin" could be drawn as a vase, and every wooden shelf showed the same stock shelf), which did not show the user's project.

- **Model and API:** a Google image model — by default `gemini-nano-banana-2.1` ("Nano Banana 2.1"), called through the Interactions API of the official `@google/genai` SDK (`ai.interactions.create` with `response_format: {type: 'image', mime_type: 'image/jpeg', aspect_ratio: '4:3', image_size: '1K'}`). `gemini-3.8-flash` itself does not generate images. `GEMINI_IMAGE_MODEL` can switch to e.g. `gemini-3.1-flash-lite-image`.
- **Same object as the card:** `server/ai/images.js` first builds a compact visual specification from the card itself — project name, visible materials with quantities, final shape (the card's `look`), construction method (its build steps), important visual details (hand-cut edges, hand-applied tape, knots) and **forbidden materials** (every material class the project does not use: with only a bottle and tape, no wood, screws, metal, rope, glue, electronics or fabric). The prompt asks for one photorealistic, clearly handmade object on a neutral tabletop, matching the construction, with no text, logos or people.
- **Asynchronous:** cards appear as soon as the ideas are checked; then every card's picture is requested (best card first, three at a time) and each card shows its picture as soon as it is ready. Saved projects without a picture get one when their card comes on screen (two at a time) and keep it.
- **Failures:** a timeout or server error is retried once; a failed picture leaves the neutral panel and never affects the ideas. If the key has no image access, the server stops trying for 30 minutes, `/api/health` → `ai.images` says why, and remaining cards show the neutral panel.
- **Vercel:** pictures are returned to the browser as data URLs (~100–200 KB JPEG at 1K) and stored inside the project's own record when a project is saved; the server cache in SQLite is only a best-effort saving (on Vercel it lives in `/tmp` and disappears on restart, which only means a picture may be generated again). No extra storage service is used. Trade-off: project records are larger, and an identical idea on a cold Vercel instance may be paid for twice.
- **Cost:** Google's image models have **no free tier** (about US$0.034 per 1K picture at the time of writing, so up to ~US$0.40 for a 12-card run). `AI_IMAGE_DAILY_LIMIT` (default 150/day) caps new pictures; `AI_IMAGES=off` disables them. Per-key rate limits are shown in Google AI Studio. Every generated image carries Google's SynthID watermark.
- The licensed example photos (`public/products/`) remain only on the About page.

## About us

`/about` (linked next to Overview in the workspace and in the public navigation) explains the problem, the three steps, and what the app actually does, with a material-to-product animation built from the example photos. Motion respects reduced-motion settings.

## Deploying to Vercel

The AI works the same locally and on Vercel: the server calls Google Gemini with `GEMINI_API_KEY`.

How it fits together:

- `vercel.json` builds the Vite frontend into `dist/` and sends every `/api/*` request to `api/index.js`, which runs the same Express app as `npm run dev` (`server/app.js`). The function may run up to 300 s (the Hobby maximum); on Vercel a Gemini request is aborted after 120 s (`AI_TIMEOUT_MS`), so even a call plus its one retry ends with a clear message instead of a cut connection.
- The API key is read only on the server (`GEMINI_API_KEY`) and sent only to Google's API in the `x-goog-api-key` header by the SDK. It never appears in the frontend, in API responses or in logs. Do not create a `VITE_` variable for it — those are bundled into browser code.
- Photos are downscaled to 1024 px in the browser before analysis, which keeps uploads under Vercel's 4.5 MB request limit.
- Settings → AI engine and `GET /api/health` show the provider, model and what to fix (missing key, rejected key, rate limit, model unavailable). `AI_DEBUG=1` logs raw model replies to the Vercel logs.

**Environment variables (Vercel → Project → Settings → Environment Variables):**

| Name | Required | Value |
|---|---|---|
| `GEMINI_API_KEY` | yes | your key from https://aistudio.google.com/apikey |
| `AI_TIMEOUT_MS` | no | per-request limit in ms (default 120000 on Vercel) |
| `AI_IMAGES` | no | `off` to never generate card pictures (they are paid only) |
| `GEMINI_IMAGE_MODEL` | no | defaults to `gemini-nano-banana-2.1` |
| `AI_IMAGE_DAILY_LIMIT` | no | max new pictures per day (default 150) |

Check the key before deploying: put `GEMINI_API_KEY` in your local `.env` (git-ignored) and run `npm run test:live` — the full live suite (photo input, scan, ideas, build plan, selling guide, assistant) against Gemini.

**Storage limitation:** the app stores inventory and projects in SQLite. On Vercel the only writable place is `/tmp`, which is temporary and not shared between server instances — saved projects can disappear or be missing on the next request. The AI works fully; for lasting data on Vercel, move the database to a hosted service (e.g. Turso/libSQL or Postgres), or run the app on a host with a persistent disk (`npm run build && npm start`). Settings shows a warning while storage is temporary.
