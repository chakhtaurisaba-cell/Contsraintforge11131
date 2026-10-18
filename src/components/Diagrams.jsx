// Technical visuals. The assembly view is an isometric projection of the component
// cuboids in the plan (millimetres) — a dimensional approximation, not a CAD model.
import { useMemo } from 'react';

const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
const project = (x, y, z) => [(x - y) * C30, (x + y) * S30 - z];

const PALETTE = ['var(--part-1)', 'var(--part-2)', 'var(--part-3)', 'var(--part-4)'];
const EPS = 0.01;

/** a must be painted before b if a lies entirely on the far side of b along some axis (viewer at +x,+y,+z). */
const behind = (a, b) => a.x + a.sx <= b.x + EPS || a.y + a.sy <= b.y + EPS || a.z + a.sz <= b.z + EPS;

/** Topological painter's order for non-overlapping axis-aligned boxes; falls back to depth sum on cycles. */
function paintOrder(boxes) {
  const depth = (b) => b.x + b.sx / 2 + b.y + b.sy / 2 + b.z + b.sz / 2;
  const n = boxes.length;
  const indeg = new Array(n).fill(0);
  const edges = boxes.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && behind(boxes[i], boxes[j]) && !behind(boxes[j], boxes[i])) {
        edges[i].push(j);
        indeg[j]++;
      }
    }
  }
  const out = [];
  const done = new Array(n).fill(false);
  while (out.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || depth(boxes[i]) < depth(boxes[pick]))) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || depth(boxes[i]) < depth(boxes[pick]))) pick = i; // cycle fallback
    done[pick] = true;
    out.push(boxes[pick]);
    for (const j of edges[pick]) indeg[j]--;
  }
  return out;
}

/**
 * @param visible  optional array of component ids to draw (sequential assembly: parts placed so far)
 * @param explode  0..1 — pushes parts away from the product centre to show how they relate
 */
export function AssemblyView({ components = [], highlight = [], height = 300, showLabels = true, visible = null, explode = 0 }) {
  const boxes = useMemo(() => {
    const list = [];
    components.forEach((c, ci) => (c.instances || []).forEach((b, bi) => list.push({ ...b, id: c.id, name: c.name, ci, key: `${c.id}-${bi}` })));
    if (explode > 0 && list.length > 1) {
      // Offset every part outward from the assembly centre, proportional to its distance.
      const cx = list.reduce((s, b) => s + b.x + b.sx / 2, 0) / list.length;
      const cy = list.reduce((s, b) => s + b.y + b.sy / 2, 0) / list.length;
      const cz = list.reduce((s, b) => s + b.z + b.sz / 2, 0) / list.length;
      for (const b of list) {
        b.x += (b.x + b.sx / 2 - cx) * explode;
        b.y += (b.y + b.sy / 2 - cy) * explode;
        b.z += (b.z + b.sz / 2 - cz) * explode * 1.4;
      }
    }
    const shown = visible ? list.filter((b) => visible.includes(b.id)) : list;
    const drawn = paintOrder(shown.length ? shown : list);
    drawn.frame = list; // framing uses every part so the view doesn't jump between steps
    return drawn;
  }, [components, visible, explode]);

  if (!boxes.length) return null;
  const pts = boxes.frame.flatMap((b) => [project(b.x, b.y, b.z), project(b.x + b.sx, b.y + b.sy, b.z + b.sz), project(b.x + b.sx, b.y, b.z), project(b.x, b.y + b.sy, b.z), project(b.x, b.y, b.z + b.sz)]);
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  const stroke = Math.max(maxX - minX, maxY - minY) / 400;
  const hl = new Set(highlight);
  const anyHl = hl.size > 0;

  const face = (pts3) => pts3.map((p) => project(...p).join(',')).join(' ');
  return (
    <svg viewBox={vb} style={{ width: '100%', height, display: 'block' }} role="img" aria-label="Isometric assembly view of the product components">
      {boxes.map((b) => {
        const on = hl.has(b.id);
        const base = PALETTE[b.ci % PALETTE.length];
        const fill = anyHl ? (on ? 'var(--accent-bright)' : base) : base;
        const op = anyHl && !on ? 0.18 : 0.9;
        const { x, y, z, sx, sy, sz } = b;
        return (
          <g key={b.key} opacity={op} stroke="var(--diagram-bg)" strokeWidth={stroke} strokeLinejoin="round">
            <title>{b.name}</title>
            {/* top */}
            <polygon points={face([[x, y, z + sz], [x + sx, y, z + sz], [x + sx, y + sy, z + sz], [x, y + sy, z + sz]])} fill={fill} />
            {/* front-right (x max) */}
            <polygon points={face([[x + sx, y, z], [x + sx, y + sy, z], [x + sx, y + sy, z + sz], [x + sx, y, z + sz]])} fill={fill} style={{ filter: 'brightness(0.72)' }} />
            {/* front-left (y max) */}
            <polygon points={face([[x, y + sy, z], [x + sx, y + sy, z], [x + sx, y + sy, z + sz], [x, y + sy, z + sz]])} fill={fill} style={{ filter: 'brightness(0.55)' }} />
          </g>
        );
      })}
      {showLabels && anyHl && (
        <text x={minX} y={maxY + pad * 0.7} fill="var(--accent)" fontSize={stroke * 13} fontFamily="JetBrains Mono, monospace">
          highlighted: {[...hl].join(', ')}
        </text>
      )}
    </svg>
  );
}

