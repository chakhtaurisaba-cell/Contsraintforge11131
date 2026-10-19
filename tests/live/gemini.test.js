// LIVE tests against the real Google Gemini API (gemini-3.8-flash), using GEMINI_API_KEY from
// the environment or .env. Nothing here is mocked: each test sends real requests to the real
// model, through the client directly and through the real API server. They use API quota, so
// they run separately: `npm run test:live`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { z } from 'zod';
import { plankPng } from '../helpers.js';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}/api`;
const MINUTES = 60 * 1000;
const dir = mkdtempSync(join(tmpdir(), 'cf-live-'));
let server;
let client;
let liveIdea = null;
let liveProjectId = null;
let isNearDuplicate;

/** What the real model proposed, for a human to judge (cards, unlock, research). */
function logResult(name, j) {
  const lines = [`[live] CASE ${name}: ${j.status} · ${j.ideas.length} cards${j.research?.sources?.length ? ` · ${j.research.sources.length} web sources` : ''}${j.research?.error ? ` · research: ${j.research.error}` : ''}`];
  for (const i of j.ideas) lines.push(`  - ${i.name} [${i.verdict}] uses: ${i.usesExisting.map((u) => `${u.quantityUsed} ${u.inventoryName}`).join(', ')} · tools: ${i.toolsRequired.join(', ') || '—'}\n      looks: ${i.look || '—'}\n      steps: ${i.steps.join(' | ')}`);
  if (j.unlock) lines.push(`  unlock: ${j.unlock.item} — ${j.unlock.why} → ${j.unlock.ideas.map((i) => i.name).join(', ')}`);
  if (j.rejected?.length) lines.push(`  left out: ${j.rejected.map((x) => `${x.name} (${x.reason})`).join('; ')}`);
  console.log(lines.join('\n'));
}

/** HTTP request without fetch's 300 s header timeout. */
function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${path}`, { method, headers }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (s += c)).on('end', () => {
        let json = null;
        try {
          json = JSON.parse(s);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, json, raw: s });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
const postJSON = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } });

before(async () => {
  // Fail loudly (not skip) without a key or when Gemini is unreachable: these tests exist to
  // prove the real thing works.
  client = await import('../../server/ai/client.js');
  ({ isNearDuplicate } = await import('../../server/services/ideation.js'));
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'GEMINI_API_KEY is not set — add it to .env (or the environment) to run the live Gemini tests.');
  assert.ok(!process.env.GEMINI_BASE_URL, 'GEMINI_BASE_URL is for the mock tests only; unset it for live tests.');
  const status = await client.probeAI();
  assert.equal(status.state, 'ready', `Gemini not ready: ${status.state} — ${status.maintainerHint}`);

  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'live.db'), SEARCH_PROVIDER: process.env.SEARCH_PROVIDER || 'duckduckgo' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 30000);
    server.stdout.on('data', (d) => {
      process.stdout.write(`[server] ${d}`);
      if (/AI: (ready|\w+)/.test(String(d))) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  // Windows may hold the SQLite file briefly after exit.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('probe: the key is accepted and gemini-3.8-flash is available', () => {
  const s = client.aiStatus();
  assert.equal(s.available, true);
  assert.equal(s.provider, 'gemini');
  assert.equal(s.model, 'gemini-3.8-flash');
  assert.ok(!JSON.stringify(s).includes(process.env.GEMINI_API_KEY.trim()), 'the status never contains the key');
});

test('client: multimodal input — the real model reads a photo', { timeout: 5 * MINUTES }, async () => {
  const Schema = z.object({ objects: z.array(z.object({ name: z.string().min(1), material: z.string() })).min(1).max(5) });
  const out = await client.structured({
    system: 'You identify objects in photos. Answer in JSON only.',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: plankPng().toString('base64') } },
      { type: 'text', text: 'List the objects in this photo and what they are made of.' },
    ],
    schema: Schema,
    effort: 'low',
    maxTokens: 400,
  });
  assert.ok(out.objects.length >= 1);
  console.log('[live] photo objects:', JSON.stringify(out.objects));
});

