import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, CameraOff, Circle, RefreshCw, Upload, SwitchCamera } from 'lucide-react';
import { Button, Banner } from './ui.jsx';

const MAX_SIDE = 1600;

/** Downscale an image source to ≤ MAX_SIDE px JPEG. Keeps uploads small and strips EXIF metadata. */
// Photos sent for AI analysis: the model gains nothing above ~1024 px (same token cost, slower
// to encode), and it keeps uploads well under hosting limits (Vercel: 4.5 MB per request).
export const AI_MAX_SIDE = 1024;

export async function normaliseImage(source, maxSide = MAX_SIDE) {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
  const w = bitmap.videoWidth || bitmap.width;
  const h = bitmap.videoHeight || bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

export function CameraCapture({ onCapture, disabled }) {
  const video = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('idle'); // idle | starting | live | error
  const [error, setError] = useState(null);
  const [facing, setFacing] = useState('environment');
  const [flash, setFlash] = useState(false);
  const fileInput = useRef(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
  }, []);

  useEffect(() => stop, [stop]);

  async function start(nextFacing = facing) {
    setError(null);
    if (!window.isSecureContext) {
      setState('error');
      setError('Camera access requires a secure connection (HTTPS or localhost). You can still upload photos.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError('This browser does not support camera access. Upload photos instead.');
      return;
    }
    setState('starting');
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextFacing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      streamRef.current = stream;
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      setState('live');
    } catch (err) {
      setState('error');
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') setError('Camera permission was denied. Allow camera access in your browser settings, or upload photos instead.');
      else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') setError('No camera was found on this device. Upload photos instead.');
      else if (err.name === 'NotReadableError') setError('The camera is in use by another application.');
      else setError(`Could not start the camera (${err.name}).`);
    }
  }

  async function capture() {
    if (!video.current || state !== 'live') return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    onCapture(await normaliseImage(video.current));
  }

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        onCapture(await normaliseImage(f));
      } catch {
        setError(`Could not read ${f.name}.`);
      }
    }
    e.target.value = '';
  }

  return (
    <div className="stack">
      <div className="camera-frame">
        <video ref={video} playsInline muted style={{ display: state === 'live' ? 'block' : 'none' }} aria-label="Live camera preview" />
        {state !== 'live' && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20 }}>
            <div className="stack" style={{ alignItems: 'center' }}>
              <div className="empty-art"><Camera size={30} /></div>
              <div className="text-2 small" style={{ maxWidth: 320 }}>
                {state === 'starting'
                  ? 'Waiting for camera permission…'
                  : 'Your browser will ask for camera access. It is used only to photograph your materials — nothing is captured until you press “Take photo”.'}
              </div>
            </div>
          </div>
        )}
        {state === 'live' && (
          <>
            <div className="camera-reticle" />
            <motion.div className="scan-line" initial={{ top: '12%' }} animate={{ top: ['12%', '88%', '12%'] }} transition={{ repeat: Infinity, duration: 3.2, ease: 'easeInOut' }} />
          </>
        )}
        {flash && <div style={{ position: 'absolute', inset: 0, background: 'white', opacity: 0.6 }} />}
      </div>
      {error && <Banner tone="warn">{error}</Banner>}
      <div className="row">
        {state !== 'live' ? (
          <Button variant="primary" icon={Camera} onClick={() => start()} loading={state === 'starting'} disabled={disabled}>Start camera</Button>
        ) : (
          <>
            <Button variant="primary" icon={Circle} onClick={capture} disabled={disabled}>Take photo</Button>
            <Button icon={SwitchCamera} onClick={() => { const f = facing === 'environment' ? 'user' : 'environment'; setFacing(f); start(f); }} aria-label="Switch camera" />
            <Button icon={CameraOff} onClick={stop}>Stop</Button>
          </>
        )}
        <Button icon={Upload} onClick={() => fileInput.current?.click()} disabled={disabled}>Upload photos</Button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onFiles} />
        {state === 'error' && <Button variant="ghost" icon={RefreshCw} onClick={() => start()}>Retry</Button>}
      </div>
    </div>
  );
}
