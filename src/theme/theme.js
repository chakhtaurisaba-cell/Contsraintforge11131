// Theme store: one source of truth (the data-theme attribute), persisted to
// localStorage, OS preference on first visit, subscribable from React.
import { useSyncExternalStore } from 'react';

const KEY = 'cf-theme';
const listeners = new Set();

export const getTheme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0b0b0d' : '#ffffff';
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — theme still applies for this session */
  }
  listeners.forEach((l) => l());
}

/**
 * Switch theme with a circular reveal from (x, y) when the View Transitions API is
 * available; otherwise a short colour cross-fade. Respects reduced motion.
 */
export function setTheme(theme, origin) {
  if (theme === getTheme()) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  if (!reduce && document.startViewTransition && origin) {
    const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    const t = document.startViewTransition(() => apply(theme));
    t.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`] },
          { duration: 650, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      })
      .catch(() => {});
    return;
  }
  if (!reduce) {
    root.classList.add('theme-fade');
    setTimeout(() => root.classList.remove('theme-fade'), 500);
  }
  apply(theme);
}

export const toggleTheme = (origin) => setTheme(getTheme() === 'dark' ? 'light' : 'dark', origin);

const subscribe = (cb) => {
  listeners.add(cb);
  // Follow OS changes only while the user has not made an explicit choice.
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onOs = (e) => {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (!saved) apply(e.matches ? 'dark' : 'light');
  };
  mq.addEventListener?.('change', onOs);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener?.('change', onOs);
  };
};

export const useTheme = () => useSyncExternalStore(subscribe, getTheme, () => 'light');
