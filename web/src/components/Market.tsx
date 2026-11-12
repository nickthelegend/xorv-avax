import { useState } from 'react';
import type { Clearing, JobSummary, Provider } from '@xorv/sdk';
import { KIND, ago, hhmm, hostName, longDay, modelName, modelUrl, modelStats, near, nearNum, nodeStats, pct, secs, short, txUrl, verdict, type MarketRead } from '../lib/data';
import { recordedTxs } from '../lib/evidence';
import { Link } from '../lib/router';
import { Icon } from './Ui';
import { Avatar, Tag } from './Shell';

export const perUnit = (c: Clearing) => nearNum(c.price) / Math.max(1, c.units);
/** Up to 4 decimals, trailing zeros dropped (0.0080 → 0.008). */
export const fmt4 = (x: number | null | undefined) => (x == null ? '—' : String(Number(x.toFixed(4))));

export function jobPrice(j: JobSummary) {
  if (j.kind === 'bounty') return { v: near(j.reward, 3), what: 'reward' };
  return BigInt(j.clearing_price) > 0n ? { v: near(j.clearing_price, 4), what: ['done', 'paid'].includes(j.status) ? 'paid' : 'bid' } : { v: near(j.max_price, 3), what: 'max' };
}

export function StatusTag({ j, m }: { j: JobSummary; m?: Pick<MarketRead, 'full'> }) {
  const v = verdict({ kind: j.kind, status: j.status, stage: j.stage, checks: m?.full.get(j.id)?.checks ?? [] });
  return <Tag tone={v.tone === 'ok' ? 'ok' : v.tone === 'bad' ? 'bad' : v.tone === 'live' ? 'live' : 'dim'}>{v.text}</Tag>;
}

/** Everything the list, card and model page show for one model, all derived from chain records. */
export function modelOverview(model: string, m: MarketRead) {
  const s = modelStats(model, m);
  const faulted = new Set(m.jobs.filter((j) => j.status === 'faulted').map((j) => j.id));
  const clean = s.clearings.filter((c) => !faulted.has(c.job_id));
  const last = clean.at(-1) ?? null;
  const delivered = s.jobs.filter((j) => ['done', 'paid'].includes(j.status)).length;
  const settled = s.jobs.filter((j) => ['done', 'paid', 'faulted', 'expired', 'refunded'].includes(j.status)).length;
  return { ...s, last: last ? perUnit(last) : null, lastJob: last?.job_id ?? null, low: clean.length ? Math.min(...clean.map(perUnit)) : null, delivered, settled, deliveredRate: settled ? delivered / settled : null };
}

/** OpenRouter list row: name, one-line description, then a meta row. */
export function ModelRow({ model, m }: { model: string; m: MarketRead }) {
  const o = modelOverview(model, m);
  return (
    <Link to={modelUrl(model)} className="mrow">
      <div className="mrow-top">
        <h3><span>{modelName(model)}</span><span className="pill">{hostName(model)}</span></h3>
        <small>{o.jobs.length} job{o.jobs.length === 1 ? '' : 's'} run</small>
      </div>
      {o.nodes.length ? <p>Served by {o.nodes.length} staked node{o.nodes.length === 1 ? '' : 's'} ({o.nodes.map((p) => p.label).join(', ')}). Every request is a sealed-bid auction among them; a random 30% are re-run by a second node.</p>
        : <p>No staked provider serves this model now. It stays listed because of its past job{o.jobs.length === 1 ? '' : 's'} on the contract.</p>}
      <div className="meta">
        <span>by <b>{hostName(model)}</b></span>
        <span><b>{fmt4(o.last)}</b> NEAR / unit last clearing</span>
        <span>median delivery <b>{secs(o.latencyMs)}</b></span>
        <span>delivered <b>{pct(o.deliveredRate)}</b></span>
        <span>prompt ≤ 1,500 chars · unit ≤ 256 tokens</span>
      </div>
    </Link>
  );
}

/** OpenRouter "featured model" card. */
export function ModelCard({ model, m }: { model: string; m: MarketRead }) {
  const o = modelOverview(model, m);
  return (
    <Link to={modelUrl(model)} className="mcard">
      <div className="mcard-top"><Avatar name={modelName(model)} /><div style={{ minWidth: 0 }}><b>{modelName(model)}</b><small>via {hostName(model)} · {o.nodes.length ? `${o.nodes.length} providers` : 'not served now'}</small></div></div>
      <div className="mcard-bot">
        <div><span>Jobs</span><b>{o.jobs.length}</b></div>
        <div><span>Last clearing</span><b>{fmt4(o.last)} <small className="faint">NEAR/unit</small></b></div>
      </div>
    </Link>
  );
}

