import type { JobSummary, Job } from '@xorv/sdk';

/** 20-segment meter, like a telemetry bar. */
export function Meter({ bps, threshold, bad }: { bps: number; threshold?: number; bad?: boolean }) {
  const on = Math.round(bps / 500);
  return (
    <div className={`meter ${bad ? 'bad' : ''}`} role="img" aria-label={`${(bps / 100).toFixed(0)}%${threshold ? ` (needs ${threshold / 100}%)` : ''}`}>
      {Array.from({ length: 20 }, (_, i) => <i key={i} className={i < on ? 'on' : ''}  />)}
    </div>
  );
}

export function Spark({ points, height = 150 }: { points: { x: number; y: number }[]; height?: number }) {
  if (points.length === 0) return null;
  const w = 600;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) * 0.8, Math.max(...ys) * 1.15 || 1];
  const sx = (x: number) => (x1 === x0 ? w / 2 : 16 + ((x - x0) / (x1 - x0)) * (w - 32));
  const sy = (y: number) => height - 18 - ((y - y0) / (y1 - y0 || 1)) * (height - 40);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="Clearing price per unit over time">
      <defs>
        <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--chart)', stopOpacity: 0.26 }} /><stop offset="1" style={{ stopColor: 'var(--chart)', stopOpacity: 0 }} /></linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} style={{ stroke: 'var(--line)' }} />)}
      {points.length > 1 && <path d={`${d} L${sx(points[points.length - 1].x)},${height} L${sx(points[0].x)},${height} Z`} fill="url(#sg)" />}
      {points.length > 1 && <path d={d} fill="none" style={{ stroke: 'var(--chart)' }} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
      {points.length === 1 && <line x1="0" x2={w} y1={sy(points[0].y)} y2={sy(points[0].y)} style={{ stroke: 'var(--chart)' }} strokeOpacity="0.6" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />}
      {points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="5" style={{ fill: 'var(--surface)', stroke: 'var(--chart)' }} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

export function jobPrice(j: JobSummary | Job) {
  return j.kind === 'bounty' ? j.reward : BigInt(j.clearing_price) > 0n ? j.clearing_price : j.max_price;
}
