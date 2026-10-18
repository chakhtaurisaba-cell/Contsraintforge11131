import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const [health, setHealth] = useState(null);
  const [settings, setSettings] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const pageContext = useRef({ page: 'dashboard', data: null });
  const toastId = useRef(0);

  const toast = useCallback((message, type = 'success') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6500 : 3800);
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await api.get('/settings');
    setSettings(s);
    return s;
  }, []);

  const saveSettings = useCallback(async (patch) => {
    const s = await api.put('/settings', patch);
    setSettings(s);
    return s;
  }, []);

  useEffect(() => {
    api.get('/health').then(setHealth).catch(() => setHealth({ ok: false }));
    refreshSettings().catch(() => {});
  }, [refreshSettings]);

  const setPageContext = useCallback((page, data) => {
    pageContext.current = { page, data };
  }, []);

  const value = useMemo(
    () => ({
      health,
      aiEnabled: Boolean(health?.ai?.enabled),
      settings,
      currency: settings?.currency || 'GEL',
      refreshSettings,
      saveSettings,
      toast,
      toasts,
      dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
      assistantOpen,
      setAssistantOpen,
      pageContext,
      setPageContext,
    }),
    [health, settings, refreshSettings, saveSettings, toast, toasts, assistantOpen, setPageContext]
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);