export function ProvidersTable({ providers, m, model }: { providers: Provider[]; m: MarketRead; model?: string }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Provider</th><th>Capacity</th><th className="r">Last bid / unit</th><th className="r">Latency P50</th><th className="r">Throughput</th><th className="r">Stake</th><th className="r">Kept stake</th></tr></thead>
        <tbody>
          {providers.map((p) => {
            const s = nodeStats(p, m.full);
            const rate = s.clean;
            const on = rate == null ? 0 : Math.round(rate * 5);
            return (
              <tr key={p.owner}>
                <td><Link to={`/providers/${p.label}`} className="who"><Avatar name={p.label} bad={p.slashes > 0} /><span><b className="row-link">{p.label}</b><small>{short(p.node)}</small></span></Link></td>
                <td>{KIND[p.kind] ?? p.kind} <span className="faint">· {model ? hostName(model) : p.models.map(hostName).join(', ')}</span></td>
                <td className="r num">{s.lastBid ? fmt4(s.lastBid.perUnit) : <span className="faint">{p.roles.includes('compute') ? 'no bid yet' : 'verifier only'}</span>}</td>
                <td className="r num">{secs(s.latencyMs)}</td>
                <td className="r num">{s.charsPerSec ? `${Math.round(s.charsPerSec)} char/s` : '—'}</td>
                <td className="r num">{near(p.stake, 3)} <span className="faint">NEAR</span></td>
                <td className="r num"><span className={`bars5 ${p.slashes ? 'bad' : ''}`} aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < on ? 'on' : ''} />)}</span>{pct(rate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function JobsTable({ jobs, m, now }: { jobs: JobSummary[]; m: MarketRead; now: number }) {
  if (!jobs.length) return <div className="state"><span className="state-mark">○</span><div><h3>No jobs yet</h3><p>Jobs appear here as soon as one is posted on the contract.</p></div></div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Job</th><th>Model</th><th>Provider</th><th className="r">Price</th><th className="r">Bids</th><th>Status</th><th className="r">Posted</th></tr></thead>
        <tbody>
          {jobs.map((j) => {
            const p = jobPrice(j);
            return (
              <tr key={j.id}>
                <td className="wrap-c"><Link to={`/jobs/${j.id}`} className="row-link"><span className="faint mono-c">#{j.id}</span> {j.title}</Link></td>
                <td>{j.kind === 'bounty' ? <span className="faint">bug bounty</span> : modelName(j.model)}</td>
                <td>{j.winner ? <Link to={`/providers/${short(j.winner)}`}>{short(j.winner)}</Link> : <span className="faint">—</span>}</td>
                <td className="r num">{p.v} <span className="faint">NEAR {p.what}</span></td>
                <td className="r num">{j.kind === 'bounty' ? j.patches : j.bids}</td>
                <td><StatusTag j={j} m={m} /></td>
                <td className="r faint" title={`${longDay(j.created_ms)} ${hhmm(j.created_ms)} UTC`}>{ago(j.created_ms, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClearingsTable({ clearings, excluded }: { clearings: Clearing[]; excluded: Set<number> }) {
  if (!clearings.length) return <div className="state"><span className="state-mark">○</span><div><h3>No cleared auctions yet</h3><p>A price appears once a job's sealed bids are revealed and cleared.</p></div></div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Job</th><th className="r">Cleared</th><th className="r">Per unit</th><th className="r">Buyer max</th><th className="r">Bids</th><th>Winner</th><th>Counts in price</th></tr></thead>
        <tbody>
          {[...clearings].reverse().map((c) => (
            <tr key={c.job_id}>
              <td><Link to={`/jobs/${c.job_id}`} className="row-link">#{c.job_id}</Link> <span className="faint">{ago(c.ms)}</span></td>
              <td className="r num">{near(c.price, 4)}</td>
              <td className="r num">{fmt4(perUnit(c))}</td>
              <td className="r num">{near(c.max_price, 3)}</td>
              <td className="r num">{c.revealed}/{c.bids}</td>
              <td><Link to={`/providers/${short(c.winner)}`}>{short(c.winner)}</Link></td>
              <td>{excluded.has(c.job_id) ? <span title="The winner was slashed, so no real work was bought"><Tag tone="bad">No · slashed</Tag></span> : <Tag tone="ok">Yes</Tag>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The transactions recorded in deployments/ for the Nov 9 run (real hashes). */
export function TxTable({ limit = 8 }: { limit?: number }) {
  const rows = recordedTxs();
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="note">No recorded run in deployments/.</p>;
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <>
      <div className="card card-pad txs">
        {shown.map((r) => (
          <a key={r.hash} href={txUrl(r.hash)} target="_blank" rel="noreferrer">
            <span>{short(r.who)}</span>
            <b>{r.what}{r.job != null && ` · job #${r.job}`}</b>
            <em>{r.hash.slice(0, 10)}… <Icon name="external" size={11} /></em>
          </a>
        ))}
      </div>
      {rows.length > limit && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length} transactions`}</button>}
    </>
  );
}
