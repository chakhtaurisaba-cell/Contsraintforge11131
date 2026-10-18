// Shared UI primitives.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { DIMENSION_STATUS, statusLabel } from '../../shared/constants.js';

/** Brand mark: two measurement ticks (constraint) framing a forged spark (forge). */
export function LogoMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M29 20v7a2 2 0 0 1-2 2h-7" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 7.5 L19.2 16 L16 24.5 L12.8 16 Z" fill="var(--text)" />
      <path d="M7.5 16 L16 12.8 L24.5 16 L16 19.2 Z" fill="var(--accent-bright)" opacity="0.9" />
      <circle cx="16" cy="16" r="1.6" fill="var(--bg)" />
    </svg>
  );
}

export function Logo({ size = 28, withText = true }) {
  return (
    <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
      <LogoMark size={size} />
      {withText && (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.035em', lineHeight: 1 }}>
          Constraint<span className="accent-text">Forge</span>
        </span>
      )}
    </div>
  );
}

export function Page({ eyebrow, title, sub, actions, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className="page" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
      <header className="page-header">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </motion.div>
  );
}

export function Card({ title, sub, actions, children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = '', size = '', icon: Icon, loading, children, className = '', ...rest }) {
  return (
    <button className={`btn ${variant ? `btn-${variant}` : ''} ${size ? `btn-${size}` : ''} ${!children ? 'btn-icon' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export const Badge = ({ tone = '', children, title, icon: Icon }) => (
  <span className={`badge ${tone ? `badge-${tone}` : ''}`} title={title}>
    {Icon && <Icon size={12} aria-hidden="true" />}
    {children}
  </span>
);

export const ExampleBadge = () => <Badge tone="example" title="Simulated example data — not your real business">Example</Badge>;

const STATUS_TONES = { idea: '', feasibility: 'info', design: 'info', materials_needed: 'warn', ready_to_build: 'accent', in_production: 'accent', ready_to_sell: 'ok', listed: 'ok', selling: 'ok', needs_improvement: 'danger', archived: '' };
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONES[status]}>{statusLabel(status)}</Badge>;

/** Where a number or measurement came from. */
const PROVENANCE = {
  user: { label: 'Your value', tone: 'ok' },
  ai_estimate: { label: 'AI estimate', tone: 'warn' },
  demo_estimate: { label: 'Placeholder estimate', tone: 'warn' },
  listing: { label: 'Listing price', tone: 'info' },
  web_search: { label: 'Web search result', tone: 'info' },
  manual_quote: { label: 'Your quote', tone: 'ok' },
  calculated: { label: 'Calculated', tone: 'info' },
  example: { label: 'Example data', tone: 'example' },
  csv: { label: 'CSV import', tone: 'info' },
  shopify: { label: 'Shopify import', tone: 'info' },
  manual: { label: 'Recorded by you', tone: 'ok' },
};
export const Provenance = ({ source }) => {
  const p = PROVENANCE[source] || DIMENSION_STATUS[source];
  if (!p) return null;
  return <Badge tone={p.tone}>{p.label}</Badge>;
};

export function DimensionTag({ status, uncertainty }) {
  const s = DIMENSION_STATUS[status];
  if (!s) return <Badge>Unmeasured</Badge>;
  return (
    <Badge tone={s.tone} title={s.note}>
      {s.label}
      {uncertainty ? ` ±${Math.round(uncertainty)}%` : ''}
    </Badge>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Number input that keeps empty as null. */
export function NumberInput({ value, onChange, min, step = 'any', suffix, className = '', ...rest }) {
  const input = (
    <input
      type="number"
      inputMode="decimal"
      className={`input ${className}`}
      value={value ?? ''}
      min={min}
      step={step}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      {...rest}
    />
  );
  return suffix ? (
    <div className="input-group">
      {input}
      <span className="addon">{suffix}</span>
    </div>
  ) : (
    input
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon size={15} aria-hidden="true" />}
          {t.label}
          {t.badge != null && <span className="badge" style={{ height: 18 }}>{t.badge}</span>}
          {value === t.id && <motion.span layoutId="tab-line" className="tab-line" />}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, foot, icon: Icon, tone }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {Icon && <Icon size={14} aria-hidden="true" />}
        {label}
      </div>
      <div className={`stat-value num ${tone ? `${tone}-text` : ''}`}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="empty-art">
          <Icon size={32} strokeWidth={1.5} />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p className="muted" style={{ maxWidth: 460 }}>{children}</p>}
      {action}
    </div>
  );
}

export function Banner({ tone = 'info', children, icon }) {
  const I = icon || { warn: AlertTriangle, danger: XCircle, ok: CheckCircle2 }[tone] || Info;
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      <I size={16} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export const Skeleton = ({ h = 16, w = '100%', style }) => <div className="skeleton" style={{ height: h, width: w, ...style }} />;

export function LoadingBlock({ rows = 3 }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={i === 0 ? 22 : 14} w={i === 0 ? '40%' : `${90 - i * 12}%`} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Banner tone="danger">
      <div className="row-between">
        <span>{error?.message || 'Something went wrong.'}</span>
        {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
      </div>
    </Banner>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
          <motion.div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} initial={{ y: 16, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="modal-head">
              <h3>{title}</h3>
              <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
            </div>
            {children}
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ScoreBar({ label, value, color = 'var(--accent)' }) {
  return (
    <div className="scorebar">
      <span>{label}</span>
      <div className="track" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <motion.span initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} style={{ background: color }} />
      </div>
      <span className="num right">{value}</span>
    </div>
  );
}

export function Progress({ value }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <motion.span initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.5 }} />
    </div>
  );
}

export const Stagger = ({ children, className = '', style }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} style={style} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.05 } } }}>
      {children}
    </motion.div>
  );
};
export const StaggerItem = ({ children, className = '', ...rest }) => (
  <motion.div className={className} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } }} {...rest}>
    {children}
  </motion.div>
);
