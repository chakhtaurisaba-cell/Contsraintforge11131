// Motion primitives for the public site. All pointer-driven effects use motion
// values (no React re-render per frame) and switch off for touch / reduced motion.
import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';

export const EASE = [0.22, 1, 0.36, 1];

/** Fade-and-rise when scrolled into view. */
export function Reveal({ children, delay = 0, y = 26, className = '', as = 'div', ...rest }) {
  const reduce = useReducedMotion();
  const C = motion[as];
  return (
    <C
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.8, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </C>
  );
}

/** Splits a headline into words that rise in sequence. */
export function SplitWords({ text, className = '', delay = 0, stagger = 0.06 }) {
  const reduce = useReducedMotion();
  return (
    <span className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <span key={i} aria-hidden="true" style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
          <motion.span
            style={{ display: 'inline-block' }}
            initial={reduce ? false : { y: '110%' }}
            animate={{ y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: delay + i * stagger }}
          >
            {w}
            {' '}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Button/link that leans slightly toward the cursor. */
export function Magnetic({ children, strength = 0.28, className = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 260, damping: 18 });
  const y = useSpring(useMotionValue(0), { stiffness: 260, damping: 18 });
  const move = (e) => {
    if (reduce || !finePointer()) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  return (
    <motion.span ref={ref} className={className} style={{ display: 'inline-flex', x, y }} onPointerMove={move} onPointerLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.span>
  );
}

/** Tilts its content in 3D with the cursor (desktop only). */
export function useTilt(max = 8) {
  const reduce = useReducedMotion();
  const rx = useSpring(0, { stiffness: 120, damping: 20 });
  const ry = useSpring(0, { stiffness: 120, damping: 20 });
  const px = useSpring(0, { stiffness: 120, damping: 20 });
  const py = useSpring(0, { stiffness: 120, damping: 20 });
  const onPointerMove = (e) => {
    if (reduce || !finePointer()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    ry.set(nx * max);
    rx.set(-ny * max);
    px.set(nx);
    py.set(ny);
  };
  const onPointerLeave = () => { rx.set(0); ry.set(0); px.set(0); py.set(0); };
  return { rx, ry, px, py, handlers: { onPointerMove, onPointerLeave } };
}
