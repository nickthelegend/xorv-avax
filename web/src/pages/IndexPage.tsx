import { useState } from 'react';
import type { IndexModel, IndexObservation } from '@xorv/sdk';
import { C, D, addrUrl, int, modelName, money, rate1m, reader, utc, ago, useNow, usePoll } from '../lib/data';
import { Link } from '../lib/router';
import { CopyButton, Icon, State } from '../components/Ui';
import { PageHead, Tile } from '../components/Shell';

/** Cleared rate (dots) against the index (step line), both in $ per 1M tokens. */
function IndexChart({ obs, now }: { obs: IndexObservation[]; now: number }) {
  if (!obs.length) return null;
  const w = 1000, h = 300, padL = 64, padR = 16, padT = 14, padB = 30;
  const t0 = obs[0].timestamp, t1 = Math.max(now, obs[obs.length - 1].timestamp + 1);
  const ys = obs.flatMap((o) => [Number(o.rate), Number(o.indexRate)]);
  const lo = Math.min(...ys) * 0.9, hi = Math.max(...ys) * 1.08 || 1;
  const sx = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
  const sy = (v: number) => padT + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (h - padT - padB);
  let path = '';
  obs.forEach((o, i) => {
    const x = sx(o.timestamp), y = sy(Number(o.indexRate));
    path += i ? ` H${x.toFixed(1)} V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
  });
  path += ` H${sx(t1).toFixed(1)}`;
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure className="ichart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Index and cleared rate for ${obs.length} clearings`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={sy(t)} y2={sy(t)} style={{ stroke: 'var(--line)' }} />
            <text x={padL - 8} y={sy(t) + 4} textAnchor="end" className="bars-t">{rate1m(t)}</text>
          </g>
        ))}
        <text x={padL} y={h - 8} className="bars-l">{utc(t0).slice(5, 16)}</text>
        <text x={w - padR} y={h - 8} textAnchor="end" className="bars-l">now</text>
        <path d={path} fill="none" style={{ stroke: 'var(--chart)' }} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {obs.map((o) => (
          <g key={o.jobId}>
            {o.rate !== o.indexRate && <line x1={sx(o.timestamp)} x2={sx(o.timestamp)} y1={sy(Number(o.rate))} y2={sy(Number(o.indexRate))} style={{ stroke: 'var(--ink-3)' }} strokeDasharray="3 3" />}
            <circle cx={sx(o.timestamp)} cy={sy(Number(o.rate))} r="4.5" style={{ fill: 'var(--bg)', stroke: 'var(--ink-2)' }} strokeWidth="1.5"><title>{`Job #${o.jobId}: cleared ${rate1m(o.rate)}, index ${rate1m(o.indexRate)} per 1M`}</title></circle>
          </g>
        ))}
      </svg>
      <figcaption className="legend"><span><i style={{ background: 'var(--chart)' }} />Index (step, clamped)</span><span><i style={{ background: 'transparent', border: '1.5px solid var(--ink-2)', borderRadius: 6 }} />What the auction cleared at</span><span className="legend-u">$ per 1M tokens</span></figcaption>
    </figure>
  );
}

