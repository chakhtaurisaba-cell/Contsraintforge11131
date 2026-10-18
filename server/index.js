import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import './db.js';
import { core } from './routes/core.js';
import { projects } from './routes/projects.js';
import { business } from './routes/business.js';
import { ai } from './routes/ai.js';
import { integrations } from './routes/integrations.js';
import { errorHandler } from './middleware.js';
import { aiEnabled, aiStatus, probeAI, requestScope, warmModel } from './ai/client.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(express.json({ limit: '2mb' }));
// If the browser goes away mid-request, stop the local model working on its answer.
app.use('/api', (req, res, next) => {
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  requestScope.run({ signal: ac.signal }, next);
});

app.use('/api', core, projects, business, ai, integrations);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built frontend.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`ConstraintForge API on http://localhost:${config.port}`);
  if (!aiEnabled()) console.log(`AI: not configured — ${aiStatus().maintainerHint}`);
  else probeAI().then((s) => {
    console.log(s.state === 'ready' ? `AI: ready (Ollama ${s.model} at ${s.host}; web search: ${s.search.available ? s.search.provider : 'off'})` : `AI: ${s.state} — ${s.maintainerHint || 'see logs'}`);
    // Load the model now so the first request doesn't wait for it.
    if (['ready', 'no_vision'].includes(s.state)) warmModel();
  });
});
