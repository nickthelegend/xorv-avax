import type { Job, Provider } from '@xorv/sdk';
import { ago, hostName, indexFor, jobTitle, labelOf, modelName, modelUrl, money, rate1m, servedModels, short, verdict, type Market } from '../lib/data';
import { Link } from '../lib/router';
import { State } from './Ui';
import { Avatar, Tag } from './Shell';

export function StatusTag({ j }: { j: Job }) {
  const v = verdict(j);
  return <Tag tone={v.tone}>{v.text}</Tag>;
}

/** Everything the list, card and model page show for one model, all from chain reads. */
export function modelOverview(model: string, m: Market) {
  const nodes = servedModels(m).get(model) ?? [];
  const jobs = m.jobs.filter((j) => j.model === model);
  const paid = jobs.filter((j) => j.status === 'Done' && j.charge > 0n);
  const settled = jobs.filter((j) => ['Done', 'Faulted', 'Expired'].includes(j.status));
  return { nodes, jobs, paid, settled, index: indexFor(m, model), deliveredRate: settled.length ? paid.length / settled.length : null };
}

export const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

/** OpenRouter list row: name, one-line description, meta row. */
export function ModelRow({ model, m }: { model: string; m: Market }) {
  const o = modelOverview(model, m);
  return (
    <Link to={modelUrl(model)} className="mrow">
      <div className="mrow-top">
        <h3><span>{modelName(model)}</span><span className="pill">{hostName(model)}</span></h3>
        <small>{o.jobs.length} recent job{o.jobs.length === 1 ? '' : 's'}</small>
      </div>
      {o.nodes.length
        ? <p>Served by {o.nodes.length} staked node{o.nodes.length === 1 ? '' : 's'} ({o.nodes.map((p) => p.label).join(', ')}). Every request is a sealed-bid auction among them; {m.config.spotCheckBps / 100}% are re-run by a second node.</p>
        : <p>No staked node serves this model now. It stays listed because of its past clearings.</p>}
      <div className="meta">
        <span className="mono-c">{model}</span>
        <span>index <b>{o.index ? rate1m(o.index.rate) : '—'}</b> / 1M tokens</span>
        <span>clearings <b>{o.index?.observations ?? 0}</b></span>
        <span>delivered <b>{pct(o.deliveredRate)}</b></span>
      </div>
    </Link>
  );
}

/** OpenRouter "featured model" card. */
export function ModelCard({ model, m }: { model: string; m: Market }) {
  const o = modelOverview(model, m);
  return (
    <Link to={modelUrl(model)} className="mcard">
      <div className="mcard-top"><Avatar name={modelName(model)} /><div style={{ minWidth: 0 }}><b>{modelName(model)}</b><small>via {hostName(model)} · {o.nodes.length ? `${o.nodes.length} staked nodes` : 'not served now'}</small></div></div>
      <div className="mcard-bot">
        <div><span>Clearings</span><b className="num">{o.index?.observations ?? 0}</b></div>
        <div><span>Index</span><b className="num">{o.index ? rate1m(o.index.rate) : '—'} <small className="faint">/ 1M</small></b></div>
      </div>
    </Link>
  );
}

export function ProvidersTable({ providers }: { providers: Provider[] }) {
  if (!providers.length) return <State kind="empty" art="empty" title="No providers yet">A provider appears here once it stakes tUSD in the registry.</State>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Provider</th><th>Models</th><th className="r">Stake</th><th className="r">Bids</th><th className="r">Wins</th><th className="r">Checks</th><th className="r">Earned</th><th className="r">Slashes</th></tr></thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.owner}>
              <td><Link to={`/providers/${p.label}`} className="who"><Avatar name={p.label} bad={p.slashes > 0} /><span><b className="row-link">{p.label}</b><small>{short(p.node)}</small></span></Link></td>
              <td className="faint">{p.models.map(modelName).join(', ')}</td>
              <td className="r num">{money(p.stake, 2)}</td>
              <td className="r num">{p.bids}</td>
              <td className="r num">{p.wins}</td>
              <td className="r num">{p.checks}</td>
              <td className="r num">{money(p.totalEarned)}</td>
              <td className={`r num ${p.slashes ? 'bad-c' : ''}`}>{p.slashes ? `${p.slashes} · ${money(p.slashed, 2)}` : '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JobsTable({ jobs, m, now }: { jobs: Job[]; m: Market; now: number }) {
  if (!jobs.length) return <State kind="empty" art="empty" title="No jobs yet">Jobs appear here as soon as one is posted to the market.</State>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Job</th><th>Model</th><th>Winner</th><th className="r">Cleared</th><th className="r">Paid</th><th className="r">Bids</th><th>Status</th><th className="r">Posted</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td className="wrap-c"><Link to={`/jobs/${j.id}`} className="row-link"><span className="faint mono-c">#{j.id}</span> {jobTitle(m, j)}</Link>{j.viaX402 && <span className="pill" style={{ marginLeft: 8 }}>x402</span>}</td>
              <td>{modelName(j.model)}</td>
              <td>{labelOf(m, j.winner) ? <Link to={`/providers/${labelOf(m, j.winner)}`}>{labelOf(m, j.winner)}</Link> : <span className="faint">—</span>}</td>
              <td className="r num">{j.clearedRate > 0n ? <>{rate1m(j.clearedRate)} <span className="faint">/1M</span></> : <span className="faint">—</span>}</td>
              <td className="r num">{j.charge > 0n ? money(j.charge) : <span className="faint">—</span>}</td>
              <td className="r num">{j.revealed}/{j.bidCount}</td>
              <td><StatusTag j={j} /></td>
              <td className="r faint" title={new Date(j.createdAt * 1000).toUTCString()}>{ago(j.createdAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
