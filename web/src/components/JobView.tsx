import type { ReactNode } from 'react';
import type { Job } from '@xorv/sdk';
import { ago, clock, near, short, useNow, acctUrl, jobNodes, verdict, longDay, hhmm } from '../lib/data';
import { Meter } from './Bits';
import { Md } from './MdLazy';
import { Icon, State } from './Ui';
import { Kpi, Tag } from './Shell';
import { Link } from '../lib/router';

const CLOSED = ['done', 'paid', 'faulted', 'expired', 'refunded', 'forfeited'];

function stagesFor(j: Job, now: number) {
  if (j.kind === 'compute') {
    const at = j.status === 'bidding' ? (now < j.commit_end_ms ? 0 : 1) : j.status === 'running' ? 2 : ['checking', 'tiebreak'].includes(j.status) ? 3 : 4;
    return { names: ['Sealed bids', 'Reveal', 'Run', 'Spot check', 'Settled'], at };
  }
  const at = j.status === 'solving' ? (now < j.commit_end_ms ? 0 : 1) : j.status === 'verifying' ? 2 : 4;
  return { names: ['Solve', 'Reveal', 'Verify', 'Vote', 'Settled'], at: at === 2 && j.verifiers.some((v) => v.voted_ms) ? 3 : at };
}

function deadline(j: Job, now: number): [string, number] | null {
  if (CLOSED.includes(j.status)) return null;
  if (j.status === 'bidding' || j.status === 'solving') return now < j.commit_end_ms ? [j.kind === 'bounty' ? 'Solve window closes' : 'Bids close', j.commit_end_ms] : ['Reveals close', j.reveal_end_ms];
  if (j.status === 'running') return ['Delivery due', j.deliver_end_ms];
  if (j.status === 'checking' || j.status === 'tiebreak') return ['Check due', j.check_end_ms];
  if (j.status === 'verifying') return ['Votes due', j.verify_end_ms];
  return null;
}

function Sec({ id, title, meta, children }: { id?: string; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="jsec" id={id} aria-label={title}>
      <header className="jsec-h"><h2>{title}</h2>{meta && <span className="jsec-meta">{meta}</span>}</header>
      {children}
    </section>
  );
}

export function JobView({ job: j, chainNow: readNow, readAt }: { job: Job; chainNow: number; readAt: number }) {
  const wall = useNow(1000);
  const chainNow = readNow + Math.max(0, wall - readAt);
  const st = stagesFor(j, chainNow);
  const dl = deadline(j, chainNow);
  const left = dl ? Math.max(0, dl[1] - chainNow) : 0;
  const v = verdict(j);
  const nodes = jobNodes(j);
  const price = j.kind === 'bounty' ? { v: near(j.reward, 3), l: 'Reward' } : BigInt(j.clearing_price) > 0n ? { v: near(j.clearing_price, 4), l: 'Cleared at' } : { v: near(j.max_price, 3), l: 'Max price' };
  return (
    <div className="job">
      <div className="ph">
        <nav className="crumbs" aria-label="Breadcrumb"><span><Link to="/rankings#activity">Activity</Link><Icon name="chevR" size={13} /></span><span><Link to={j.kind === 'bounty' ? '/bounties' : `/models/${encodeURIComponent(j.model)}`}>{j.kind === 'bounty' ? 'Bounties' : j.model.split(':').slice(1).join(':')}</Link><Icon name="chevR" size={13} /></span></nav>
        <div className="ph-row">
          <div className="ph-title"><div>
            <h1>{j.title}</h1>
            <p><span className="mono-c">Job #{j.id}</span> · {j.kind === 'bounty' ? 'bug bounty' : 'inference'} · posted by {short(j.buyer)} {ago(j.created_ms, chainNow)} · {longDay(j.created_ms)} {hhmm(j.created_ms)} UTC{j.kind === 'compute' && <> · {j.units} unit{j.units === 1 ? '' : 's'}{j.always_check && ' · check paid for'}</>}</p>
          </div></div>
          <div className="ph-actions">
            {dl && <Tag tone="live"><Icon name="clock" size={13} />{dl[0]} {left > 0 ? clock(left) : 'now'}</Tag>}
            <Tag tone={v.tone === 'ok' ? 'ok' : v.tone === 'bad' ? 'bad' : v.tone === 'live' ? 'live' : 'dim'}>{v.text}</Tag>
          </div>
        </div>
      </div>
      <div className="kpis">
        <Kpi label={price.l} icon="coin" value={price.v} unit="NEAR" note={j.kind === 'bounty' ? `bond ${near(j.bond, 3)} NEAR` : `max ${near(j.max_price, 3)} NEAR`} />
        <Kpi label={j.kind === 'bounty' ? 'Sealed patches' : 'Sealed bids'} icon="envelope" value={j.kind === 'bounty' ? j.patches.length : j.bids.length} note={j.kind === 'bounty' ? `${j.patches.filter((p) => p.patch).length} revealed` : `${j.bids.filter((b) => b.price).length} revealed`} />
        <Kpi label="Nodes involved" icon="layers" value={nodes.length} note={`${nodes.filter((n) => n.slashed).length} slashed`} />
        {j.kind === 'compute'
          ? <Kpi label="Delivery" icon="zap" value={j.result?.delivered_ms ? `${((j.result.delivered_ms - (j.result.drawn_ms || j.reveal_end_ms)) / 1000).toFixed(1)}` : '—'} unit={j.result?.delivered_ms ? 's' : undefined} note="reveal close to deliver()" />
          : <Kpi label="Verifier votes" icon="shield" value={`${j.verifiers.filter((x) => x.voted_ms).length}/${j.verifiers.length}`} note="drawn by block seed" />}
      </div>
      {j.outcome && <p className={`outcome tone-${v.tone}`}><Icon name={v.tone === 'bad' ? 'x' : v.tone === 'ok' ? 'check' : 'clock'} size={16} />{j.outcome}</p>}
      <ol className="stages" aria-label="Job progress">
        {st.names.map((n, i) => <li key={n} className={i < st.at || st.at === 4 ? 'done' : i === st.at ? 'now' : ''}><i /><span>{n}</span></li>)}
      </ol>
      {j.kind === 'compute' ? <Compute j={j} now={chainNow} /> : <Bounty j={j} />}
      <Money j={j} />
    </div>
  );
}

