// Product concept illustrations, drawn deterministically in SVG.
//
// The picture is chosen from the product itself — its name first (a "glass jar candle holder"
// is a candle in a jar, whatever category the model picked), then the model's visualKind —
// and coloured by the material it is made from. Every kind shares one stage, light direction
// (top-left) and ground shadow so a grid of ideas reads as one set. These are concept
// illustrations, not dimensioned drawings; the Design tab has the measured assembly view.
import { useId, useState } from 'react';
import { photoFor } from './productPhotos.js';

import { resolveKind, resolveMaterial } from '../../shared/productKind.js';

export { resolveKind, resolveMaterial };

/* ----------------------------- materials ----------------------------- */

// Fixed, realistic finishes (they read on both the light and the dark stage).
const MAT = {
  wood: { top: '#e2b77c', front: '#c99559', side: '#a8743f', line: '#7a4f26', grain: true },
  cardboard: { top: '#d7b47e', front: '#c29a62', side: '#a57e4b', line: '#7d5c33' },
  paper: { top: '#f3ecdc', front: '#e6dcc6', side: '#cfc3a9', line: '#9b8f76' },
  fabric: { top: '#a9c3bd', front: '#8fb0a9', side: '#6f938c', line: '#4a6a64', stitch: true },
  leather: { top: '#a8714d', front: '#8d5a3a', side: '#6f442a', line: '#4a2c1a', stitch: true },
  concrete: { top: '#c9c6bf', front: '#b2aea7', side: '#96928b', line: '#6e6a64' },
  ceramic: { top: '#efe7da', front: '#ddd2c1', side: '#c4b7a3', line: '#9a8c77' },
  metal: { top: '#d3d8de', front: '#b4bbc3', side: '#949ca6', line: '#626a74' },
  plastic: { top: '#a9cbe8', front: '#8db7dd', side: '#6f9cc6', line: '#4a7299' },
  glass: { top: '#dcecf1', front: '#cfe4ea', side: '#b9d3db', line: '#7fa6b3' },
};

/* ----------------------------- drawing helpers ----------------------------- */

const DX = 0.62; // oblique depth projection
const DY = 0.42;

/** Solid box in cabinet projection: front face at (x, y) w×h, depth d recedes up-right. */
function Box({ x, y, w, h, d, m, grain = m.grain, faces = 'all', stroke = true }) {
  const dx = d * DX;
  const dy = d * DY;
  const s = stroke ? { stroke: m.line, strokeWidth: 0.8, strokeLinejoin: 'round', strokeOpacity: 0.55 } : {};
  return (
    <g {...s}>
      {faces !== 'front' && <polygon points={`${x},${y} ${x + w},${y} ${x + w + dx},${y - dy} ${x + dx},${y - dy}`} fill={m.top} />}
      {faces !== 'front' && <polygon points={`${x + w},${y} ${x + w + dx},${y - dy} ${x + w + dx},${y + h - dy} ${x + w},${y + h}`} fill={m.side} />}
      <rect x={x} y={y} width={w} height={h} fill={m.front} />
      {grain && w > 18 && h > 6 && (
        <g stroke={m.line} strokeOpacity="0.22" strokeWidth="0.7" fill="none">
          {Array.from({ length: Math.max(1, Math.floor(h / 7)) }, (_, i) => {
            const yy = y + ((i + 0.6) * h) / Math.max(1, Math.floor(h / 7) + 0.2);
            return <path key={i} d={`M${x + 3} ${yy} C ${x + w * 0.3} ${yy - 1.6}, ${x + w * 0.6} ${yy + 1.6}, ${x + w - 3} ${yy - 0.4}`} />;
          })}
        </g>
      )}
    </g>
  );
}

/** Upright cylinder: base centre (cx, by), radius rx, height h. */
function Cylinder({ cx, by, rx, h, m, top = true }) {
  const ry = rx * 0.32;
  return (
    <g stroke={m.line} strokeWidth="0.8" strokeOpacity="0.55">
      <path d={`M${cx - rx} ${by - h} V${by} A${rx} ${ry} 0 0 0 ${cx + rx} ${by} V${by - h}`} fill={m.front} />
      {top && <ellipse cx={cx} cy={by - h} rx={rx} ry={ry} fill={m.top} />}
    </g>
  );
}