test('client: schema-constrained generation returns validated JSON from the real model', { timeout: 10 * MINUTES }, async () => {
  const Schema = z.object({ material: z.string().min(1), uses: z.array(z.string().min(1)).min(1).max(5) });
  const out = await client.structured({
    system: 'You are a woodworking assistant. Answer in JSON only.',
    content: 'Name the material "pine board" and list up to 3 simple products a beginner could make from it.',
    schema: Schema,
    effort: 'low',
    maxTokens: 400,
  });
  assert.match(out.material.toLowerCase(), /pine|wood/);
  assert.ok(out.uses.length >= 1);
});

test('client: free-text generation answers the question', { timeout: 10 * MINUTES }, async () => {
  const out = await client.text({ system: 'Answer in one short sentence.', messages: [{ role: 'user', content: 'What tool drives screws into wood?' }], maxTokens: 120 });
  assert.ok(out.length > 3);
  assert.match(out.toLowerCase(), /screwdriver|drill|driver/);
});

test('API: /health reports Gemini as ready without exposing the key', async () => {
  const r = await request('/health');
  assert.equal(r.status, 200);
  assert.ok(!r.raw.includes(process.env.GEMINI_API_KEY.trim()), 'the key never reaches the browser');
  assert.equal(r.json.ai.enabled, true);
  assert.equal(r.json.ai.status.provider, 'gemini');
  assert.equal(r.json.ai.status.state, 'ready');
  assert.equal(r.json.ai.model, client.aiStatus().model);
});

test('API: /scan sends a real photo to the vision model and returns validated objects', { timeout: 15 * MINUTES }, async () => {
  const fd = new FormData();
  fd.append('images', new Blob([plankPng()], { type: 'image/png' }), 'plank.png');
  fd.append('goal', 'identify');
  fd.append('hint', 'A single wooden plank on a white table.');
  const encoded = new Response(fd);
  const body = Buffer.from(await encoded.arrayBuffer());
  const r = await request('/scan', { method: 'POST', body, headers: { 'content-type': encoded.headers.get('content-type') } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.imageCount, 1);
  assert.ok(Array.isArray(r.json.objects));
  assert.ok(r.json.objects.length >= 1, 'the model should see at least one object');
  for (const o of r.json.objects) {
    assert.ok(o.name.trim());
    assert.ok(o.confidence >= 0 && o.confidence <= 1);
  }
});

const OWNED_ONLY = (ideas, re) => ideas.every((i) => i.usesExisting.every((u) => re.test(u.inventoryName)) && i.missing.length === 0);
const CUTS = /\b(cut|cuts|cutting|trim|snip)\b(?!\s+(edges?|ends?|rims?))/i;
let imageCard = null;

/** Rules every card must follow, whatever the model proposed. */
function assertCards(ideas) {
  for (const i of ideas) {
    assert.ok(['ready', 'confirm'].includes(i.verdict), `${i.name} is a card but needs something: ${i.verdict}`);
    assert.ok(i.name.trim() && i.summary.trim() && i.whyFeasible.trim().length > 15, `${i.name}: name, description and why it works`);
    assert.ok(i.steps.length >= 3, `${i.name}: ${i.steps.length} steps`);
    for (const s of i.steps) assert.ok(s.split(/\s+/).length >= 4, `${i.name}: step too vague: "${s}"`);
    assert.ok(i.look?.trim(), `${i.name}: look (used for the picture)`);
    assert.ok(i.materials.length >= 1 && i.materials.every((m) => Number(m.needTotal) > 0), `${i.name}: materials with quantities`);
    assert.ok(i.estProductionMinutes > 0, `${i.name}: build time`);
    assert.equal(typeof i.sellable.realistic, 'boolean');
    assert.ok(!ideas.some((j) => j !== i && isNearDuplicate(i.name, j.name)), `near-duplicates: ${i.name}`);
  }
}
const assertOneItem = (unlock) => {
  assert.equal(typeof unlock.item, 'string');
  assert.ok(unlock.item.trim() && !/,| and /.test(unlock.item.replace(/\(.*\)/, '')), `ONE item, not a list: ${unlock.item}`);
  assert.ok(unlock.ideas.length >= 1, 'what it unlocks');
};

test('CASE A — 1 plastic bottle + tape, no tools: no cutting, nothing invented, several real projects (or an honest unlock)', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: '1 plastic bottle, tape', quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('A', r.json);
  assert.ok(['ok', 'unlock'].includes(r.json.status), r.json.message);
  assertCards(r.json.ideas);
  assert.ok(OWNED_ONLY(r.json.ideas, /bottle|tape/i), 'cards use only the bottle and tape');
  for (const i of r.json.ideas) assert.ok(!i.steps.some((s) => CUTS.test(s) || /scissors|knife/i.test(s)), `${i.name} cuts without a cutting tool`);
  if (r.json.status === 'ok' && !r.json.unlock) assert.ok(r.json.ideas.length >= 3, `more than 2 ideas expected, got ${r.json.ideas.length}`);
  if (r.json.unlock) assertOneItem(r.json.unlock);
});

