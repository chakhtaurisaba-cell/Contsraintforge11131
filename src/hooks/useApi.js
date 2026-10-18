import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

/** Loads `path` on mount / when deps change; exposes reload and local setData. */
export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const ctrl = useRef(null);

  const load = useCallback(async () => {
    if (!path) return null;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      const d = await api.get(path, { signal: c.signal });
      setData(d);
      return d;
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
      return null;
    } finally {
      if (ctrl.current === c) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    load();
    return () => ctrl.current?.abort();
  }, [load]);

  return { data, setData, error, loading, reload: load };
}

/** Wraps an async action with busy state and error toasts. */
export function useAction(toast) {
  const [busy, setBusy] = useState(null);
  const run = useCallback(
    async (key, fn, successMsg) => {
      setBusy(key);
      try {
        const r = await fn();
        if (successMsg) toast?.(successMsg, 'success');
        return r;
      } catch (err) {
        toast?.(err.message || 'Something went wrong', 'error');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );
  return { busy, run };
}