/** Board-by-board cut layout produced by the server's packing algorithm. */
export function CutListDiagram({ cutList, stockLength }) {
  if (!cutList?.layout?.length) return null;
  const maxEnd = Math.max(stockLength || 0, ...cutList.layout.flatMap((b) => b.cuts.map((c) => c.offset + c.length)));
  const W = 1000;
  const scale = W / (maxEnd + 20);
  const boardH = 46;
  const gap = 34;
  const H = cutList.layout.length * (boardH + gap) + 10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Cut list layout on stock boards">
      {cutList.layout.map((b, bi) => {
        const y = bi * (boardH + gap) + 18;
        return (
          <g key={b.board}>
            <text x={0} y={y - 6} fill="var(--muted)" fontSize="12" fontFamily="JetBrains Mono, monospace">Board {b.board}</text>
            <rect x={0} y={y} width={(stockLength || maxEnd) * scale} height={boardH} fill="var(--accent-soft)" stroke="var(--border-strong)" strokeDasharray="4 3" rx="3" />
            {b.cuts.map((c, ci) => (
              <g key={ci}>
                <rect x={c.offset * scale} y={y + 2} width={Math.max(2, c.length * scale)} height={boardH - 4} fill={ci % 2 ? 'var(--part-3)' : 'var(--part-1)'} stroke="var(--diagram-bg)" rx="2">
                  <title>{`${c.name}: ${c.length} × ${c.width} mm at ${c.offset} mm`}</title>
                </rect>
                {c.length * scale > 54 && (
                  <>
                    <text x={c.offset * scale + 6} y={y + 19} fill="var(--accent-ink)" fontSize="12" fontWeight="600">{c.name.length > c.length * scale / 7 ? `${c.name.slice(0, Math.floor(c.length * scale / 7))}…` : c.name}</text>
                    <text x={c.offset * scale + 6} y={y + 35} fill="var(--accent-ink)" fontSize="11" fontFamily="JetBrains Mono, monospace">{c.length}×{c.width}</text>
                  </>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Concept illustration by product shape — explicitly not a dimensional drawing. */
export function ProductVisual({ shape = 'generic', size = 110 }) {
  const s = { stroke: 'var(--line)', strokeWidth: 2, fill: 'color-mix(in srgb, var(--line) 12%, transparent)', strokeLinejoin: 'round' };
  const a = { stroke: 'var(--text)', strokeWidth: 2, fill: 'color-mix(in srgb, var(--text) 10%, transparent)', strokeLinejoin: 'round' };
  const shapes = {
    shelf: (
      <>
        <line x1="20" y1="18" x2="20" y2="92" stroke="var(--border-strong)" strokeWidth="2" />
        <polygon points="22,46 92,46 104,54 34,54" {...s} />
        <polygon points="34,54 104,54 104,60 34,60" {...s} />
        <path d="M34 60 L34 76 M90 60 L90 76" {...a} fill="none" />
        <rect x="44" y="30" width="12" height="16" {...a} />
        <circle cx="76" cy="38" r="8" {...a} />
      </>
    ),
    organizer: (
      <>
        <polygon points="20,50 72,38 104,52 52,66" {...s} />
        <polygon points="20,50 52,66 52,92 20,76" {...s} />
        <polygon points="52,66 104,52 104,78 52,92" {...s} />
        <line x1="40" y1="44" x2="72" y2="58" {...a} />
        <line x1="34" y1="30" x2="40" y2="50" {...a} />
        <line x1="44" y1="26" x2="48" y2="48" {...a} />
      </>
    ),
    box: null,
    planter: (
      <>
        <polygon points="14,56 70,42 110,56 54,70" {...s} />
        <polygon points="14,56 54,70 54,94 14,80" {...s} />
        <polygon points="54,70 110,56 110,80 54,94" {...s} />
        <path d="M40 54 C38 34 30 28 26 22 M54 50 C56 30 62 24 70 20 M74 48 C76 36 86 32 92 30" stroke="var(--ok)" strokeWidth="2.5" fill="none" />
      </>
    ),
    stand: (
      <>
        <polygon points="20,78 80,66 104,76 44,88" {...s} />
        <polygon points="60,70 72,24 80,26 70,72" {...s} />
        <rect x="46" y="30" width="22" height="38" rx="3" transform="rotate(14 57 49)" {...a} />
      </>
    ),
    panel: (
      <>
        <rect x="14" y="36" width="92" height="28" rx="3" {...s} />
        {[28, 44, 60, 76, 92].map((x) => (
          <path key={x} d={`M${x} 52 v10 a4 4 0 0 0 8 0`} {...a} fill="none" />
        ))}
      </>
    ),
    jar: (
      <>
        <rect x="36" y="38" width="48" height="56" rx="8" {...s} />
        <rect x="40" y="58" width="40" height="32" rx="5" {...a} />
        <line x1="60" y1="58" x2="60" y2="46" stroke="var(--text)" strokeWidth="2" />
        <path d="M60 30 c6 6 4 12 0 14 c-4 -2 -6 -8 0 -14z" fill="var(--accent-bright)" />
      </>
    ),
    bag: (
      <>
        <path d="M30 48 h60 l6 46 h-72z" {...s} />
        <path d="M44 48 c0 -24 32 -24 32 0" {...a} fill="none" />
      </>
    ),
    coaster: (
      <>
        <ellipse cx="60" cy="64" rx="40" ry="20" {...s} />
        <ellipse cx="60" cy="64" rx="28" ry="14" fill="none" stroke="var(--line)" strokeWidth="1.5" />
        <ellipse cx="60" cy="64" rx="16" ry="8" fill="none" stroke="var(--line)" strokeWidth="1.5" />
        <ellipse cx="60" cy="64" rx="5" ry="2.5" {...a} />
      </>
    ),
    generic: (
      <>
        <polygon points="24,50 64,36 100,50 60,64" {...s} />
        <polygon points="24,50 60,64 60,92 24,78" {...s} />
        <polygon points="60,64 100,50 100,78 60,92" {...s} />
        <circle cx="62" cy="30" r="6" {...a} />
      </>
    ),
  };
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 120 108" role="img" aria-label={`Concept illustration: ${shape}`}>
      {shapes[shape] || (shape === 'box' ? shapes.organizer : shapes.generic)}
    </svg>
  );
}
