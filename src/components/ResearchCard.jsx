import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { Card, Badge, Banner, Button } from './ui.jsx';
import { relTime } from '../utils/format.js';

const TYPE = { build_guide: ['Build guide', 'ok'], video: ['Video', 'info'], specification: ['Specification', 'info'], product_listing: ['Product listing', ''], inspiration: ['Inspiration', ''], forum: ['Forum', ''], other: ['Other', ''] };

/** Web research behind a product plan — verified sources only, clearly separated from the AI's own proposal. */
export function ResearchCard({ research, onRefresh, busy }) {
  if (!research) return null;
  return (
    <Card
      title="Research"
      sub={research.retrievedAt ? `Searched the web ${relTime(research.retrievedAt)}${research.searches != null ? ` · ${research.searches} search${research.searches === 1 ? '' : 'es'}` : ''}` : undefined}
      actions={onRefresh && <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={onRefresh}>Search again</Button>}
    >
      <div className="stack">
        {research.limited && <Banner tone="warn">{research.limitationNote || 'Little relevant research was found. The plan is the AI’s own proposal.'}</Banner>}
        {research.summary && <p className="small text-2">{research.summary}</p>}
        {research.typicalDimensions?.length > 0 && <p className="small"><span className="label">Typical sizes found: </span>{research.typicalDimensions.join(' · ')}</p>}
        {research.sources?.length > 0 && (
          <ul className="list-plain stack" style={{ gap: 10 }}>
            {research.sources.map((s, i) => {
              const [label, tone] = TYPE[s.type] || TYPE.other;
              return (
                <li key={s.url} className="card tight" style={{ background: 'var(--bg)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="mono xs muted">[{i + 1}]</span>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="strong">{s.title} <ExternalLink size={11} /></a>
                    <Badge tone={tone}>{label}</Badge>
                    <span className="xs muted">{s.publisher}</span>
                  </div>
                  {s.findings?.length > 0 && <ul className="list small" style={{ marginTop: 6 }}>{s.findings.map((f) => <li key={f}>{f}</li>)}</ul>}
                  {s.differencesFromUser && <p className="xs muted" style={{ marginTop: 4 }}>Compared with your materials: {s.differencesFromUser}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {!research.sources?.length && !research.limited && <p className="small muted"><BookOpen size={13} style={{ verticalAlign: -2 }} /> No sources yet.</p>}
      </div>
    </Card>
  );
}