function Compute({ j, now }: { j: Job; now: number }) {
  const revealedAll = j.status !== 'bidding' || now >= j.commit_end_ms;
  const spot = j.draws.find((d) => d.purpose === 'spot-check');
  return (
    <>
      <Sec id="bids" title="Sealed bids" meta={`${j.bids.length} committed · ${j.bids.filter((b) => b.price).length} revealed`}>
        {j.bids.length === 0 ? (
          <State kind="empty" title={j.status === 'bidding' ? 'Waiting for sealed bids' : 'No bids'}>{j.status === 'bidding' ? 'Staked nodes that serve this model commit a hash of their price. Prices stay hidden until the reveal window.' : 'Nobody bid; the escrow went back to the buyer.'}</State>
        ) : (
          <div className="envelopes">
            {j.bids.map((b) => {
              const won = j.winner_node === b.node;
              return (
                <div key={b.node} className={`env ${won ? 'won' : ''}`}>
                  <div className="env-top"><b>{short(b.owner)}</b>{won && <span className="lean lean-ok">Won</span>}</div>
                  <span className="hash">{b.commitment.slice(0, 22)}…</span>
                  {b.price ? <span className="env-price">{near(b.price, 4)} <small>NEAR</small></span> : <span className="sealed">{revealedAll && j.status !== 'bidding' ? 'never revealed' : 'sealed ●●●●'}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Sec>
      {(j.result || j.status === 'running') && (
        <Sec id="result" title="Result" meta={<>{j.winner ? `delivered by ${short(j.winner)}` : ''}{j.result?.hash && <> · sha256 {j.result.hash.slice(0, 12)}…</>}</>}>
          {j.result?.output ? <><div className={`paper paper-md ${j.status === 'faulted' ? 'paper-bad' : ''}`}><Md text={j.result.output} /></div><details className="prompt"><summary>Raw output as stored on-chain (sha256 {j.result.hash?.slice(0, 12)}…)</summary><div className="paper paper-dim">{j.result.output}</div></details></> : <State kind="loading" title="Running">The winning node is running {j.model}. Its output lands here when it calls deliver().</State>}
          <details className="prompt"><summary>Prompt sent to the node</summary><div className="paper paper-dim">{j.prompt}</div></details>
        </Sec>
      )}
      {spot && (
        <Sec id="check" title="Spot check" meta={spot.selected ? (j.always_check ? 'paid for by the buyer' : 'sampled by block seed') : 'not sampled'}>
          <div className="card checks-card">
            <p className="seed">block seed {spot.seed.slice(0, 24)}… · roll {spot.roll_bps} of 10000 · sampled when below {spot.threshold_bps}</p>
            {j.checks.map((c, i) => {
              const sim = c.similarity_bps;
              const bad = sim != null && sim < 3500;
              return (
                <div key={i} className="check">
                  <div className="check-row">
                    <span><span className="lbl">{i === 0 ? 'Checker' : 'Tiebreaker'}</span> <b>{short(c.owner)}</b></span>
                    <span className={`check-v ${bad ? 'bad' : ''}`}>{sim == null ? 'running…' : `${(sim / 100).toFixed(0)}%`}<small> match</small></span>
                  </div>
                  {sim != null && <Meter bps={sim} bad={bad} />}
                  {c.output && <details className="prompt"><summary>{short(c.owner)}'s re-run</summary><div className="paper paper-md"><Md text={c.output} /></div></details>}
                </div>
              );
            })}
            {j.checks.length > 0 && <p className="note">Similarity is the word-set overlap with the provider's output, computed on-chain. Two honest runs of the same prompt overlap; junk does not.</p>}
            {j.checks.length === 0 && <p className="note">The block seed of the delivery did not select this job, so nobody re-ran it.</p>}
          </div>
        </Sec>
      )}
    </>
  );
}

function Bounty({ j }: { j: Job }) {
  return (
    <>
      <div className="jgrid">
        <Sec id="bug" title="The bug" meta={j.repo_commit.slice(0, 10)}>
          <div className="card">
            <p className="body">{j.issue}</p>
            <p className="mono-line">{j.repo_url.replace(/^file:\/\/.*\/projects\//, 'file://…/')}</p>
            <p className="mono-line">$ {j.test_cmd}</p>
          </div>
        </Sec>
        <Sec id="test" title="Hidden test" meta={j.test_files ? 'revealed · hash matched' : 'hidden'}>
          <div className="card">
            <p className="mono-line">commitment {j.test_commit}</p>
            {j.test_files ? <details className="prompt" open><summary>Revealed test files</summary><div className="paper paper-dim">{j.test_files}</div></details>
              : <p className="note">Solvers can't see the test. The buyer reveals it after the solve window; the contract rejects any test whose hash differs.</p>}
          </div>
        </Sec>
      </div>
      <Sec id="result" title="Sealed patches" meta={`${j.patches.length} committed · earliest commit first`}>
        {j.patches.length === 0 ? <State kind="empty" title="No patches committed yet">Solver nodes commit a hash of their patch before the solve window closes.</State> : (
          <div className="patches">
            {j.patches.map((p, i) => (
              <div key={p.node} className={`env patch ${j.winning_patch === i ? 'won' : ''}`}>
                <div className="env-top">
                  <span><span className="lbl">Patch #{i}</span> <b>{short(p.owner)}</b></span>
                  <span className="env-tags">{p.majority === true && <span className="lean lean-ok">Pass majority</span>}{p.majority === false && <span className="lean lean-bad">Failed</span>}{j.winning_patch === i && <span className="lean lean-ok">Paid</span>}</span>
                </div>
                <span className="hash">{p.commitment}</span>
                {p.patch ? <details className="prompt" open={j.winning_patch === i}><summary>{p.patch.split('\n').length} lines revealed{p.majority != null ? ` · ${p.passes} pass / ${p.fails} fail` : ''}</summary><div className="paper paper-dim">{p.patch}</div></details> : <span className="sealed">sealed ●●●●</span>}
              </div>
            ))}
          </div>
        )}
      </Sec>
      {j.verifiers.length > 0 && (
        <Sec id="votes" title="Verifier votes" meta={`${j.verifiers.filter((v) => v.voted_ms).length} of ${j.verifiers.length} voted`}>
          <div className="card votes-card">
            <div className="votes-scroll">
              <table className="votes">
                <thead><tr><th>Verifier</th>{j.patches.map((_, i) => <th key={i}>Patch #{i}</th>)}<th>Verdict</th></tr></thead>
                <tbody>
                  {j.verifiers.map((v) => (
                    <tr key={v.node}>
                      <td><b>{short(v.owner)}</b></td>
                      {j.patches.map((p, i) => {
                        const vote = v.votes[i];
                        if (!vote) return <td key={i}><span className="cell">…</span></td>;
                        const lie = p.majority != null && vote.pass !== p.majority;
                        return <td key={i}><span className={`cell ${vote.pass ? 'pass' : 'fail'} ${lie ? 'lie' : ''}`} title={`log ${vote.log_hash}`}>{vote.pass ? 'PASS' : 'FAIL'}</span></td>;
                      })}
                      <td>{v.honest == null ? <span className="lean">pending</span> : v.honest ? <span className="lean lean-ok">Majority ✓</span> : <span className="lean lean-bad">Slashed ✕</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">Drawn from the staked verifier set by block seed; a patch's owner can't verify their own. Hover a cell for its log hash.</p>
          </div>
        </Sec>
      )}
    </>
  );
}

function Money({ j }: { j: Job }) {
  if (!j.payouts.length && !j.slashes.length) return null;
  return (
    <Sec id="money" title="Settlement" meta={`${j.payouts.length} payouts · ${j.slashes.length} slash${j.slashes.length === 1 ? '' : 'es'}`}>
      <dl className="receipt">
        {j.slashes.map((s, i) => (
          <div key={`s${i}`}><dt><a href={acctUrl(s.account)} target="_blank" rel="noreferrer">{short(s.account)}</a><small>{s.reason}</small></dt><dd className="neg">−{near(s.amount, 4)} NEAR</dd></div>
        ))}
        {j.payouts.map((p, i) => (
          <div key={`p${i}`}><dt><a href={acctUrl(p.account)} target="_blank" rel="noreferrer">{short(p.account)}</a><small>{p.reason}</small></dt><dd>+{near(p.amount, 4)} NEAR</dd></div>
        ))}
      </dl>
    </Sec>
  );
}
