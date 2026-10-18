// The Express app, without starting a server: `server/index.js` listens on a port for local
// use, and `api/index.js` hands the same app to Vercel as a serverless function.
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
import { requestScope } from './ai/client.js';

export const app = express();
app.disable('x-powered-by');
// Behind Vercel's proxy the client address comes from X-Forwarded-For (used by the rate limits).
app.set('trust proxy', config.onVercel ? 1 : 'loopback');
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
// If the browser goes away mid-request, stop the model working on its answer.
app.use('/api', (req, res, next) => {
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  requestScope.run({ signal: ac.signal }, next);
});

app.use('/api', core, projects, business, ai, integrations);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// `npm start` serves the built frontend too. On Vercel the frontend is served by the CDN.
const dist = resolve('dist');
if (!config.onVercel && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.use(errorHandler);

export default app;
