import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Page, Empty, LoadingBlock, Button, ExampleBadge, StatusBadge } from '../components/ui.jsx';
import SellTab from './project/SellTab.jsx';

export default function Strategy() {
  const ctx = useApp();
  const list = useApi('/projects');
  const [params, setParams] = useSearchParams();
  // Any saved product can get selling suggestions — a build plan isn't required.
  const projects = (list.data || []).filter((p) => p.status !== 'archived');
  const selectedId = params.get('project') || projects[0]?.id;
  const detail = useApi(selectedId ? `/projects/${selectedId}` : null, [selectedId]);
  const action = useAction(ctx.toast);
  const nav = useNavigate();

  useEffect(() => {
    if (detail.data) ctx.setPageContext('strategy', { product: detail.data.name, channels: detail.data.strategy?.kind === 'sell_guide' ? detail.data.strategy.channels.map((c) => c.name) : [] });
  }, [detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body, msg) => {
    const r = await action.run('patch', () => api.patch(`/projects/${selectedId}`, body), msg);
    if (r) detail.setData(r);
    return r;
  };

  return (
    <Page eyebrow="Sell" title="Where to sell it" sub="Pick a product. You get a few good places to sell it, a listing and a cautious price.">
      {list.loading && !list.data && <LoadingBlock />}
      {list.data && !projects.length && (
        <Empty icon={Megaphone} title="No products yet" action={<Button variant="primary" onClick={() => nav('/app/create')}>Create a product</Button>}>
          Choose a product to make first — selling suggestions are made for that product.
        </Empty>
      )}
      {projects.length > 0 && (
        <div className="row" style={{ marginBottom: 18 }}>
          <span className="label">Product</span>
          <select className="select" style={{ maxWidth: 360 }} value={selectedId} onChange={(e) => setParams({ project: e.target.value })} aria-label="Select product">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isExample ? ' (example)' : ''}</option>)}
          </select>
          {detail.data && <StatusBadge status={detail.data.status} />}
          {detail.data?.isExample && <ExampleBadge />}
        </div>
      )}
      {detail.loading && !detail.data && <LoadingBlock rows={4} />}
      {detail.data && <SellTab key={detail.data.id} project={detail.data} setProject={detail.setData} action={action} ctx={ctx} patch={patch} />}
    </Page>
  );
}
