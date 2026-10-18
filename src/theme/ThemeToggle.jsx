import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useTheme, toggleTheme } from './theme.js';

/** Sliding knob that carries a sun (light / green) or moon (dark / orange). */
export function ThemeToggle({ className = '' }) {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <Sun size={12} className="track-icon" style={{ left: 9, opacity: dark ? 0.7 : 0 }} aria-hidden="true" />
      <Moon size={12} className="track-icon" style={{ right: 9, opacity: dark ? 0 : 0.7 }} aria-hidden="true" />
      <motion.span className="knob" animate={{ x: dark ? 26 : 0, rotate: dark ? 360 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={theme} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 90 }} transition={{ duration: 0.2 }} style={{ display: 'grid' }}>
            {dark ? <Moon size={13} strokeWidth={2.4} /> : <Sun size={13} strokeWidth={2.4} />}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </button>
  );
}
