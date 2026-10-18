import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Send, X, CheckCircle2, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Button } from './ui.jsx';

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast ${t.type}`} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 30 }} layout>
            {t.type === 'error' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
            <span style={{ flex: 1 }}>{t.message}</span>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const SUGGESTIONS = {
  dashboard: ['What should I do next?', 'How do I start with my materials?'],
  create: ['How are ideas ranked?', 'What should I enter for budget?'],
  scan: ['How do I get accurate dimensions?', 'Why are sizes marked as estimates?'],
  project: ['Explain this step in more detail', 'Is my price profitable?'],
  analytics: ['Summarise my performance', 'Which channel is best?'],
  advisor: ['Which recommendation matters most?', 'How should I test this change?'],
};

export function AssistantPanel() {
  const { assistantOpen, setAssistantOpen, pageContext, aiEnabled } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const body = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Other parts of the app can open the assistant with a question (e.g. "Ask about this step").
  const sendRef = useRef(null);
  sendRef.current = send;
  useEffect(() => {
    const onAsk = (e) => {
      setAssistantOpen(true);
      sendRef.current?.(e.detail);
    };
    window.addEventListener('cf-ask', onAsk);
    return () => window.removeEventListener('cf-ask', onAsk);
  }, [setAssistantOpen]);

  // The server builds the context from the real saved data; the panel only says where we are.
  // Conversations are kept per project (or per page) on the server.
  const where = () => {
    const { page, data } = pageContext.current;
    const projectId = page === 'project' ? data?.id || null : null;
    return { page, projectId, scope: projectId ? `project:${projectId}` : `page:${page}` };
  };

  const [scope, setScope] = useState(null);
  useEffect(() => {
    if (!assistantOpen) return;
    const s = where().scope;
    if (s === scope) return;
    setScope(s);
    api.get(`/assistant/thread?scope=${encodeURIComponent(s)}`).then((r) => setMessages(r.messages)).catch(() => setMessages([]));
  }, [assistantOpen, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const w = where();
    if (w.scope !== scope) setScope(w.scope);
    setMessages((m) => [...(w.scope === scope ? m : []), { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api.post('/assistant', { scope: w.scope, page: w.page, projectId: w.projectId, message: q });
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, sources: r.sources }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${err.message}`, failed: q }]);
    } finally {
      setBusy(false);
    }
  }

  function retry(q) {
    setMessages((m) => m.slice(0, -2));
    send(q);
  }

  const page = pageContext.current.page;
  return (
    <>
      <AnimatePresence>
        {!assistantOpen && (
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
            <Button variant="primary" className="assistant-fab" icon={Bot} onClick={() => setAssistantOpen(true)} aria-label="Open AI assistant">
              <span className="fab-label">Ask the assistant</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {assistantOpen && (
          <motion.aside className="assistant" aria-label="AI assistant" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="assistant-head">
              <Bot size={18} className="accent-text" />
              <div style={{ flex: 1 }}>
                <div className="strong">Forge assistant</div>
                <div className="xs muted">{aiEnabled ? 'Knows your inventory and the open project' : 'The AI isn’t available right now'}</div>
              </div>
              <Button variant="ghost" size="sm" icon={X} onClick={() => setAssistantOpen(false)} aria-label="Close assistant" />
            </div>
            <div className="assistant-body" ref={body}>
              {!messages.length && (
                <div className="stack">
                  <p className="muted small">Ask about this page, your product, costs, or what to do next.</p>
                  {(SUGGESTIONS[page] || SUGGESTIONS.dashboard).map((s) => (
                    <button key={s} className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <motion.div key={i} className={`msg ${m.role}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  {m.content}
                  {m.sources?.length > 0 && (
                    <div className="xs" style={{ marginTop: 6 }}>
                      {m.sources.map((s) => (
                        <div key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></div>
                      ))}
                    </div>
                  )}
                  {m.failed && !busy && (
                    <div style={{ marginTop: 6 }}><Button size="sm" variant="ghost" onClick={() => retry(m.failed)}>Try again</Button></div>
                  )}
                </motion.div>
              ))}
              {busy && (
                <div className="msg assistant">
                  <span className="spinner" /> Thinking…
                </div>
              )}
            </div>
            <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" aria-label="Message" maxLength={4000} />
              <Button variant="primary" icon={Send} type="submit" disabled={!input.trim() || busy} aria-label="Send" />
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