test('CASE B — plastic bottle + tape + scissors: cut projects allowed, every cut names the scissors', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: '1 plastic bottle, tape', tools: ['Scissors'], quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('B', r.json);
  assert.equal(r.json.status, 'ok', r.json.message);
  assertCards(r.json.ideas);
  assert.ok(OWNED_ONLY(r.json.ideas, /bottle|tape/i), 'cards use only the bottle and tape');
  assert.ok(r.json.ideas.length >= 4, `many ideas expected, got ${r.json.ideas.length}`);
  for (const i of r.json.ideas) for (const s of i.steps.filter((x) => CUTS.test(x))) assert.match(s, /scissors/i, `${i.name}: "${s}"`);
  imageCard = r.json.ideas[0];
});

test('CASE C — glass jar + shoelace: no "vase" rename, no cut/drilled glass; otherwise ONE item', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: 'glass jar, shoelace', quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('C', r.json);
  assert.ok(['ok', 'unlock'].includes(r.json.status), r.json.message);
  assertCards(r.json.ideas);
  assert.ok(!r.json.ideas.some((i) => /\bvase\b/i.test(i.name)), 'no vase rename');
  assert.ok(!r.json.ideas.some((i) => i.steps.some((s) => /\b(cut|drill|score|break)\w*\b[^.]*\b(glass|jar)\b(?!\s*(lid|cap))/i.test(s))), 'no cutting or drilling glass');
  if (r.json.ideas.length < 3) assertOneItem(r.json.unlock);
});

test('CASE D — glass jar + tape + glue: no rename, no unsafe glass; if insufficient, ONE item and what it unlocks', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: 'glass jar, tape, glue', quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('D', r.json);
  assert.ok(['ok', 'unlock'].includes(r.json.status), r.json.message);
  assertCards(r.json.ideas);
  assert.ok(OWNED_ONLY(r.json.ideas, /jar|glass|tape|glue/i), 'cards use only the jar, tape and glue');
  assert.ok(!r.json.ideas.some((i) => /\bvase\b/i.test(i.name)), 'no vase rename');
  if (r.json.status === 'unlock') {
    assert.equal(r.json.ideas.length, 0);
    assert.match(r.json.message, /couldn’t find a strong, realistic project/);
  }
  if (r.json.ideas.length < 3) assertOneItem(r.json.unlock);
});

