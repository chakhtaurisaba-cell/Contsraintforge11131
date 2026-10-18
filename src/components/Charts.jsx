// Recharts wrappers following the app's data-viz rules: thin marks, recessive grid,
// hover tooltips, fixed categorical colour order, single y-axis.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { money } from '../utils/format.js';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const axis = { stroke: 'var(--muted)', fontSize: 11.5, tickLine: false, axisLine: { stroke: 'var(--border-strong)' } };

function Tip({ active, payload, label, currency, labelFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="t">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="row" style={{ gap: 8 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, display: 'inline-block' }} />
          <span className="text-2">{p.name}</span>
          <span className="num strong" style={{ marginLeft: 'auto' }}>{currency ? money(p.value, currency) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Revenue and profit over time (same unit → one axis). */
export function TimelineChart({ data, currency, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="key" {...axis} minTickGap={24} />
        <YAxis {...axis} width={56} tickFormatter={(v) => Number(v).toLocaleString()} />
        <Tooltip content={<Tip currency={currency} />} cursor={{ stroke: 'var(--border-strong)' }} />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gRev)" activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="profit" name="Profit" stroke="var(--chart-2)" strokeWidth={2} fill="transparent" activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for a single measure across categories (e.g. profit/unit by channel). */
export function CategoryBars({ data, dataKey, name, currency, height, colorByIndex = true }) {
  const h = height || Math.max(120, data.length * 40 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barCategoryGap={8}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={(v) => Number(v).toLocaleString()} />
        <YAxis type="category" dataKey="key" {...axis} width={130} tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
        <Tooltip content={<Tip currency={currency} />} cursor={{ fill: 'var(--accent-soft)' }} />
        <ReferenceLine x={0} stroke="var(--border-strong)" />
        <Bar dataKey={dataKey} name={name} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={d.key} fill={colorByIndex ? SERIES[i % SERIES.length] : 'var(--s1)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Net profit per unit at different prices, with the break-even line. */
export function SensitivityChart({ data, currency, currentPrice, height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="price" {...axis} tickFormatter={(v) => Number(v).toFixed(0)} label={{ value: `Price (${currency})`, position: 'insideBottomRight', offset: -2, fill: 'var(--muted)', fontSize: 11 }} />
        <YAxis {...axis} width={52} />
        <Tooltip content={<Tip currency={currency} labelFmt={(l) => `At price ${money(l, currency)}`} />} />
        <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: 'break-even', fill: 'var(--danger)', fontSize: 11, position: 'insideTopLeft' }} />
        {currentPrice ? <ReferenceLine x={currentPrice} stroke="var(--text-2)" strokeDasharray="3 3" label={{ value: "your price", fill: "var(--text-2)", fontSize: 11, position: "insideTopRight" }} /> : null}
        <Line type="monotone" dataKey="netProfit" name="Net profit / unit" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
