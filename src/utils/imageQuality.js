// Fast, local photo-quality check (runs in the browser before anything is uploaded).
// Measures brightness, contrast and sharpness (variance of the Laplacian) on a
// downscaled greyscale copy. Results are advice — the user can keep any photo.

const SIZE = 320;

export async function checkImageQuality(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = SIZE / Math.max(bmp.width, bmp.height);
    const w = Math.max(8, Math.round(bmp.width * scale));
    const h = Math.max(8, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const g = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += g[p];
    }
    const mean = sum / g.length;
    let varSum = 0;
    for (let p = 0; p < g.length; p++) varSum += (g[p] - mean) ** 2;
    const contrast = Math.sqrt(varSum / g.length);
    // Laplacian variance (edge energy) — low values mean a blurry photo.
    let lapSum = 0;
    let lapSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const lap = g[p - w] + g[p + w] + g[p - 1] + g[p + 1] - 4 * g[p];
        lapSum += lap;
        lapSq += lap * lap;
        n++;
      }
    }
    const lapMean = lapSum / n;
    const sharpness = lapSq / n - lapMean * lapMean;
    const issues = [];
    if (mean < 45) issues.push({ code: 'dark', text: 'Too dark — add light or move closer to a window.' });
    else if (mean > 235) issues.push({ code: 'bright', text: 'Overexposed — avoid direct light or flash glare.' });
    if (contrast < 14) issues.push({ code: 'flat', text: 'Very low contrast — objects may blend into the background.' });
    if (sharpness < 18) issues.push({ code: 'blurry', text: 'Looks blurry — hold still and tap to focus before taking it.' });
    return { ok: issues.length === 0, issues, metrics: { brightness: Math.round(mean), contrast: Math.round(contrast), sharpness: Math.round(sharpness) } };
  } catch {
    return { ok: true, issues: [], metrics: null };
  }
}
