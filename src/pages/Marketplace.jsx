import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Globe, PackageCheck, Wallet } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { Page, Card, Banner, Empty, ErrorState, LoadingBlock, Stat, Button } from '../components/ui.jsx';
import { PurchaseItem } from '../components/PurchaseItem.jsx';
import { REGIONS } from '../../shared/constants.js';
import { money } from '../utils/format.js';

export default function Marketplace() {
  const { data, error, loading, reload } = useApi('/purchases');
  const { settings, aiEnabled, currency, saveSettings, setPageContext, toast } = useApp();
  const nav = useNavigate();
  const [filter, setFilter] = useState('open');
  const [budget, setBudget] = useState('');
  const list = useMemo(() => (data || []).filter((p) => (filter === 'all' ? true : filter === 'open' ? !p.purchased : p.purchased)), [data, filter]);
  const openCost = (data || []).filter((p) => !p.purchased).reduce((s, p) => s + (p.estUnitPrice || 0) * p.quantity, 0);
  const spent = (data || []).filter((p) => p.purchased).reduce((s, p) => s + (p.actualCost ?? (p.estUnitPrice || 0) * p.quantity), 0);

  useEffect(() => { setPageContext('marketplace', { open: list.map((p) => ({ name: p.name, qty: p.quantity, options: p.options.length })) }); }, [list, setPageContext]);

  return (
    <Page eyebrow="Source" title="What to buy" sub="Compared by total landed cost, not sticker price.">
      <div className="grid g-4" style={{ marginBottom: 20 }}>
        <div className="card"><Stat icon={ShoppingCart} label="Items to buy" value={(data || []).filter((p) => !p.purchased).length} /></div>
        <div className="card"><Stat icon={Wallet} label="Estimated open cost" value={money(openCost, currency)} foot="From BOM estimates" /></div>
        <div className="card"><Stat icon={PackageCheck} label="Purchased" value={money(spent, currency)} /></div>
        <div className="card">
          <div className="stack" style={{ gap: 6 }}>
            <span className="stat-label"><Globe size={14} />Region & currency</span>
            <select className="select" value={settings?.region || 'GE'} onChange={(e) => { const r = REGIONS.find((x) => x.id === e.target.value); saveSettings({ region: r.id, currency: r.currency }).then(() => toast(`Region set to ${r.label} (${r.currency})`)); }} aria-label="Region">
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.currency}</option>)}
            </select>
          </div>
        </div>
      </div>
      {!aiEnabled && <div style={{ marginBottom: 16 }}><Banner tone="warn">Live supplier search isn’t available right now. Use the search links and add the prices you find; the comparison then ranks them for you.</Banner></div>}
      {aiEnabled && <div style={{ marginBottom: 16 }}><Banner tone="info">Live search uses AI web search. Each listing URL is verified against the actual search results; prices are as seen at retrieval time and must be confirmed on the seller's site.</Banner></div>}

      <div className="row" style={{ marginBottom: 14 }}>
        {[['open', 'To buy'], ['done', 'Purchased'], ['all', 'All']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>
        ))}
        <div className="spacer" />
        <div className="input-group" style={{ width: 220 }}>
          <input className="input" type="number" min="0" placeholder="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Purchase budget" />
          <span className="addon">{currency}</span>
        </div>
      </div>
      {budget !== '' && Number(budget) < openCost && <div style={{ marginBottom: 14 }}><Banner tone="warn">Open purchases (~{money(openCost, currency)}) exceed your budget of {money(Number(budget), currency)} by {money(openCost - Number(budget), currency)}. Consider a smaller batch in the project's Economics tab.</Banner></div>}

      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock rows={4} />}
      {data && !data.length && <Empty icon={ShoppingCart} title="No purchases needed yet" action={<Button onClick={() => nav('/app/projects')}>Open a project</Button>}>When a project's bill of materials includes items you don't own, they appear here.</Empty>}
      <div className="stack">
        {list.map((p) => <PurchaseItem key={p.id} item={p} region={settings?.region} showProject onChange={reload} />)}
      </div>
      {data?.length > 0 && !list.length && <p className="muted">Nothing in this view.</p>}
      <Card style={{ marginTop: 20 }} title="How “best option” is chosen">
        <ul className="list small">
          <li>Total = packs needed × pack price + shipping (packs needed = ⌈required ÷ pack size⌉).</li>
          <li>Ranked mainly by total cost; incompatible options and long delivery times are penalised; large leftover quantities are flagged.</li>
          <li>Options without a price or in another currency are listed but not ranked.</li>
        </ul>
      </Card>
    </Page>
  );
}
