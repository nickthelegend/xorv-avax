import { useMemo, useState } from 'react';
import { D, addrUrl, ago, jobTitle, modelName, modelUrl, money, rate1m, short, useMarket, useNow } from '../lib/data';
import { Link } from '../lib/router';
import { Icon, State } from '../components/Ui';
import { Avatar, PageHead, Tag, Tile } from '../components/Shell';
import { ProvidersTable, StatusTag } from '../components/Market';

type Sort = 'earned' | 'stake' | 'wins' | 'record';

export function Providers() {
  const m = useMarket();
  const [sort, setSort] = useState<Sort>('earned');
  const d = m.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const key = (p: (typeof d.providers)[number]) => (sort === 'earned' ? -Number(p.totalEarned) : sort === 'stake' ? -Number(p.stake) : sort === 'wins' ? -p.wins : p.slashes);
    return [...d.providers].sort((a, b) => key(a) - key(b));
  }, [d, sort]);
  return (
    <div className="wrap page">
      <PageHead title="Providers" art="rack" sub={`Nodes selling idle AI capacity. Each stakes at least ${money(D.config.minStake, 0)} tUSD and loses ${D.config.slashBps / 100}% when a tiebreaker catches it lying.`}
        actions={<Link to="/providers/join" className="btn btn-w"><Icon name="plus" size={15} />Become a provider</Link>} />
      {d && (
        <div className="tiles" style={{ marginBottom: 20 }}>
          <Tile label="Staked providers" value={d.providers.length} />
          <Tile label="Total stake" value={money(d.stats.staked, 2)} note="tUSD in the registry" />
          <Tile label="Paid to providers" value={money(d.stats.paid)} note="clearing prices and check fees" />
          <Tile label="Slashed" value={money(d.stats.slashed, 2)} note={`${d.stats.slashCount} slash${d.stats.slashCount === 1 ? '' : 'es'}`} />
        </div>
      )}
      <div className="toolbar">
        <label className="sr" htmlFor="psort">Sort</label>
        <select id="psort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ marginLeft: 'auto' }}>
          <option value="earned">Most earned</option><option value="stake">Most stake</option><option value="wins">Most wins</option><option value="record">Fewest slashes</option>
        </select>
      </div>
      {m.error && !d && <State kind="error" art="warning" title="Could not read the registry" action={<button className="btn btn-sm" onClick={m.reload}>Retry</button>}>{m.error}</State>}
      {!d && !m.error && <div className="skeleton sk-row" />}
      {d && <ProvidersTable providers={rows} />}
      <p className="note" style={{ marginTop: 12 }}>Node keys bid, deliver and check; only the owner key can unstake or withdraw earnings.</p>
    </div>
  );
}

/** One provider: stake, earnings, record, models and recent jobs it touched. */
export function Provider({ label }: { label: string }) {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  const p = d?.providers.find((x) => x.label === label);
  if (!d) return <div className="wrap page">{m.error ? <State kind="error" art="warning" title="Could not read the registry">{m.error}</State> : <><div className="skeleton sk-row" /><div className="tiles" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton sk-tile" />)}</div></>}</div>;
  if (!p) return <div className="wrap page"><PageHead crumbs={[['/providers', 'Providers']]} title={`No provider "${label}"`} /><State kind="empty" art="empty" title="The registry has no provider with that name" action={<Link to="/providers" className="btn btn-sm">All providers</Link>}>Check the spelling, or see every registered provider.</State></div>;
  const mine = d.jobs.filter((j) => j.winner.toLowerCase() === p.owner.toLowerCase());
  return (
    <div className="wrap page">
      <PageHead crumbs={[['/providers', 'Providers']]}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}><Avatar name={p.label} big bad={p.slashes > 0} />{p.label}{p.slashes ? <Tag tone="bad">{p.slashes} slashed</Tag> : <Tag tone="ok">Never slashed</Tag>}</span>}
        sub={<>node <a href={addrUrl(p.node)} target="_blank" rel="noreferrer" className="link mono-c">{short(p.node, 6)}</a> · owner <a href={addrUrl(p.owner)} target="_blank" rel="noreferrer" className="link mono-c">{short(p.owner, 6)}</a> · {p.kind} key · joined {ago(Number(p.joinedAt), now)}</>}
        actions={p.models[0] ? <Link to={`/chat?model=${encodeURIComponent(p.models[0])}`} className="btn btn-w btn-sm"><Icon name="chat" size={14} />Chat</Link> : undefined} />
      <div className="tiles">
        <Tile label="Stake" value={money(p.stake, 2)} note={p.unbonding > 0n ? `${money(p.unbonding, 2)} unbonding` : 'bonded'} />
        <Tile label="Earned" value={money(p.totalEarned)} note={`${money(p.earned)} not withdrawn`} />
        <Tile label="Bids · wins" value={`${p.bids} · ${p.wins}`} note={p.bids ? `${Math.round((p.wins / p.bids) * 100)}% won` : 'no bids yet'} />
        <Tile label="Checks run" value={p.checks} note="re-runs of other nodes' answers" />
        <Tile label="Slashed" value={money(p.slashed, 2)} note={`${p.slashes} time${p.slashes === 1 ? '' : 's'}`} />
      </div>
      <section className="sec">
        <div className="sec-h"><div><h2>Models served</h2></div></div>
        <div className="mlist">
          {p.models.map((x) => (
            <Link key={x} to={modelUrl(x)} className="mrow">
              <div className="mrow-top"><h3><span>{modelName(x)}</span></h3><small>{mine.filter((j) => j.model === x).length} recent wins</small></div>
              <div className="meta"><span className="mono-c">{x}</span><span>last cleared win <b>{rate1m(mine.find((j) => j.model === x)?.clearedRate ?? null)}</b> / 1M</span></div>
            </Link>
          ))}
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>Recent wins</h2><p>From the latest 40 jobs on the market.</p></div></div>
        {mine.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Job</th><th className="r">Rate</th><th className="r">Tokens</th><th className="r">Paid</th><th>Status</th></tr></thead>
              <tbody>{mine.map((j) => <tr key={j.id}><td className="wrap-c"><Link to={`/jobs/${j.id}`} className="row-link"><span className="faint mono-c">#{j.id}</span> {jobTitle(d, j)}</Link></td><td className="r num">{rate1m(j.clearedRate)}</td><td className="r num">{j.tokens}</td><td className="r num">{j.charge ? money(j.charge) : '—'}</td><td><StatusTag j={j} /></td></tr>)}</tbody>
            </table>
          </div>
        ) : <State kind="empty" art="empty" title="No wins in the latest jobs">{p.label} has not won a recent auction.</State>}
      </section>
    </div>
  );
}