function Plant({ x, y, s = 1 }) {
  const leaf = (dx, dy, r, c) => <path d={`M${x} ${y} Q ${x + dx * 0.4 - 4 * s} ${y + dy * 0.6} ${x + dx} ${y + dy} Q ${x + dx * 0.6 + 4 * s} ${y + dy * 0.4} ${x} ${y}`} fill={c} transform={`rotate(${r} ${x} ${y})`} />;
  return (
    <g>
      {leaf(-22 * s, -26 * s, 0, '#5f9e5a')}
      {leaf(20 * s, -30 * s, 0, '#4f8d4c')}
      {leaf(-6 * s, -38 * s, 0, '#6fb067')}
      {leaf(10 * s, -20 * s, 20, '#5a9a55')}
      {leaf(-14 * s, -14 * s, -20, '#78b86f')}
    </g>
  );
}

/* ----------------------------- the products ----------------------------- */

function drawKind(kind, m, id, size, name = '') {
  const ratio = size?.length && size?.height ? Math.max(0.35, Math.min(2.6, size.length / size.height)) : null;
  switch (kind) {
    case 'candle_jar': {
      const g = MAT.glass;
      return (
        <g>
          <ellipse cx="120" cy="104" rx="46" ry="40" fill={`url(#${id}-glow)`} />
          {/* wax inside the glass */}
          <path d="M92 118 V146 A28 9 0 0 0 148 146 V118" fill="#f4ead6" />
          <ellipse cx="120" cy="118" rx="28" ry="9" fill="#fbf4e6" stroke="#e6d6b8" strokeWidth="0.8" />
          <path d="M120 118 v-12" stroke="#3b2f25" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M120 82 C 127 92, 127 101, 120 106 C 113 101, 113 92, 120 82 Z" fill={`url(#${id}-flame)`} />
          <path d="M120 92 C 123 97, 123 101, 120 104 C 117 101, 117 97, 120 92 Z" fill="#fff6c9" />
          {/* glass body */}
          <path d="M88 98 V146 A32 10 0 0 0 152 146 V98" fill={g.front} fillOpacity="0.32" stroke={g.line} strokeWidth="1.3" />
          <ellipse cx="120" cy="98" rx="32" ry="10" fill="none" stroke={g.line} strokeWidth="1.3" />
          <ellipse cx="120" cy="98" rx="29" ry="8" fill="none" stroke={g.line} strokeOpacity="0.45" strokeWidth="1" />
          <path d="M88 104 h64 M88 109 h64" stroke={g.line} strokeOpacity="0.35" strokeWidth="1" />
          <path d="M96 112 V140" stroke="#fff" strokeOpacity="0.75" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M103 116 V128" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      );
    }
    case 'jar': {
      const g = m === MAT.glass ? MAT.glass : m;
      return (
        <g>
          <path d="M86 92 V144 A34 10 0 0 0 154 144 V92" fill={g.front} fillOpacity={m === MAT.glass ? 0.35 : 1} stroke={g.line} strokeWidth="1.3" />
          <path d="M90 120 V142 A30 8.5 0 0 0 150 142 V120" fill="#d9b98b" fillOpacity="0.65" />
          <ellipse cx="120" cy="120" rx="30" ry="8.5" fill="#e6caa0" fillOpacity="0.8" />
          <path d="M84 80 V92 A36 10.5 0 0 0 156 92 V80" fill={MAT.metal.front} stroke={MAT.metal.line} strokeWidth="1" />
          <ellipse cx="120" cy="80" rx="36" ry="10.5" fill={MAT.metal.top} stroke={MAT.metal.line} strokeWidth="1" />
          <path d="M84 86 A36 10.5 0 0 0 156 86" fill="none" stroke={MAT.metal.line} strokeOpacity="0.5" />
          <path d="M95 102 V136" stroke="#fff" strokeOpacity="0.7" strokeWidth="3.4" strokeLinecap="round" />
        </g>
      );
    }
    case 'vase': {
      const glass = m === MAT.glass;
      return (
        <g>
          <path d="M118 74 C 112 58, 104 46, 96 40 M122 74 C 128 56, 138 46, 148 42 M120 74 C 121 58, 119 44, 121 32" stroke="#5f8f52" strokeWidth="2" fill="none" />
          <circle cx="96" cy="40" r="6" fill="#e8a0a8" /><circle cx="148" cy="42" r="6" fill="#f2c46b" /><circle cx="121" cy="31" r="6" fill="#e58a6c" />
          <path d="M108 72 C 108 84, 92 96, 92 120 C 92 140, 104 148, 120 148 C 136 148, 148 140, 148 120 C 148 96, 132 84, 132 72 Z" fill={m.front} fillOpacity={glass ? 0.35 : 1} stroke={m.line} strokeWidth="1.3" />
          <ellipse cx="120" cy="72" rx="12" ry="3.6" fill={m.top} fillOpacity={glass ? 0.5 : 1} stroke={m.line} strokeWidth="1" />
          {glass && <path d="M100 106 C 99 116, 100 128, 104 136" stroke="#fff" strokeOpacity="0.75" strokeWidth="3" fill="none" strokeLinecap="round" />}
        </g>
      );
    }
    case 'planter_box': {
      const w = ratio ? Math.min(150, Math.max(80, 50 * ratio)) : 128;
      const x = 112 - w / 2;
      return (
        <g>
          <Plant x={x + w * 0.3} y={104} s={0.9} />
          <Plant x={x + w * 0.62} y={102} s={1.1} />
          <Box x={x} y={104} w={w} h={42} d={34} m={m} />
          <polygon points={`${x + 4},${104} ${x + w - 4},${104} ${x + w - 4 + 34 * DX},${104 - 34 * DY} ${x + 4 + 34 * DX},${104 - 34 * DY}`} fill="#6b4a33" fillOpacity="0.85" />
          <path d={`M${x} ${118} h${w} M${x} ${132} h${w}`} stroke={m.line} strokeOpacity="0.5" />
        </g>
      );
    }
    case 'plant_pot':
      return (
        <g>
          <Plant x={120} y={92} s={1.2} />
          <path d="M92 92 L98 146 A22 6.5 0 0 0 142 146 L148 92 Z" fill={m.front} stroke={m.line} strokeWidth="1" strokeOpacity="0.6" />
          <path d="M126 96 L122 146" stroke="#fff" strokeOpacity="0.18" strokeWidth="8" />
          <ellipse cx="120" cy="92" rx="28" ry="8" fill="#6b4a33" stroke={m.line} strokeWidth="1" strokeOpacity="0.6" />
          <path d="M90 92 A30 9 0 0 0 150 92 v-6 A30 9 0 0 1 90 86 Z" fill={m.top} stroke={m.line} strokeWidth="1" strokeOpacity="0.6" />
        </g>
      );
    case 'wall_shelf': {
      const w = ratio ? Math.min(170, Math.max(110, 30 * ratio + 90)) : 150;
      const x = 112 - w / 2;
      return (
        <g>
          <rect x="24" y="22" width="192" height="104" rx="4" fill="currentColor" fillOpacity="0.035" />
          <rect x={x + 18} y={64} width={12} height={20} rx="1.5" fill="#6d8fb3" /><rect x={x + 31} y={60} width={10} height={24} rx="1.5" fill="#c97a5a" /><rect x={x + 42} y={66} width={9} height={18} rx="1.5" fill="#d9b34f" />
          <path d={`M${x + w - 46} 84 l4 -18 h18 l4 18 z`} fill={MAT.ceramic.front} stroke={MAT.ceramic.line} strokeOpacity="0.6" />
          <Plant x={x + w - 35} y={68} s={0.5} />
          <Box x={x} y={84} w={w} h={7} d={26} m={m} />
          {[x + 24, x + w - 30].map((bx) => (
            <path key={bx} d={`M${bx} 91 v24 l16 -24 z`} fill={MAT.metal.side} stroke={MAT.metal.line} strokeWidth="0.8" />
          ))}
        </g>
      );
    }
    case 'bookshelf': {
      const books = (x, y, n) => Array.from({ length: n }, (_, i) => <rect key={i} x={x + i * 9} y={y - 18 - (i % 3) * 2} width="8" height={18 + (i % 3) * 2} rx="1" fill={['#6d8fb3', '#c97a5a', '#d9b34f', '#7aa37a', '#9b7bb5'][i % 5]} />);
      return (
        <g>
          <Box x={78} y={36} w={8} h={112} d={30} m={m} />
          <Box x={154} y={36} w={8} h={112} d={30} m={m} />
          {[36, 72, 108, 140].map((y) => <Box key={y} x={86} y={y} w={68} h={6} d={30} m={m} />)}
          {books(90, 72, 6)}
          {books(96, 108, 5)}
          <path d="M122 140 l4 -14 h14 l4 14 z" fill={MAT.ceramic.front} stroke={MAT.ceramic.line} strokeOpacity="0.6" />
        </g>
      );
    }
    case 'box':
      return (
        <g>
          <Box x={80} y={104} w={92} h={42} d={42} m={m} />
          <Box x={76} y={92} w={100} h={12} d={46} m={m} />
          <rect x="120" y="104" width="12" height="9" rx="1.5" fill={MAT.metal.front} stroke={MAT.metal.line} strokeWidth="0.8" />
        </g>
      );
    case 'crate':
      return (
        <g>
          <Box x={72} y={92} w={104} h={56} d={46} m={m} grain={false} />
          {[0, 1, 2].map((i) => <rect key={i} x={72} y={92 + i * 19} width={104} height={14} fill={m.front} stroke={m.line} strokeOpacity="0.45" strokeWidth="0.8" />)}
          <rect x="110" y="98" width="28" height="7" rx="3.5" fill="#3b2a1e" fillOpacity="0.55" />
        </g>
      );
    case 'organizer':
      return (
        <g>
          <path d="M100 96 l-6 -42 M106 96 l4 -46 M128 96 l10 -38" stroke="#3d4b5c" strokeWidth="3" strokeLinecap="round" />
          <circle cx="94" cy="54" r="2.4" fill="#c94f4f" /><circle cx="110" cy="50" r="2.4" fill="#4f7fc9" />
          <rect x="140" y="70" width="18" height="26" rx="2" fill="#f2d16b" transform="rotate(8 149 83)" />
          <Box x={80} y={96} w={96} h={50} d={40} m={m} />
          <path d={`M112 96 v50 M144 96 v50`} stroke={m.line} strokeOpacity="0.55" strokeWidth="1" />
          <path d={`M112 96 l${40 * DX} ${-40 * DY} M144 96 l${40 * DX} ${-40 * DY}`} stroke={m.line} strokeOpacity="0.55" strokeWidth="1.4" />
        </g>
      );
    case 'tray':
      return (
        <g>
          <Box x={60} y={128} w={112} h={14} d={46} m={m} />
          <polygon points={`66,128 166,128 ${166 + 40 * DX},${128 - 40 * DY} ${66 + 40 * DX},${128 - 40 * DY}`} fill={m.front} fillOpacity="0.55" />
          <rect x="66" y="132" width="14" height="5" rx="2.5" fill="#3b2a1e" fillOpacity="0.5" /><rect x="152" y="132" width="14" height="5" rx="2.5" fill="#3b2a1e" fillOpacity="0.5" />
          <path d="M96 122 v-12 a12 4 0 0 0 24 0 v12 a12 4 0 0 1 -24 0 z" fill={MAT.ceramic.front} stroke={MAT.ceramic.line} strokeOpacity="0.7" />
          <ellipse cx="108" cy="110" rx="12" ry="4" fill="#6b3f22" stroke={MAT.ceramic.line} strokeOpacity="0.7" />
          <path d="M130 120 l4 -22 h14 l4 22 a11 3.5 0 0 1 -22 0 z" fill={MAT.glass.front} fillOpacity="0.55" stroke={MAT.glass.line} />
          <path d="M136 102 v14" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'coaster': {
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <ellipse cx="96" cy={134 - i * 7} rx="34" ry="11" fill={m.side} stroke={m.line} strokeOpacity="0.5" />
              <ellipse cx="96" cy={131 - i * 7} rx="34" ry="11" fill={m.top} stroke={m.line} strokeOpacity="0.5" />
            </g>
          ))}
          <ellipse cx="96" cy="117" rx="20" ry="6.5" fill="none" stroke={m.line} strokeOpacity="0.35" />
          <ellipse cx="156" cy="140" rx="30" ry="10" fill={m.side} stroke={m.line} strokeOpacity="0.5" />
          <ellipse cx="156" cy="137" rx="30" ry="10" fill={m.top} stroke={m.line} strokeOpacity="0.5" />
          <path d="M140 136 v-26 a16 5 0 0 0 32 0 v26 a16 5 0 0 1 -32 0 z" fill={MAT.ceramic.front} stroke={MAT.ceramic.line} strokeOpacity="0.7" />
          <ellipse cx="156" cy="110" rx="16" ry="5" fill="#6b3f22" stroke={MAT.ceramic.line} strokeOpacity="0.7" />
          <path d="M172 116 c10 0 10 14 0 14" stroke={MAT.ceramic.line} strokeOpacity="0.8" strokeWidth="3" fill="none" />
        </g>
      );
    }
    case 'frame':
      return (
        <g>
          <path d="M150 146 l12 -78" stroke={m.side} strokeWidth="5" strokeLinecap="round" />
          <g transform="rotate(-4 118 92)">
            <rect x="74" y="40" width="88" height="106" rx="2" fill={m.front} stroke={m.line} strokeOpacity="0.6" />
            <rect x="84" y="50" width="68" height="86" fill="#f6f2ea" />
            <rect x="92" y="58" width="52" height="70" fill="#cfe3ee" />
            <path d="M92 116 l14 -18 l10 12 l8 -8 l20 22 v4 h-52 z" fill="#7fae7a" />
            <circle cx="132" cy="74" r="6" fill="#f2c46b" />
          </g>
        </g>
      );
    case 'stand':
      // A phone/tablet stand only when the product says so; otherwise a display riser.
      if (!/phone|tablet|mobile|ipad|book/.test(name)) {
        return (
          <g>
            <Box x={72} y={122} w={108} h={22} d={46} m={m} />
            <Box x={88} y={98} w={76} h={24} d={34} m={m} />
            <path d="M114 98 V74 A12 4 0 0 1 138 74 V98 A12 4 0 0 1 114 98 Z" fill={MAT.glass.front} fillOpacity="0.5" stroke={MAT.glass.line} />
            <ellipse cx="126" cy="74" rx="12" ry="4" fill="none" stroke={MAT.glass.line} />
            <path d="M119 80 V94" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
          </g>
        );
      }
      return (
        <g>
          <g transform="rotate(-16 120 120)">
            <rect x="98" y="44" width="46" height="84" rx="7" fill="#2f3640" />
            <rect x="102" y="50" width="38" height="70" rx="3" fill="#8fb8de" />
          </g>
          <Box x={78} y={134} w={96} h={10} d={42} m={m} />
          <polygon points="148,134 164,134 140,62 128,64" fill={m.side} stroke={m.line} strokeOpacity="0.5" strokeWidth="0.8" />
          <Box x={88} y={126} w={60} h={8} d={6} m={m} />
        </g>
      );
    case 'pouch':
      return (
        <g>
          <path d="M66 84 Q 66 76 74 76 H166 Q 174 76 174 84 L170 138 Q 169 146 160 146 H80 Q 71 146 70 138 Z" fill={m.front} stroke={m.line} strokeOpacity="0.6" />
          <path d="M70 92 H170" stroke="#3d4650" strokeWidth="3" />
          <path d="M70 92 H170" stroke="#9aa3ad" strokeWidth="1.2" strokeDasharray="2 2" />
          <rect x="150" y="88" width="10" height="16" rx="2" fill={MAT.metal.front} stroke={MAT.metal.line} />
          <path d="M76 100 H164 M78 138 H162" stroke={m.line} strokeOpacity="0.55" strokeDasharray="3 3" />
          <path d="M84 104 Q 120 98 156 104 L154 132 Q 120 138 86 132 Z" fill="#fff" fillOpacity="0.07" />
        </g>
      );
    case 'tote_bag':
      return (
        <g>
          <path d="M98 76 C 98 40, 142 40, 142 76" stroke={m.side} strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M106 76 C 106 50, 134 50, 134 76" stroke={m.top} strokeWidth="3" fill="none" strokeOpacity="0.6" />
          <path d="M76 76 H164 L170 148 H70 Z" fill={m.front} stroke={m.line} strokeOpacity="0.6" />
          <path d="M77 84 H163 M72 140 H168" stroke={m.line} strokeOpacity="0.5" strokeDasharray="3 3" />
          <path d="M150 80 L156 146" stroke="#000" strokeOpacity="0.07" strokeWidth="10" />
        </g>
      );
    case 'key_rack':
      return (
        <g>
          <rect x="24" y="22" width="192" height="124" rx="4" fill="currentColor" fillOpacity="0.035" />
          <Box x={52} y={58} w={136} h={30} d={8} m={m} />
          {[72, 100, 128, 156].map((hx, i) => (
            <g key={hx}>
              <path d={`M${hx} 80 v14 a6 6 0 0 0 12 0`} stroke={MAT.metal.line} strokeWidth="2.6" fill="none" strokeLinecap="round" />
              {i % 2 === 0 && (
                <g>
                  <circle cx={hx + 12} cy={102} r="5" fill="none" stroke="#b08d3c" strokeWidth="2" />
                  <path d={`M${hx + 12} 107 v18 m0 -6 h5 m-5 4 h4`} stroke="#b08d3c" strokeWidth="2.4" strokeLinecap="round" />
                </g>
              )}
            </g>
          ))}
          <circle cx="60" cy="66" r="2" fill={MAT.metal.side} /><circle cx="180" cy="66" r="2" fill={MAT.metal.side} />
        </g>
      );
    case 'lamp':
      return (
        <g>
          <ellipse cx="120" cy="70" rx="56" ry="50" fill={`url(#${id}-glow)`} />
          <path d="M120 140 V74" stroke={m.side} strokeWidth="5" />
          <ellipse cx="120" cy="142" rx="30" ry="8" fill={m.side} />
          <ellipse cx="120" cy="139" rx="30" ry="8" fill={m.top} stroke={m.line} strokeOpacity="0.5" />
          <path d="M92 86 L102 44 H138 L148 86 Z" fill="#f6ead2" stroke="#d8c39e" strokeWidth="1" />
          <ellipse cx="120" cy="86" rx="28" ry="6" fill="#ffe9a8" fillOpacity="0.9" />
        </g>
      );
    case 'stool':
      return (
        <g>
          {/* back legs, seat, rail, front legs — painted back to front */}
          {[100, 160].map((lx) => <Box key={lx} x={lx} y={80} w={8} h={54} d={8} m={m} />)}
          <Box x={76} y={84} w={96} h={10} d={40} m={m} />
          <Box x={88} y={128} w={66} h={5} d={6} m={m} />
          {[84, 156].map((lx) => <Box key={lx} x={lx} y={94} w={8} h={54} d={8} m={m} />)}
        </g>
      );
    case 'birdhouse':
      return (
        <g>
          <path d="M120 146 v8" stroke={m.side} strokeWidth="5" />
          <Box x={92} y={84} w={56} h={62} d={40} m={m} />
          <polygon points="84,88 120,52 156,88" fill={m.front} stroke={m.line} strokeOpacity="0.55" />
          <polygon points={`120,52 ${120 + 40 * DX},${52 - 40 * DY} ${156 + 40 * DX},${88 - 40 * DY} 156,88`} fill={m.top} stroke={m.line} strokeOpacity="0.55" />
          <circle cx="120" cy="106" r="9" fill="#2f241b" />
          <path d="M120 126 h-12" stroke={m.side} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case 'sign':
      return (
        <g>
          <path d="M120 34 L84 74 M120 34 L156 74" stroke="#7d6a52" strokeWidth="1.6" />
          <circle cx="120" cy="34" r="3" fill={MAT.metal.side} />
          <Box x={64} y={74} w={112} h={56} d={8} m={m} />
          <rect x="80" y="90" width="64" height="7" rx="3.5" fill={m.line} fillOpacity="0.55" />
          <rect x="80" y="104" width="44" height="5" rx="2.5" fill={m.line} fillOpacity="0.35" />
        </g>
      );
    case 'plant_stand':
      // A low wooden stand with a potted plant on top.
      return (
        <g>
          {[104, 156].map((lx) => <Box key={lx} x={lx} y={98} w={7} h={46} d={7} m={m} />)}
          <Box x={84} y={98} w={86} h={9} d={36} m={m} />
          <Box x={92} y={132} w={70} h={5} d={6} m={m} />
          {[90, 148].map((lx) => <Box key={lx} x={lx} y={107} w={7} h={44} d={7} m={m} />)}
          <path d="M116 66 L120 92 A13 4 0 0 0 146 92 L150 66 Z" fill={MAT.ceramic.front} stroke={MAT.ceramic.line} strokeOpacity="0.6" />
          <ellipse cx="133" cy="66" rx="17" ry="5" fill="#6b4a33" stroke={MAT.ceramic.line} strokeOpacity="0.6" />
          <Plant x={133} y={66} s={0.85} />
        </g>
      );
    case 'bottle_planter': {
      // A plastic bottle cut open on its side: soil and a plant in the opening, cap at the end.
      const p = MAT.plastic;
      return (
        <g>
          <Plant x={108} y={112} s={0.8} />
          <Plant x={134} y={110} s={0.7} />
          <path d="M66 118 Q66 104 80 104 H162 Q176 104 180 112 L190 114 V128 L180 130 Q176 140 162 140 H80 Q66 140 66 126 Z" fill={p.front} fillOpacity="0.45" stroke={p.line} strokeWidth="1.2" />
          <path d="M72 122 Q72 136 84 136 H160 Q172 136 175 128 L176 118 Z" fill="#6b4a33" fillOpacity="0.85" />
          <path d="M86 112 Q120 106 160 112" stroke={p.line} strokeWidth="1.2" fill="none" />
          <rect x="190" y="113" width="8" height="16" rx="2" fill="#4f8fd1" />
          <path d="M84 132 H150" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    }
    case 'bottle_organizer': {
      // Bottle bottoms cut into cups and joined in a row, holding pens and tools.
      const p = MAT.plastic;
      const cup = (x, h) => (
        <g key={x}>
          <path d={`M${x} ${148 - h} V144 Q${x} 150 ${x + 6} 150 H${x + 30} Q${x + 36} 150 ${x + 36} 144 V${148 - h}`} fill={p.front} fillOpacity="0.45" stroke={p.line} strokeWidth="1.2" />
          <ellipse cx={x + 18} cy={148 - h} rx="18" ry="5" fill={p.top} fillOpacity="0.5" stroke={p.line} strokeWidth="1.2" />
          <path d={`M${x + 6} ${152 - h} V144`} stroke="#fff" strokeOpacity="0.6" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      );
      return (
        <g>
          <path d="M84 100 l-6 -44 M92 100 l4 -46 M128 96 l8 -40 M134 96 l-4 -36 M168 104 l6 -30" stroke="#3d4b5c" strokeWidth="3" strokeLinecap="round" />
          <circle cx="78" cy="56" r="2.4" fill="#c94f4f" /><circle cx="96" cy="54" r="2.4" fill="#4f7fc9" /><circle cx="136" cy="56" r="2.4" fill="#4fae6b" />
          {cup(68, 52)}
          {cup(108, 60)}
          {cup(148, 44)}
        </g>
      );
    }
    case 'bird_feeder': {
      if (m === MAT.wood || m === MAT.metal) {
        // Wooden platform feeder: a tray of seed under a small pitched roof on two posts.
        return (
          <g>
            <path d="M120 26 V40" stroke="#7d6a52" strokeWidth="1.6" />
            <Box x={92} y={58} w={5} h={62} d={4} m={m} />
            <Box x={150} y={58} w={5} h={62} d={4} m={m} />
            <polygon points="76,62 124,38 172,62" fill={m.front} stroke={m.line} strokeOpacity="0.55" />
            <polygon points={`124,38 ${124 + 30 * DX},${38 - 30 * DY} ${172 + 30 * DX},${62 - 30 * DY} 172,62`} fill={m.top} stroke={m.line} strokeOpacity="0.55" />
            <Box x={80} y={118} w={88} h={10} d={30} m={m} />
            <polygon points={`84,118 164,118 ${164 + 26 * DX},${118 - 26 * DY} ${84 + 26 * DX},${118 - 26 * DY}`} fill="#c9a24f" fillOpacity="0.9" />
          </g>
        );
      }
      const p = m;
      return (
        <g>
          <path d="M120 22 V44" stroke="#7d6a52" strokeWidth="1.6" />
          <path d="M112 44 h16 v8 h-16 z" fill="#4f8fd1" />
          <path d="M108 52 Q100 60 100 74 V128 Q100 138 110 138 H130 Q140 138 140 128 V74 Q140 60 132 52 Z" fill={p.front} fillOpacity="0.45" stroke={p.line} strokeWidth="1.2" />
          <path d="M101 104 V128 Q101 137 110 137 H130 Q139 137 139 128 V104 Z" fill="#c9a24f" fillOpacity="0.85" />
          <circle cx="120" cy="96" r="7" fill="#2f241b" fillOpacity="0.75" />
          <path d="M98 112 H142" stroke={MAT.wood.side} strokeWidth="4" strokeLinecap="round" />
          <path d="M106 66 V92" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M60 150 q8 -6 16 0 M164 148 q8 -6 16 0" stroke="#7d6a52" strokeWidth="1.2" fill="none" opacity="0.5" />
        </g>
      );
    }
    case 'led_light':
      return (
        <g>
          <ellipse cx="120" cy="84" rx="48" ry="40" fill={`url(#${id}-glow)`} />
          <Box x={86} y={110} w={68} h={34} d={30} m={m} />
          <path d="M108 110 V92 Q108 76 120 76 Q132 76 132 92 V110" fill="#fff6d6" fillOpacity="0.9" stroke="#e2c98a" strokeWidth="1" />
          <circle cx="120" cy="94" r="5" fill="#ffd27a" />
          <circle cx="140" cy="126" r="3" fill="#3ccf7f" />
          <rect x="94" y="122" width="22" height="8" rx="2" fill="#2f3640" fillOpacity="0.6" />
        </g>
      );
    default:
      if (m === MAT.fabric || m === MAT.leather) {
        // Neutral textile picture: a folded stack of the material.
        return (
          <g>
            {[0, 1, 2].map((i) => (
              <g key={i}>
                <path d={`M78 ${136 - i * 14} h84 q8 0 8 7 q0 7 -8 7 h-84 q-8 0 -8 -7 q0 -7 8 -7 z`} fill={i % 2 ? m.top : m.front} stroke={m.line} strokeOpacity="0.5" />
                <path d={`M80 ${140 - i * 14} h80`} stroke={m.line} strokeOpacity="0.4" strokeDasharray="3 3" />
              </g>
            ))}
          </g>
        );
      }
      // Neutral picture for products without a drawing of their own: the material itself as a
      // small stack of sheets — it doesn't pretend to show a specific product.
      return (
        <g>
          {[0, 1, 2, 3].map((i) => <Box key={i} x={70 + i * 4} y={134 - i * 12} w={100 - i * 4} h={8} d={52 - i * 4} m={m} />)}
        </g>
      );
  }
}

