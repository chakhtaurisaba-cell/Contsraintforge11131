// Vercel serverless entry: every /api/* request (see vercel.json) is handled by the same
// Express app that `npm run dev` runs locally. AI calls go to Ollama Cloud with the
// server-side OLLAMA_API_KEY (see server/config.js).
import app from '../server/app.js';

export default app;
