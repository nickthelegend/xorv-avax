import { useMemo, useState } from 'react';
import { KIND, acctUrl, ago, hostName, jobNodes, modelName, modelUrl, near, nearNum, nodeStats, pct, secs, short, useMarket } from '../lib/data';
import { Link } from '../lib/router';
import { Icon, State } from '../components/Ui';
import { Avatar, PageHead, Tag, Tile } from '../components/Shell';
import { Bars } from '../components/Charts';
import { fmt4 } from '../components/Market';

type Sort = 'earned' | 'price' | 'stake' | 'clean';

/** Every registered provider on the contract, as a sortable table. */
export function Providers() {
  const m = useMarket();
  const [sort, setSort] = useState<Sort>('earned');
  const [role, setRole] = useState<'all' | 'compute' | 'verifier'>('all');
  const d = m.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const r = d.providers.filter((p) => role === 'all' || p.roles.includes(role)).map((p) => ({ p, s: nodeStats(p, d.full) }));
    const key = (x: (typeof r)[number]) => (sort === 'earned' ? -nearNum(x.p.total_earned) : sort === 'stake' ? -nearNum(x.p.stake) : sort === 'clean' ? -(x.s.clean ?? -1) : x.s.lastBid?.perUnit ?? 1e9);
    return r.sort((a, b) => key(a) - key(b));
  }, [d, sort, role]);
  return (
    <div className="wrap page">
      <PageHead title="Providers" art="rack" sub="People selling idle AI capacity. Each stakes NEAR and loses 10% when a check catches it lying."
        actions={<Link to="/providers/join" className="btn btn-w"><Icon name="plus" size={15} />Become a provider</Link>} />
      {d && (
        <div className="tiles" style={{ marginBottom: 20 }}>
          <Tile label="Staked providers" value={d.stats.providers} />
          <Tile label="Total stake" value={near(d.stats.total_stake, 3)} unit="NEAR" />
          <Tile label="Paid to providers" value={near(d.stats.paid_to_providers, 3)} unit="NEAR" />
          <Tile label="Slashed" value={near(d.stats.slashed, 3)} unit="NEAR" note={`${d.stats.slash_count} slash${d.stats.slash_count === 1 ? '' : 'es'}`} />
        </div>
      )}
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Role">
          {(['all', 'compute', 'verifier'] as const).map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{r === 'all' ? 'All' : r === 'compute' ? 'Serve models' : 'Verify bounties'}</button>)}
        </div>
        <label className="sr" htmlFor="psort">Sort</label>
        <select id="psort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ marginLeft: 'auto' }}>
          <option value="earned">Most earned</option><option value="price">Lowest last bid</option><option value="stake">Most stake</option><option value="clean">Best record</option>
        </select>
      </div>
      {m.error && !d && <State kind="error" art="warning" title="Could not read the contract" action={<button className="btn btn-sm" onClick={m.reload}>Retry</button>}>{m.error}</State>}
      {!d && !m.error && <div className="skeleton sk-row" />}
      {d && !rows.length && <State kind="empty" art="empty" title="No providers match">Nobody with that role has registered yet.</State>}
      {d && rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Provider</th><th>Capacity</th><th>Models</th><th className="r">Last bid / unit</th><th className="r">Latency P50</th><th className="r">Stake</th><th className="r">Earned</th><th className="r">Kept stake</th></tr></thead>
            <tbody>
              {rows.map(({ p, s }) => (
                <tr key={p.owner}>
                  <td><Link to={`/providers/${p.label}`} className="who"><Avatar name={p.label} bad={p.slashes > 0} /><span><b className="row-link">{p.label}</b><small>{short(p.node)}</small></span></Link></td>
                  <td>{KIND[p.kind] ?? p.kind}<div className="faint" style={{ fontSize: 12.5 }}>{p.roles.join(' · ')}</div></td>
                  <td className="wrap-c" style={{ minWidth: 200 }}>{p.models.map((x, i) => <span key={x}>{i ? ', ' : ''}<Link to={modelUrl(x)} className="link" style={{ textDecorationColor: 'transparent' }}>{modelName(x).split(': ').pop()}</Link></span>)}</td>
                  <td className="r num">{s.lastBid ? fmt4(s.lastBid.perUnit) : <span className="faint">{p.roles.includes('compute') ? 'no bid yet' : 'verifier'}</span>}</td>
                  <td className="r num">{secs(s.latencyMs)}</td>
                  <td className="r num">{near(p.stake, 3)}</td>
                  <td className="r num">{near(p.total_earned, 4)}</td>
                  <td className="r num"><span className={p.slashes ? 'bad-c' : ''}>{pct(s.clean)}</span>{p.slashes > 0 && <div className="faint" style={{ fontSize: 12 }}>{p.slashes} slash{p.slashes === 1 ? '' : 'es'}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note" style={{ marginTop: 12 }}>NEAR per unit of up to 256 output tokens, from each provider's last revealed bid.</p>
    </div>
  );
}

/** One provider: stake, earnings, record, the models it serves and its job history. */
export function Provider({ label }: { label: string }) {
  const m = useMarket();
  const d = m.data;
  const p = d?.providers.find((x) => x.label === label);
  if (!d) return <div className="wrap page">{m.error ? <State kind="error" title="Could not read the contract">{m.error}</State> : <><div className="skeleton sk-row" /><div className="tiles" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton sk-tile" />)}</div></>}</div>;
  if (!p) return <div className="wrap page"><PageHead crumbs={[['/providers', 'Providers']]} title={`No provider "${label}"`} /><State kind="empty" title="This contract has no provider with that name" action={<Link to="/providers" className="btn btn-sm">All providers</Link>}>Check the spelling, or see every registered provider.</State></div>;
  const s = nodeStats(p, d.full);
  const rows = s.worked.map((w) => {
    const j = d.full.get(w.id)!;
    const earned = j.payouts.filter((x) => x.account === p.owner).reduce((a, x) => a + nearNum(x.amount), 0);
    const lost = j.slashes.filter((x) => x.account === p.owner).reduce((a, x) => a + nearNum(x.amount), 0);
    const bid = j.bids.find((b) => b.owner === p.owner);
    const role = j.winner === p.owner ? 'won' : j.checks.some((c) => c.owner === p.owner) ? 'checker' : j.verifiers.some((v) => v.owner === p.owner) ? 'verifier' : j.patches.some((x) => x.owner === p.owner) ? 'solver' : 'bid, lost';
    return { j, earned, lost, bid, role, nodes: jobNodes(j).length };
  }).reverse();
  return (
    <div className="wrap page">
      <PageHead crumbs={[['/providers', 'Providers']]}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}><Avatar name={p.label} big bad={p.slashes > 0} />{p.label}{p.slashes ? <Tag tone="bad">{p.slashes} slashed</Tag> : <Tag tone="ok">Never slashed</Tag>}</span>}
        sub={<><a href={acctUrl(p.node)} target="_blank" rel="noreferrer" className="link mono-c">{p.node}</a> · {KIND[p.kind] ?? p.kind} · {p.roles.join(', ')} · joined {ago(p.joined_ms, d.stats.now_ms)}</>}
        actions={p.roles.includes('compute') && p.models[0] ? <Link to={`/chat?model=${encodeURIComponent(p.models[0])}`} className="btn btn-w btn-sm"><Icon name="chat" size={14} />Chat with {modelName(p.models[0]).split(': ').pop()}</Link> : undefined} />
      <div className="tiles">
        <Tile label="Stake" value={near(p.stake, 3)} unit="NEAR" note={BigInt(p.unbonding) > 0n ? `${near(p.unbonding)} NEAR unbonding` : 'bonded'} />
        <Tile label="Earned" value={near(p.total_earned, 4)} unit="NEAR" note={`${p.wins} won · ${p.checks} checks · ${p.votes} votes`} />
        <Tile label="Kept stake" value={pct(s.clean)} note={`${s.worked.length - s.bad} of ${s.worked.length} jobs`} />
        <Tile label="Latency P50" value={secs(s.latencyMs)} note={s.samples.length ? `${s.samples.length} deliveries` : 'no deliveries yet'} />
        <Tile label="Last bid" value={s.lastBid ? fmt4(s.lastBid.perUnit) : '—'} unit={s.lastBid ? 'NEAR / unit' : undefined} note={s.lastBid ? `job #${s.lastBid.job}` : 'no revealed bid'} />
      </div>
      <section className="sec">
        <div className="sec-h"><div><h2>{p.roles.includes('compute') ? 'Models served' : 'Configured models'}</h2></div></div>
        <div className="mlist">
          {p.models.map((x) => (
            <Link key={x} to={modelUrl(x)} className="mrow">
              <div className="mrow-top"><h3><span>{modelName(x)}</span><span className="pill">{hostName(x)}</span></h3><small>{d.jobs.filter((j) => j.model === x && j.winner === p.owner).length} won here</small></div>
              <div className="meta"><span>{KIND[p.kind]}</span><span>last bid <b>{s.lastBid ? fmt4(s.lastBid.perUnit) : '—'}</b> NEAR / unit</span><span>key can call node methods only</span></div>
            </Link>
          ))}
        </div>
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>NEAR per job</h2></div></div>
        {rows.length ? <div className="card card-pad"><Bars groups={[...rows].reverse().map((r) => ({ label: `#${r.j.id}`, values: [r.earned, r.lost] }))} series={[{ name: 'Earned', color: 'var(--chart)' }, { name: 'Slashed', color: 'var(--bad)' }]} unit="NEAR" /></div> : <State kind="empty" title="No jobs yet">{p.label} hasn't taken part in a job on this contract.</State>}
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>Job history</h2><p>{rows.length} job{rows.length === 1 ? '' : 's'} in the latest reads.</p></div></div>
        {rows.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Job</th><th>Role</th><th className="r">Bid</th><th className="r">Earned</th><th className="r">Slashed</th><th className="r">Nodes</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.j.id}>
                    <td className="wrap-c"><Link to={`/jobs/${r.j.id}`} className="row-link"><span className="faint mono-c">#{r.j.id}</span> {r.j.title}</Link></td>
                    <td>{r.role}</td>
                    <td className="r num">{r.bid?.price ? near(r.bid.price, 4) : '—'}</td>
                    <td className="r num">{r.earned ? `+${r.earned.toFixed(4)}` : '—'}</td>
                    <td className={`r num ${r.lost ? 'bad-c' : ''}`}>{r.lost ? `−${r.lost.toFixed(4)}` : '—'}</td>
                    <td className="r num">{r.nodes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