function ModelIndex({ m, now }: { m: IndexModel; now: number }) {
  const obs = usePoll(() => reader.observations(m.id, Math.max(0, m.observations - 200), 200), 20_000, [m.id, m.observations]);
  const rows = obs.data ? [...obs.data].reverse() : [];
  return (
    <section className="sec" aria-label={modelName(m.name)}>
      <div className="sec-h">
        <div><h2><Link to={`/models/${encodeURIComponent(m.name)}`}>{modelName(m.name)}</Link></h2><p className="mono-c">{m.name} · model id {m.id.slice(0, 10)}…</p></div>
        <Link to={`/chat?model=${encodeURIComponent(m.name)}`}>Buy at this price <Icon name="arrow" size={14} /></Link>
      </div>
      <div className="tiles">
        <Tile label="Index rate" value={rate1m(m.rate)} unit="/ 1M tokens" note={`updated ${ago(m.updatedAt, now)}`} />
        <Tile label="TWAP 1h" value={m.twap1h != null ? rate1m(m.twap1h) : '—'} unit="/ 1M" note="time-weighted, on-chain" />
        <Tile label="TWAP 24h" value={m.twap24h != null ? rate1m(m.twap24h) : '—'} unit="/ 1M" />
        <Tile label="VWAP 24h" value={m.vwap24h.count ? rate1m(m.vwap24h.rate) : '—'} unit="/ 1M" note={`${int(m.vwap24h.tokens)} tokens · ${money(m.vwap24h.usd)}`} />
        <Tile label="Clearings" value={int(m.observations)} note={`${m.vwap24h.count} in the last 24h`} />
      </div>
      <div className="card card-pad" style={{ marginTop: 12 }}>
        {obs.data ? <IndexChart obs={obs.data} now={now} /> : obs.error ? <State kind="error" art="warning" title="Could not read observations">{obs.error}</State> : <div className="skeleton sk-row" />}
      </div>
      {rows.length > 0 && (
        <div className="tbl-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>Job</th><th>When</th><th className="r">Cleared</th><th className="r">Index moved to</th><th className="r">Tokens</th><th className="r">Paid</th></tr></thead>
            <tbody>
              {rows.slice(0, 25).map((o) => (
                <tr key={o.jobId}>
                  <td><Link to={`/jobs/${o.jobId}`} className="row-link">#{o.jobId}</Link></td>
                  <td className="faint" title={utc(o.timestamp)}>{ago(o.timestamp, now)}</td>
                  <td className="r num">{rate1m(o.rate)}</td>
                  <td className="r num">{rate1m(o.indexRate)}{o.rate !== o.indexRate && <span className="faint"> · clamped</span>}</td>
                  <td className="r num">{int(o.tokens)}</td>
                  <td className="r num">{money(o.charge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const SOL = `interface IXorvIndex {
    function twap(bytes32 model, uint256 window) external view returns (uint256 ratePer1k);
    function vwap(bytes32 model, uint256 window) external view
        returns (uint256 ratePer1k, uint256 tokens, uint256 usd, uint256 count);
    function latest(bytes32 model) external view returns (uint256 rate, uint256 updatedAt, uint256 observations);
}

// micro-dollars per 1k tokens, e.g. a quote for 4,000 tokens of GPT-OSS 20B:
bytes32 m = keccak256("groq:openai/gpt-oss-20b");
uint256 cost = IXorvIndex(${C.index}).twap(m, 3600) * 4000 / 1000;`;

export function IndexPage() {
  const now = useNow(10_000);
  const idx = usePoll(() => reader.indexModels(), 15_000);
  const [tab, setTab] = useState<'sol' | 'api'>('sol');
  const api = `curl ${location.origin}/api/index`;
  return (
    <div className="wrap page">
      <PageHead title="Xorv Compute Index" art="gavel" sub="What AI work actually costs, per model, from sealed-bid auctions that were delivered and paid on Avalanche Fuji." />
      <div className="idx-rules">
        <p><Icon name="check" size={15} />Only paid jobs count: delivered, checked or not sampled, at least two revealed bids, and a buyer who is not the winner.</p>
        <p><Icon name="shield" size={15} />One clearing moves the index at most {D.config.indexMaxStepBps / 100}%, so a cheap outlier cannot drag it. The job record keeps the true price.</p>
      </div>
      {idx.error && !idx.data && <State kind="error" art="warning" title="Could not read the index" action={<button className="btn btn-sm" onClick={idx.reload}>Retry</button>}>{idx.error}</State>}
      {!idx.data && !idx.error && <><div className="skeleton sk-row" /><div className="skeleton sk-row" style={{ marginTop: 12 }} /></>}
      {idx.data && !idx.data.length && <State kind="empty" art="empty" title="No clearing has reached the index yet" action={<Link to="/chat" className="btn btn-sm">Run a chat</Link>}>The first paid auction with two revealed bids sets the first price.</State>}
      {idx.data?.map((m) => <ModelIndex key={m.id} m={m} now={now} />)}

      <section className="sec" id="api" aria-labelledby="h-read">
        <div className="sec-h"><div><h2 id="h-read">Read it</h2><p>From any contract on Fuji, or as JSON from the gateway.</p></div>
          <a href={addrUrl(C.index)} target="_blank" rel="noreferrer">XorvIndex {C.index.slice(0, 10)}… <Icon name="external" size={13} /></a></div>
        <div className="seg" role="group" aria-label="Interface" style={{ marginBottom: 10 }}>
          <button aria-pressed={tab === 'sol'} onClick={() => setTab('sol')}>Solidity</button>
          <button aria-pressed={tab === 'api'} onClick={() => setTab('api')}>HTTP</button>
        </div>
        <div className="codebox">
          <div className="codebox-h"><span>{tab === 'sol' ? 'solidity' : 'terminal'}</span><CopyButton text={tab === 'sol' ? SOL : api} className="btn btn-sm btn-ghost" /></div>
          <pre>{tab === 'sol' ? SOL : `${api}\n\n# models[]: id, name, rate, updatedAt, observations, twap1h, twap24h, vwap24h,\n# and the last 200 observations (timestamp, rate, indexRate, jobId, tokens, charge).\n# Units: micro-tUSD per 1k tokens.`}</pre>
        </div>
        {tab === 'api' && <p className="note" style={{ marginTop: 8 }}><a className="link" href="/api/index" target="_blank" rel="noreferrer">Open /api/index</a> (needs the gateway running).</p>}
      </section>
    </div>
  );
}
