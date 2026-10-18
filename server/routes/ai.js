import { Router } from 'express';
import { z } from 'zod';
import { imageUpload, validate, rateLimit } from '../middleware.js';
import { analyseImages } from '../services/vision.js';
import { assistantRoutes } from '../services/assistant.js';

export const ai = Router();
const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 40 });

/* ---------- image scan ---------- */
ai.post('/scan', limit, imageUpload.array('images'), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Attach at least one image.' });
  let known = null;
  if (req.body.known) {
    try {
      known = z.object({ objectName: z.string().max(120), dimension: z.enum(['length', 'width', 'height', 'diameter', 'thickness']).default('length'), value: z.coerce.number().positive(), unit: z.enum(['mm', 'cm', 'in']).default('mm') }).parse(JSON.parse(req.body.known));
    } catch {
      return res.status(400).json({ error: 'Invalid known-measurement data.' });
    }
  }
  const goal = ['identify', 'shape', 'dimensions', 'inventory'].includes(req.body.goal) ? req.body.goal : 'identify';
  const result = await analyseImages(files, { hint: String(req.body.hint || '').slice(0, 1000), known, goal });
  res.json(result);
});

/* ---------- contextual assistant ---------- */
assistantRoutes(ai, limit);
