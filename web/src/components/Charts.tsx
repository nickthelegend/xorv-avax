/** Grouped bar chart drawn in SVG; every bar is a real value passed in, labelled under the axis. */
export function Bars({ groups, series, height = 200, unit }: { groups: { label: string; values: number[] }[]; series: { name: string; color: string }[]; height?: number; unit?: string }) {
  if (!groups.length) return null;
  const w = 640, padL = 44, padB = 26, padT = 10;
  const max = Math.max(...groups.flatMap((g) => g.values), 0) || 1;
  const ticks = [0, 0.5, 1].map((f) => max * f);
  const gw = (w - padL) / groups.length;
  const bw = Math.min(28, (gw * 0.6) / series.length);
  const y = (v: number) => padT + (height - padB - padT) * (1 - v / max);
  const fmt = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(3));
  return (
    <figure className="bars">
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={groups.map((g) => `${g.label}: ${g.values.map((v, i) => `${series[i].name} ${fmt(v)}${unit ? ' ' + unit : ''}`).join(', ')}`).join('; ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--line)' }} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="bars-t">{fmt(t)}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const x0 = padL + gi * gw + (gw - bw * series.length - 4 * (series.length - 1)) / 2;
          return (
            <g key={g.label}>
              {g.values.map((v, si) => <rect key={si} x={x0 + si * (bw + 4)} y={y(v)} width={bw} height={Math.max(0, height - padB - y(v))} rx="5" style={{ fill: series[si].color }}><title>{`${g.label} · ${series[si].name}: ${fmt(v)}${unit ? ' ' + unit : ''}`}</title></rect>)}
              <text x={padL + gi * gw + gw / 2} y={height - 6} textAnchor="middle" className="bars-l">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}{unit && <span className="legend-u">{unit}</span>}</figcaption>
    </figure>
  );
}
