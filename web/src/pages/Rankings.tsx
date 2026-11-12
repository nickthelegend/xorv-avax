import { useEffect } from 'react';
import { allModels, hostName, modelName, modelUrl, near, nearNum, paidForWork, short, useMarket, useNow } from '../lib/data';
import { Link, scrollToId } from '../lib/router';
import { Icon, State } from '../components/Ui';
import { Avatar, PageHead, Tile } from '../components/Shell';
import { JobsTable, TxTable } from '../components/Market';

const SECTIONS: [string, string, string][] = [['top-models', 'Top models', 'index'], ['leaderboard', 'Leaderboard', 'trophy'], ['activity', 'Activity', 'list'], ['recorded', 'Recorded run', 'book']];

/** OpenRouter rankings: models by usage, providers by earnings, then every job and the recorded transactions. */
export function Rankings() {
  const m = useMarket();
  const now = useNow(5000);
  const d = m.data;
  useEffect(() => { if (d && location.hash) scrollToId(location.hash.slice(1)); }, [!!d]); // eslint-disable-line react-hooks/exhaustive-deps
  const chainNow = d ? d.stats.now_ms + (now - m.at) : now;
  const models = d ? allModels(d).map((x) => {
    const jobs = d.jobs.filter((j) => j.kind === 'compute' && j.model === x);
    return { x, jobs: jobs.length, spent: jobs.reduce((a, j) => a + (d.full.has(j.id) ? paidForWork(d.full.get(j.id)!) : 0), 0) };
  }).sort((a, b) => b.jobs - a.jobs) : [];
  const maxJobs = Math.max(1, ...models.map((x) => x.jobs));
  const board = d ? [...d.providers].sort((a, b) => nearNum(b.total_earned) - nearNum(a.total_earned)) : [];
  const half = Math.ceil(board.length / 2);
  return (
    <div className="wrap page">
      <div className="with-side">
        <nav className="side" aria-label="Rankings sections">
          {SECTIONS.map(([k, l, ic]) => <a key={k} href={`#${k}`} onClick={(e) => { e.preventDefault(); history.replaceState(null, '', `#${k}`); scrollToId(k); }}><Icon name={ic} size={15} />{l}</a>)}
        </nav>
        <div style={{ minWidth: 0 }}>
          <PageHead title="Rankings" art="trophy" sub={<>Models and providers ranked by real use of the Xorv contract on NEAR testnet.{d && <> {d.stats.jobs} jobs so far.</>}</>} />
          {m.error && !d && <State kind="error" art="warning" title="Could not read the contract" action={<button className="btn btn-sm" onClick={m.reload}>Retry</button>}>{m.error}</State>}
          {!d && !m.error && <div className="skeleton sk-row" />}
          {d && <>
            <div className="tiles">
              <Tile label="Jobs" value={d.stats.jobs} note={`${d.stats.clearings} cleared auctions`} />
              <Tile label="Paid to providers" value={near(d.stats.paid_to_providers, 3)} unit="NEAR" />
              <Tile label="Slashed" value={near(d.stats.slashed, 3)} unit="NEAR" note={`${d.stats.slash_count} slashes`} />
              <Tile label="Total stake" value={near(d.stats.total_stake, 3)} unit="NEAR" />
            </div>

            <section id="top-models" className="sec">
              <div className="sec-h"><div><h2><Icon name="index" size={17} />Top models</h2></div></div>
              <div className="card card-pad">
                {models.length ? models.map((r, i) => (
                  <div className="hbar" key={r.x}>
                    <span>{i + 1}.</span>
                    <div><div className="nm"><Link to={modelUrl(r.x)}>{modelName(r.x)}</Link><small>via {hostName(r.x)}</small></div><div className="track"><i style={{ width: `${(r.jobs / maxJobs) * 100}%` }} /></div></div>
                    <b>{r.jobs} jobs<small>{r.spent.toFixed(3)} NEAR paid</small></b>
                  </div>
                )) : <p className="note">No models yet.</p>}
              </div>
            </section>

            <section id="leaderboard" className="sec">
              <div className="sec-h"><div><h2><Icon name="trophy" size={17} />Provider leaderboard</h2><p>By NEAR earned.</p></div><Link to="/providers">All providers <Icon name="arrow" size={14} /></Link></div>
              <div className="card card-pad lb">
                {[board.slice(0, half), board.slice(half)].map((col, c) => (
                  <div key={c}>
                    {col.map((p, i) => (
                      <div className="hbar" key={p.owner}>
                        <span>{c * half + i + 1}.</span>
                        <Link to={`/providers/${p.label}`} className="who"><Avatar name={p.label} bad={p.slashes > 0} /><span><b className="row-link">{p.label}</b><small>{short(p.node)}</small></span></Link>
                        <b>{near(p.total_earned, 4)} NEAR<small className={p.slashes ? 'bad-c' : ''}>{p.wins} won · {p.slashes ? `${p.slashes} slashed` : 'never slashed'}</small></b>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section id="activity" className="sec">
              <div className="sec-h"><div><h2><Icon name="list" size={17} />Activity</h2></div></div>
              <JobsTable jobs={d.jobs} m={d} now={chainNow} />
            </section>
          </>}

          <section id="recorded" className="sec">
            <div className="sec-h"><div><h2><Icon name="book" size={17} />Recorded run (Nov 9)</h2><p>Deploy-day run with faults injected on purpose.</p></div></div>
            <TxTable />
          </section>
        </div>
      </div>
    </div>
  );
}
