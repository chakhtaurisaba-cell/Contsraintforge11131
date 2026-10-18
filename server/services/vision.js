// Image analysis. Images are processed in memory and sent to the vision model;
// they are never written to disk or stored in the database.
import { aiEnabled, aiConfigured, structured, AIError } from '../ai/client.js';
import { ScanResult } from '../ai/schemas.js';
import { SYSTEM_VISION } from '../ai/prompts.js';
import { applyKnownMeasurement } from '../../shared/measure.js';

export { applyKnownMeasurement };

// What the user is trying to learn from the photos (drives the guidance the model returns).
const GOALS = {
  identify: 'Goal: identify what these objects are and how many there are. Do not ask for extra views unless identification is genuinely uncertain.',
  shape: 'Goal: understand the shape and physical form of the objects (proportions, profiles, components).',
  dimensions: 'Goal: estimate real dimensions as accurately as the evidence allows. Prefer a visible reference or markings; request one measurement or a side view only if it would materially improve accuracy.',
  inventory: 'Goal: build an inventory of several different objects; identify and count each one.',
};

/** Check real file signatures — the MIME type from the browser can be spoofed. */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  return null;
}

export async function analyseImages(files, { hint, known, goal = 'identify' } = {}) {
  if (!aiEnabled()) {
    throw aiConfigured()
      ? new AIError('Photo recognition is unavailable on this installation right now. You can still measure objects in your photo and add them by hand.', 503, 'ai_unavailable')
      : new AIError('Photo recognition is not set up on this installation. You can still measure objects in your photo and add them by hand.', 503, 'ai_not_configured');
  }
  const content = [];
  files.forEach((f, i) => {
    const type = sniffImageType(f.buffer);
    if (!type) throw Object.assign(new Error(`Photo ${i + 1} is not a valid JPEG, PNG, WebP or GIF image.`), { status: 415, code: 'bad_image' });
    content.push({ type: 'text', text: `Image ${i}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: type, data: f.buffer.toString('base64') } });
  });
  let instruction = `${GOALS[goal] || GOALS.identify}\nIdentify every usable material, component and tool in these ${files.length} image(s) and build an editable inventory.`;
  if (files.length > 1) instruction += ' The images may show the same objects from different angles — merge them into single entries and use the extra views to improve shape and size estimates.';
  if (hint) instruction += `\nUser note: ${hint}`;
  if (known?.objectName && known?.value) instruction += `\nKnown measurement from the user: the ${known.dimension || 'length'} of "${known.objectName}" is ${known.value} ${known.unit || 'mm'}. Use it as the scale reference.`;
  content.push({ type: 'text', text: instruction });

  const result = await structured({ system: SYSTEM_VISION, content, schema: ScanResult, effort: 'medium', maxTokens: 2500, label: 'scan photos' });
  // Sanitise model output before it reaches the UI: clamp numbers, drop impossible values.
  const objects = result.objects
    .map((o) => ({
      ...o,
      quantity: Number.isFinite(o.quantity) && o.quantity > 0 ? Math.round(o.quantity * 100) / 100 : 1,
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
      imageIndex: Math.max(0, Math.min(files.length - 1, o.imageIndex | 0)),
      seenInImages: (o.seenInImages || []).filter((i) => i >= 0 && i < files.length),
      dimensions: {
        ...o.dimensions,
        ...Object.fromEntries(['length', 'width', 'height', 'diameter', 'thickness'].map((k) => [k, Number(o.dimensions[k]) > 0 ? o.dimensions[k] : null])),
        uncertaintyPct: Math.max(0, Math.min(100, Number(o.dimensions.uncertaintyPct) || 0)),
      },
    }))
    .filter((o) => o.name?.trim());
  const calibrated = applyKnownMeasurement(objects, known);
  return {
    ...result,
    objects: calibrated.objects,
    knownMeasurementApplied: calibrated.applied,
    scaleFactor: calibrated.factor ?? null,
    imageCount: files.length,
    goal,
  };
}
