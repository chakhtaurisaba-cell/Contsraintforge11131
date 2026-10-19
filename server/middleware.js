import { ZodError } from 'zod';
import multer from 'multer';
import { config } from './config.js';

/** Validates req.body against a zod schema and replaces it with the parsed value. */
export const validate = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const err = new Error(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    err.status = 400;
    return next(err);
  }
  req.body = parsed.data;
  next();
};

/** Small in-memory fixed-window rate limiter (per IP) for expensive AI routes. */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const t = Date.now();
    const entry = hits.get(key);
    if (!entry || t - entry.start > windowMs) {
      hits.set(key, { start: t, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - t) / 1000));
      return res.status(429).json({ error: 'Too many AI requests. Please wait a few minutes.' });
    }
    next();
  };
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const imageUpload = multer({
  storage: multer.memoryStorage(), // images are never written to disk
  limits: { fileSize: config.uploads.maxImageBytes, files: config.uploads.maxImages },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Only JPEG, PNG, WebP or GIF images are accepted.'), { status: 415 }));
  },
});

export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Unexpected error';
  if (err instanceof multer.MulterError) {
    status = 413;
    message = err.code === 'LIMIT_FILE_SIZE' ? `Image too large (max ${config.uploads.maxImageBytes / 1024 / 1024} MB).` : `Upload rejected: ${err.code}`;
  }
  if (err instanceof ZodError) status = 400;
  // Expected service errors (rate limit, timeout…) are already logged where they happen.
  if (status >= 500 && !err.status) {
    console.error('[error]', err);
    // Never leak internals for unexpected errors.
    if (!err.status) message = 'Something went wrong on the server.';
  }
  // A rate limit says how long to wait, as a header and in the body.
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
  res.status(status).json({ error: message, code: err.code || undefined, retryable: err.retryable || undefined, retryAfter: err.retryAfter || undefined });
}