// Small objects are enlarged so every preview fills the stage about equally (scaled about the ground point).
const SCALE = { plant_stand: 1.05, bottle_planter: 1.05, bird_feeder: 1.05, led_light: 1.15, candle_jar: 1.45, jar: 1.3, vase: 1.08, plant_pot: 1.15, tray: 1.3, coaster: 1.2, box: 1.15, crate: 1.1, organizer: 1.1, pouch: 1.1, stand: 1.1, stool: 1.15, birdhouse: 1.12, sign: 1.08, generic: 1.25 };

const KIND_LABEL = { plant_stand: 'plant stand', bottle_planter: 'bottle planter', bottle_organizer: 'bottle organiser', bird_feeder: 'bird feeder', led_light: 'LED light', candle_jar: 'candle in a jar', jar: 'storage jar', vase: 'vase', planter_box: 'planter box', plant_pot: 'plant pot', wall_shelf: 'wall shelf', bookshelf: 'bookshelf', box: 'box', crate: 'crate', organizer: 'organiser', tray: 'tray', coaster: 'coaster set', frame: 'picture frame', stand: 'stand', pouch: 'pouch', tote_bag: 'tote bag', key_rack: 'key rack', lamp: 'lamp', stool: 'stool', birdhouse: 'birdhouse', sign: 'sign', generic: 'product' };