test('CASE E — 3 pine boards, screws, wood glue, sandpaper + hammer, hand saw: many realistic woodworking ideas', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: '3 pine boards, screws, wood glue, sandpaper, hammer, hand saw', quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('E', r.json);
  assert.equal(r.json.status, 'ok', r.json.message);
  assert.equal(r.json.engine, 'ai');
  const ideas = r.json.ideas;
  assertCards(ideas);
  assert.ok(ideas.length >= 4, `expected many ideas, got ${ideas.length}`);
  for (const i of ideas) {
    const boards = i.usesExisting.filter((u) => /pine|board/i.test(u.inventoryName)).reduce((s, u) => s + Number(u.quantityUsed || 0), 0);
    assert.ok(boards <= 3, `${i.name} uses ${boards} boards but only 3 are owned`);
    assert.ok(!i.steps.some((s) => /\bdrill/i.test(s)), `${i.name}: no drill owned`);
    assert.ok(!i.toolsRequired.some((t) => /drill|jigsaw|router|circular|sander|nail gun/i.test(t)), `${i.name}: ${i.toolsRequired}`);
  }
});

test('CASE F — one shoelace: no nonsense project; ONE item that unlocks useful ones', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: 'one shoelace', quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('F', r.json);
  assert.ok(['unlock', 'no_ideas', 'ok'].includes(r.json.status));
  assert.ok(r.json.ideas.length <= 2, 'a shoelace alone does not make many strong projects');
  if (r.json.status !== 'no_ideas') assertOneItem(r.json.unlock);
});

test('rich inventory: different subsets, high diversity, no near-duplicates', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: '6 pine boards, a plywood sheet, 100 wood screws, wood glue, 8 glass jars, jute twine, 2 m cotton fabric, 5 cardboard sheets, 10 plastic bottles, acrylic paint, sandpaper, LED string lights. Tools: saw, drill, scissors, hot glue gun.', quantity: 1 });
  assert.equal(r.status, 200, r.raw);
  logResult('rich', r.json);
  assert.equal(r.json.status, 'ok', r.json.message);
  const ideas = r.json.ideas;
  assertCards(ideas);
  assert.ok(ideas.length >= 6, `expected many ideas, got ${ideas.length}`);
  const subsets = new Set(ideas.map((i) => i.usesExisting.map((u) => u.inventoryName.toLowerCase()).sort().join('+')));
  assert.ok(subsets.size >= Math.min(5, ideas.length), 'different combinations of items');
  assert.ok(new Set(ideas.flatMap((i) => i.usesExisting.map((u) => u.inventoryName.toLowerCase()))).size >= 6, 'many different items used');
});

test('images: a REAL picture of a real card (from case B) from Google’s image model — skipped with the reason if the key has no image access', { timeout: 4 * MINUTES }, async (t) => {
  assert.ok(imageCard, 'needs a card from case B');
  const r = await postJSON('/ideas/image', { idea: { name: imageCard.name, summary: imageCard.summary, look: imageCard.look, steps: imageCard.steps, usesExisting: imageCard.usesExisting.map((u) => ({ inventoryName: u.inventoryName, use: u.use, quantityUsed: u.quantityUsed, unit: u.unit })), size: imageCard.size } });
  if (r.status === 503 && /images_(needs_billing|model_unavailable)/.test(r.json?.code)) {
    console.log(`[live] image generation unavailable for this key: ${r.json.error}`);
    t.skip(r.json.error);
    return;
  }
  assert.equal(r.status, 200, r.raw.slice(0, 300));
  assert.match(r.json.src, /^data:image\/(jpeg|png|webp);base64,/);
  assert.ok(r.json.src.length > 20000, 'a real picture, not a placeholder');
  // Saved for a human to look at: does it show THIS bottle project, with only bottle and tape?
  const { writeFileSync } = await import('node:fs');
  const out = join(tmpdir(), `cf-live-image-${Date.now()}.jpg`);
  writeFileSync(out, Buffer.from(r.json.src.split(',')[1], 'base64'));
  console.log(`[live] picture of "${imageCard.name}": ${Math.round((r.json.src.length * 0.75) / 1024)} KB from ${r.json.model} → ${out}`);
});

