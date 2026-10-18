import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, Store, ShieldCheck, Lightbulb, Info, Plug } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { Card, Button, Banner, Field, NumberInput, Modal } from '../../components/ui.jsx';
import { money, relTime } from '../../utils/format.js';

const KIND = { online_marketplace: 'Online marketplace', local_marketplace: 'Local listings', social_media: 'Social media', in_person: 'In person', own_shop: 'Your own shop', wholesale: 'Shops & resellers' };

function copy(text, toast) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy failed — select the text manually', 'error'));
}

/**
 * "Sell it": where to sell this product, a listing draft and a cautious price — generated
 * from what the app already knows about the product, with no questionnaire.
 */
export default function SellTab({ project: p, setProject, action, ctx }) {
  const { toast, aiEnabled } = ctx;
  const guide = p.strategy?.kind === 'sell_guide' ? p.strategy : null;
  const integrations = useApi('/integrations');
  const shopify = integrations.data?.find((i) => i.id === 'shopify');
  const [publish, setPublish] = useState(null);
  const started = useRef(false);

  const generate = () => action.run('sell', async () => setProject(await api.post(`/projects/${p.id}/sell`)));
  // Opening the tab is the request: load the suggestions once, without asking anything.
  useEffect(() => {
    if (!guide && aiEnabled && !p.isExample && !started.current) {
      started.current = true;
      generate();
    }
  }, [guide, aiEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = guide?.currency || ctx.currency;
  if (!guide) {
    return (
      <Card>
        {action.busy === 'sell' ? (
          <div className="row small text-2" role="status"><span className="spinner" style={{ width: 14, height: 14 }} />Working out where this product could sell…</div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <p className="text-2">See two or three places that suit this product, a ready-to-use listing and a cautious price.</p>
            {!aiEnabled && <Banner tone="warn">Selling suggestions need the local AI model, which isn’t available right now.</Banner>}
            <div><Button variant="primary" icon={Store} onClick={generate} disabled={!aiEnabled}>Show where to sell it</Button></div>
          </div>
        )}
      </Card>
    );
  }

  const listing = `${guide.listingTitle}\n\n${guide.listingDescription}`;
  return (
    <div className="stack-lg sell">
      <div className="row xs muted" style={{ gap: 6 }}>
        <Info size={13} />General guidance — prices and fees are not checked against live listings. Generated {relTime(guide.generatedAt)}.
        <div className="spacer" />
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={action.busy === 'sell'} onClick={generate}>Refresh</Button>
      </div>

      <section className="sell-channels">
        {guide.channels.map((c) => (
          <div key={c.name} className="card sell-channel">
            <div className="xs muted">{KIND[c.kind] || 'Channel'}</div>
            <h3>{c.name}</h3>
            <p className="small text-2">{c.why}</p>
            {c.compareUrl && <a className="xs" href={c.compareUrl} target="_blank" rel="noopener noreferrer">See similar listings <ExternalLink size={10} /></a>}
          </div>
        ))}
      </section>

      <div className="grid g-main" style={{ alignItems: 'start' }}>
        <Card title="Listing" actions={<Button size="sm" icon={Copy} onClick={() => copy(listing, toast)}>Copy</Button>}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="strong">{guide.listingTitle}</div>
            <p className="small text-2" style={{ whiteSpace: 'pre-line' }}>{guide.listingDescription}</p>
          </div>
        </Card>
        <Card title="Price">
          <div className="stack" style={{ gap: 6 }}>
            <div className="sell-price">{money(guide.price.low, cur)} – {money(guide.price.high, cur)}</div>
            <div className="xs muted">Estimate. {guide.price.reason}</div>
            {guide.marginBeforeFees ? (
              <div className="small">
                One unit uses about <strong>{money(guide.costPerUnit, cur)}</strong> of materials
                {guide.cashPerUnit != null && guide.cashPerUnit < guide.costPerUnit ? <> ({guide.cashPerUnit > 0 ? `${money(guide.cashPerUnit, cur)} to buy, the rest` : 'nothing to buy —'} you already own{guide.cashPerUnit > 0 ? '' : ' them'})</> : null}, leaving <strong>{money(guide.marginBeforeFees.low, cur)}–{money(guide.marginBeforeFees.high, cur)}</strong> before fees and shipping.
              </div>
            ) : (
              <div className="xs muted">Add prices to your materials (Bill of materials) to see your margin.</div>
            )}
          </div>
        </Card>
      </div>

      <Banner tone="info" icon={Lightbulb}><strong>Next step: </strong>{guide.nextAction}</Banner>

      <div className="row small">
        {shopify?.status === 'connected' ? (
          <Button icon={Store} onClick={() => setPublish({ title: guide.listingTitle, description: guide.listingDescription, price: guide.price.high || null, tags: [] })}>Create a Shopify draft</Button>
        ) : (
          <span className="muted row" style={{ gap: 6 }}><Plug size={14} />Want to publish straight to a shop? <Link to="/app/integrations">Connect one</Link> — not needed to sell.</span>
        )}
      </div>

      <Modal
        open={Boolean(publish)}
        onClose={() => setPublish(null)}
        title="Create a Shopify draft product"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublish(null)}>Cancel</Button>
            <Button variant="primary" icon={ShieldCheck} disabled={!publish?.price} loading={action.busy === 'pub'} onClick={() => action.run('pub', async () => { const r = await api.post('/integrations/shopify/publish', { projectId: p.id, confirm: true, ...publish }); setPublish(null); toast(`Draft created in Shopify (${r.handle})`); })}>
              Confirm — create draft
            </Button>
          </>
        }
      >
        {publish && (
          <div className="stack">
            <Banner tone="info">This creates a <strong>draft</strong> in {shopify?.account}. Customers can’t see it until you publish it in Shopify.</Banner>
            <Field label="Title"><input className="input" value={publish.title} maxLength={255} onChange={(e) => setPublish({ ...publish, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={publish.description} onChange={(e) => setPublish({ ...publish, description: e.target.value })} /></Field>
            <Field label={`Price (${cur})`}><NumberInput value={publish.price} min={0} onChange={(v) => setPublish({ ...publish, price: v })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