/**
 * @param idea      the idea/project idea (name, summary, visualKind, usesExisting, size)
 * @param photo     an example photo from productPhotos ({src, author, license, …}); `undefined`
 *                  picks one automatically, `null` forces the concept illustration
 * @param caption   show the "Example photo" / "Concept illustration" label
 * @param image     a picture generated for THIS idea ({src, model}); also read from idea.image
 * @param imageLoading  the picture is being generated — the fallback is shown meanwhile
 */
export function ProductPreview({ idea, photo, caption = true, className = '', image, imageLoading = false }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [broken, setBroken] = useState(false);
  const [genBroken, setGenBroken] = useState(false);
  const kind = resolveKind(idea);
  const material = resolveMaterial(idea, kind);
  const m = MAT[material];
  // A project row carries its idea inside (p.idea.image); an idea carries it directly.
  const gen = genBroken ? null : image || idea?.image || idea?.idea?.image || null;
  if (gen?.src) {
    // Generated from this idea's own description (name, materials, size) — a preview, not a photo of a real build.
    return (
      <figure className={`product-preview is-photo is-generated ${className}`}>
        <img src={gen.src} alt={`AI-generated preview of ${idea?.name || 'the product'}, made from ${material}`} decoding="async" onError={() => setGenBroken(true)} />
        {caption && <figcaption title={`Generated by Google ${gen.model || 'Gemini'} from this idea's description — not a photo of a real build`}>AI-generated preview</figcaption>}
      </figure>
    );
  }
  const loadingCaption = imageLoading ? <figcaption className="is-loading"><span className="spinner" style={{ width: 9, height: 9 }} />Creating picture…</figcaption> : null;
  const p = broken ? null : photo === undefined ? photoFor(idea) : photo;
  if (p) {
    // A real photo of this kind of product (not the user's exact design), with its credit.
    return (
      <figure className={`product-preview is-photo ${className}`}>
        <img src={p.src} alt={`Example photo of a ${material} ${KIND_LABEL[kind]}, similar to ${idea?.name || 'this product'}`} loading="lazy" decoding="async" style={{ objectPosition: p.position }} onError={() => setBroken(true)} />
        {caption && (loadingCaption || <figcaption title={`${p.title} — ${p.author}, ${p.license} (${p.source})`}>Example photo</figcaption>)}
      </figure>
    );
  }
  return (
    <figure className={`product-preview ${className}`}>
      <svg viewBox="0 0 240 180" role="img" aria-label={`Concept illustration of ${idea?.name || 'the product'}: ${material} ${KIND_LABEL[kind]}`}>
        <defs>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor="#ffd27a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-flame`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffb347" />
            <stop offset="1" stopColor="#ff7a1a" />
          </linearGradient>
          <radialGradient id={`${id}-shadow`}>
            <stop offset="0" stopColor="#000" stopOpacity="0.22" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="124" cy="150" rx="84" ry="12" fill={`url(#${id}-shadow)`} />
        <g transform={`translate(120 150) scale(${SCALE[kind] || 1}) translate(-120 -150)`}>{drawKind(kind, m, id, idea?.size, `${idea?.name || ''} ${idea?.summary || ''}`.toLowerCase())}</g>
      </svg>
      {caption && (loadingCaption || <figcaption>Concept illustration</figcaption>)}
    </figure>
  );
}