test('API: /ideas turns typed materials into AI-generated, scored product ideas',{ timeout: 15 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: 'I have 4 pine boards (1 m × 15 cm × 18 mm), a box of 100 wood screws, wood glue, a hand saw, a cordless drill, a tape measure and sandpaper. I am a beginner.', quantity: 3 });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.status, 'ok', r.json.message);
  assert.equal(r.json.engine, 'ai');
  assert.ok(r.json.ideas.length >= 1);
  assert.ok(r.json.runId);
  for (const idea of r.json.ideas) {
    assert.ok(idea.name.trim());
    assert.ok(['ready', 'confirm', 'tools', 'short'].includes(idea.verdict), idea.verdict);
    assert.ok(idea.fit.itemsUsed >= 1, 'every idea is built from the inventory');
    // Never told to buy something the text says they own in plenty.
    assert.ok(!idea.missing.some((m) => /pine|board|screw/i.test(m.name) && m.quantity > 0 && !/insufficient|short/i.test(m.reason || '')), JSON.stringify(idea.missing));
  }
  liveIdea = r.json.ideas[0];
});

test('API: a blueprint is planned from the chosen idea and the typed materials are reused', { timeout: 15 * MINUTES }, async () => {
  assert.ok(liveIdea, 'needs the idea from the previous test');
  const proj = await postJSON('/projects', { idea: liveIdea });
  assert.equal(proj.status, 201, proj.raw);
  assert.ok(proj.json.addedToInventory.some((n) => /pine|board/i.test(n)), 'typed materials are saved so the plan can reuse them');
  liveProjectId = proj.json.id;
  const plan = await postJSON(`/projects/${proj.json.id}/plan`, {});
  assert.equal(plan.status, 200, plan.raw);
  const p = plan.json.plan;
  assert.ok(p.steps.length >= 1 && p.steps.length <= 14);
  assert.ok(p.components.some((c) => /pine|board/i.test(c.fromInventory || '')), 'parts are cut from the user’s boards');
  const boards = plan.json.computed.allocation.lines.find((l) => /pine|board/i.test(l.name));
  assert.ok(boards && boards.status !== 'required_purchase', `owned boards must not be bought: ${JSON.stringify(boards)}`);
  assert.ok(Array.isArray(p.sizeIssues), 'size/tool checks ran');
});

test('API: /ideas rejects gibberish without inventing products', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/ideas', { freeText: 'qwzx plorf vrrt' });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.status, 'unrecognized');
  assert.equal(r.json.ideas.length, 0);
});

test('API: /assistant replies through the real model and stores the thread', { timeout: 10 * MINUTES }, async () => {
  const r = await postJSON('/assistant', { scope: 'page:dashboard', page: 'dashboard', message: 'In one sentence: what should I do first in this app?' });
  assert.equal(r.status, 200, r.raw);
  assert.ok(typeof r.json.reply === 'string' && r.json.reply.trim().length > 5);
  assert.equal(typeof r.json.searched, 'boolean');
  const thread = await request('/assistant/thread?scope=page:dashboard');
  assert.equal(thread.json.messages.length, 2);
});

test('API: Sell gives 1–3 channels, a listing and an unverified price for the chosen product', { timeout: 10 * MINUTES }, async () => {
  assert.ok(liveProjectId, 'needs the project from the previous test');
  const r = await postJSON(`/projects/${liveProjectId}/sell`, {});
  assert.equal(r.status, 200, r.raw);
  const g = r.json.strategy;
  assert.equal(g.kind, 'sell_guide');
  assert.ok(g.channels.length >= 1 && g.channels.length <= 3);
  assert.ok(g.listingTitle.trim() && g.listingDescription.trim());
  assert.equal(g.price.verified, false, 'prices are never presented as verified');
  assert.ok(g.price.high >= g.price.low);
});

test('API: Analyze with no recorded sales says so instead of returning nothing', async () => {
  const r = await postJSON('/advisor/run', {});
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.summary.hasData, false);
  assert.equal(r.json.summary.salesRecords, 0);
  assert.equal(r.json.overall, null, 'no AI narrative without data');
});
