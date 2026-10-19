// Local server: `npm run dev` / `npm start`. (On Vercel, api/index.js serves the same app.)
import { config } from './config.js';
import { app } from './app.js';
import { aiEnabled, aiStatus, probeAI } from './ai/client.js';

app.listen(config.port, () => {
  console.log(`ConstraintForge API on http://localhost:${config.port}`);
  if (!aiEnabled()) console.log(`AI: not configured — ${aiStatus().maintainerHint}`);
  else probeAI().then((s) => {
    console.log(s.state === 'ready' ? `AI: ready (Gemini ${s.model}; web search: ${s.search.available ? s.search.provider : 'off'})` : `AI: ${s.state} — ${s.maintainerHint || 'see logs'}`);
  });
});
