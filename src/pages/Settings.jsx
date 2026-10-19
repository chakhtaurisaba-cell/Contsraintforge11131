import { useEffect, useState } from 'react';
import { Save, Cpu, ShieldCheck, FlaskConical, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useAction } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { Page, Card, Button, Field, NumberInput, Badge, Banner, LoadingBlock } from '../components/ui.jsx';
import { REGIONS, CURRENCIES } from '../../shared/constants.js';

export default function Settings() {
  const { settings, saveSettings, health, toast, setPageContext } = useApp();
  const { busy, run } = useAction(toast);
  const [s, setS] = useState(settings);
  useEffect(() => { setS(settings); }, [settings]);
  useEffect(() => { setPageContext('settings', settings); }, [settings, setPageContext]);
  if (!s) return <div className="page"><LoadingBlock /></div>;
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));

  return (
    <Page eyebrow="Preferences" title="Settings">
      <div className="grid g-main" style={{ alignItems: 'start' }}>
        <Card title="Business" actions={<Button variant="primary" icon={Save} loading={busy === 'save'} onClick={() => run('save', () => saveSettings({ businessName: s.businessName || '', region: s.region, currency: s.currency, laborRatePerHour: s.laborRatePerHour || 0, deliveryOptions: s.deliveryOptions, marketingHoursPerWeek: s.marketingHoursPerWeek || 0, audienceSize: s.audienceSize || 0, includeExamples: s.includeExamples }), 'Settings saved')}>Save</Button>}>
          <div className="stack-lg">
            <div className="form-grid">
              <Field label="Business / workshop name"><input className="input" maxLength={120} value={s.businessName || ''} onChange={(e) => set('businessName', e.target.value)} /></Field>
              <Field label="Region">
                <select className="select" value={s.region} onChange={(e) => { const r = REGIONS.find((x) => x.id === e.target.value); setS({ ...s, region: r.id, currency: r.currency }); }}>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Currency" hint="Existing amounts are not converted"><select className="select" value={s.currency} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Your labour rate / hour" hint="Default for new projects"><NumberInput value={s.laborRatePerHour} min={0} onChange={(v) => set('laborRatePerHour', v)} suffix={s.currency} /></Field>
              <Field label="Marketing time / week"><NumberInput value={s.marketingHoursPerWeek} min={0} onChange={(v) => set('marketingHoursPerWeek', v)} suffix="h" /></Field>
              <Field label="Existing audience size"><NumberInput value={s.audienceSize} min={0} onChange={(v) => set('audienceSize', v)} /></Field>
            </div>
            <Field label="Delivery options you can offer">
              <div className="row" style={{ gap: 6 }}>
                {['pickup', 'courier', 'post'].map((d) => (
                  <button key={d} className={`chip ${s.deliveryOptions?.includes(d) ? 'active' : ''}`} aria-pressed={s.deliveryOptions?.includes(d)} onClick={() => set('deliveryOptions', s.deliveryOptions?.includes(d) ? s.deliveryOptions.filter((x) => x !== d) : [...(s.deliveryOptions || []), d])}>{d}</button>
                ))}
              </div>
            </Field>
            <label className="checkbox"><input type="checkbox" checked={s.includeExamples !== false} onChange={(e) => set('includeExamples', e.target.checked)} />Include example (simulated) data in dashboard totals and advisor</label>
          </div>
        </Card>
        <div className="stack">
          <Card title="AI engine" actions={<Cpu size={16} className="muted" />}>
            {health?.ai?.enabled ? (
              <>
                <Badge tone="ok">{health.ai.status?.state === 'ready' ? 'Connected' : 'Configured'}</Badge>
                <p className="small text-2" style={{ marginTop: 8 }}>Model: <span className="mono">{health.ai.model}</span>, running on Google Gemini. Web search: {health.ai.status?.search?.available ? health.ai.status.search.provider : 'off'}. Used for photo recognition, ideation, build plans, channel strategy, supplier web search, advisor explanations and the assistant.</p>
                {health.ai.status?.maintainerHint && <p className="xs warn-text" style={{ marginTop: 6 }}>{health.ai.status.maintainerHint}</p>}
              </>
            ) : (
              <>
                <Badge tone="warn">{health?.ai?.status?.configured ? 'Unavailable' : 'Off'}</Badge>
                <p className="small text-2" style={{ marginTop: 8 }}>Product ideas, photo recognition, build plans, web research and the assistant are off until the AI model is available.</p>
                {health?.ai?.status?.maintainerHint && (
                  <p className="xs muted" style={{ marginTop: 6 }}><strong>For whoever runs this server:</strong> {health.ai.status.maintainerHint}</p>
                )}
              </>
            )}
          </Card>
          <Card title="Privacy" actions={<ShieldCheck size={16} className="muted" />}>
            <ul className="list small">
              {health?.storage?.temporary
                ? <li className="warn-text">This deployment keeps data in temporary storage: projects and inventory can disappear when the server restarts. See README → Deploying to Vercel.</li>
                : <li>Data is stored in a local SQLite database on the server machine.</li>}
              {health?.ai?.status?.provider === 'gemini' && <li>AI requests (including photos you choose to analyse) are sent to Google Gemini.</li>}
              <li>Photos are resized in your browser, sent to the vision model (Google Gemini) only when you press “Identify”, and are not stored.</li>
              <li>API keys and store tokens stay on the server.</li>
            </ul>
          </Card>
          <Card title="Example data" actions={<FlaskConical size={16} className="muted" />}>
            <p className="small text-2" style={{ marginBottom: 10 }}>Example projects use simulated sales to demonstrate analytics and the advisor. They are always labelled.</p>
            <div className="row">
              <Button size="sm" loading={busy === 'ex'} onClick={() => run('ex', async () => { const r = await api.post('/examples'); if (!r.loaded) toast(r.message); }, 'Examples loaded')}>Load examples</Button>
              <Button size="sm" variant="danger" icon={Trash2} loading={busy === 'rm'} onClick={() => run('rm', () => api.del('/examples'), 'Examples removed')}>Remove examples</Button>
            </div>
          </Card>
          <Banner tone="info">Single-user local installation: there is no login. Run it on your own machine or behind your own authentication if exposed to a network.</Banner>
        </div>
      </div>
    </Page>
  );
}
