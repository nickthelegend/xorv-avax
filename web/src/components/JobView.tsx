import type { ReactNode } from 'react';
import { STATUS, OUTCOME_TEXT } from '@xorv/sdk';
import { CLOSED, addrUrl, ago, clock, ev, ev1, money, nameOf, rate1m, short, txUrl, useNow, utc, verdict, type JobDetail, type Market } from '../lib/data';
import { Meter } from './Bits';
import { Md } from './MdLazy';
import { Icon, State } from './Ui';
import { Kpi, Tag } from './Shell';
import { Link } from '../lib/router';

const PAYOUT = ['', 'clearing price', 'check fee', 'tiebreak fee', 'refund to buyer'];
const SKIP = ['', 'no tokens were used', 'fewer than two revealed bids', 'the buyer won its own job'];

function Sec({ id, title, meta, children }: { id?: string; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="jsec" id={id} aria-label={title}>
      <header className="jsec-h"><h2>{title}</h2>{meta && <span className="jsec-meta">{meta}</span>}</header>
      {children}
    </section>
  );
}

export const TxL = ({ h }: { h?: string | null }) => (h ? <a href={txUrl(h)} target="_blank" rel="noreferrer" title={h} className="txl">{h.slice(0, 8)}… <Icon name="external" size={11} /></a> : null);

function stageAt(s: string, now: number, commitEnd: number) {
  if (s === 'Bidding') return now < commitEnd ? 0 : 1;
  if (s === 'Running') return 2;
  if (['Delivered', 'Checking', 'Mismatch', 'Tiebreak'].includes(s)) return 3;
  return 4;
}

export function JobView({ d, m }: { d: JobDetail; m: Market | null }) {
  const now = useNow(1000);
  const j = d.job;
  const v = verdict(j);
  const posted = ev1(d, 'JobPosted');
  const delivered = ev1(d, 'Delivered');
  const cleared = ev1(d, 'AuctionCleared');
  const closed = ev1(d, 'JobClosed');
  const at = stageAt(j.status, now, j.commitEnd);
  const dl: [string, number] | null = CLOSED.has(j.status) ? null : j.status === 'Bidding' ? (now < j.commitEnd ? ['Bids close', j.commitEnd] : ['Reveals close', j.revealEnd]) : j.status === 'Running' ? ['Delivery due', j.deliverEnd] : ['Checking', j.checkEnd || now];
  const latency = delivered?.timeStamp && cleared?.timeStamp ? delivered.timeStamp - cleared.timeStamp : null;
  return (
    <div className="job">
      <div className="ph">
        <nav className="crumbs" aria-label="Breadcrumb"><span><Link to="/rankings#activity">Activity</Link><Icon name="chevR" size={13} /></span><span><Link to={`/models/${encodeURIComponent(j.model)}`}>{j.model.split(':').slice(1).join(':')}</Link><Icon name="chevR" size={13} /></span></nav>
        <div className="ph-row">
          <div className="ph-title"><div>
            <h1>Job #{j.id}</h1>
            <p>{j.model} · posted by <a className="link" href={addrUrl(j.buyer)} target="_blank" rel="noreferrer">{nameOf(m, j.buyer)}</a> {ago(j.createdAt, now)} · {utc(j.createdAt)}{j.viaX402 && ' · paid with x402'}{j.alwaysCheck && ' · verification paid for'}</p>
          </div></div>
          <div className="ph-actions">
            {dl && <Tag tone="live"><Icon name="clock" size={13} />{dl[0]} {dl[1] > now ? clock(dl[1] - now) : 'now'}</Tag>}
            <Tag tone={v.tone}>{v.text}</Tag>
          </div>
        </div>
      </div>
      <div className="kpis">
        <Kpi label={j.clearedRate ? 'Cleared at' : 'Buyer ceiling'} icon="coin" value={rate1m(j.clearedRate || j.maxRate)} unit="/ 1M tokens" note={`ceiling ${rate1m(j.maxRate)} · ${j.maxTokens} tokens max`} />
        <Kpi label="Sealed bids" icon="envelope" value={j.bidCount} note={`${j.revealed} revealed`} />
        <Kpi label="Charged" icon="zap" value={j.charge ? money(j.charge) : '—'} note={`${j.tokens} tokens · escrow ${money(posted?.args.escrow ?? j.escrow)}`} />
        <Kpi label="Delivery" icon="clock" value={latency != null ? String(latency) : '—'} unit={latency != null ? 's' : undefined} note="auction close to deliver()" />
      </div>
      {j.outcome !== 'None' && <p className={`outcome tone-${v.tone === 'ok' ? 'ok' : v.tone === 'bad' ? 'bad' : 'dim'}`}><Icon name={v.tone === 'bad' ? 'x' : v.tone === 'ok' ? 'check' : 'clock'} size={16} />{OUTCOME_TEXT[j.outcome]}</p>}
      <ol className="stages" aria-label="Job progress">
        {['Sealed bids', 'Reveal', 'Run', 'Spot check', 'Settled'].map((n, i) => <li key={n} className={i < at || at === 4 ? 'done' : i === at ? 'now' : ''}><i /><span>{n}</span></li>)}
      </ol>

      <Sec id="bids" title="Sealed bids" meta={`${j.bidCount} committed · ${j.revealed} revealed · lowest rate wins`}>
        {d.bids.length === 0 ? (
          <State kind="empty" art="envelope" title={j.status === 'Bidding' ? 'Waiting for sealed bids' : 'No bids'}>{j.status === 'Bidding' ? 'Staked nodes that serve this model commit a hash of their rate. Rates stay hidden until the reveal window.' : 'Nobody bid; the escrow went back to the buyer.'}</State>
        ) : (
          <div className="envelopes">
            {d.bids.map((b) => {
              const won = j.winnerNode.toLowerCase() === b.node.toLowerCase();
              const c = ev(d, 'BidCommitted').find((e) => e.args.node.toLowerCase() === b.node.toLowerCase());
              const r = ev(d, 'BidRevealed').find((e) => e.args.node.toLowerCase() === b.node.toLowerCase());
              return (
                <div key={b.node} className={`env ${won ? 'won' : ''}`}>
                  <div className="env-top"><b>{nameOf(m, b.owner)}</b>{won && <span className="lean lean-ok">Won</span>}</div>
                  <span className="hash">{b.commitment.slice(0, 22)}… <TxL h={c?.transactionHash} /></span>
                  {b.revealed ? <span className="env-price">{rate1m(b.rate)} <small>/ 1M</small> <TxL h={r?.transactionHash} /></span> : <span className="sealed">{j.status === 'Bidding' ? 'sealed ●●●●' : 'never revealed'}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Sec>

      <Sec id="result" title="Prompt and answer" meta={delivered ? <>delivered by {nameOf(m, j.winner)} · keccak {j.resultHash.slice(0, 12)}… <TxL h={delivered.transactionHash} /></> : posted ? 'prompt from the JobPosted event' : undefined}>
        {posted ? <div className="paper paper-dim prompt-box">{posted.args.prompt}</div> : <p className="note">The prompt is in the JobPosted event; the indexer has not returned it yet.</p>}
        {delivered ? <div className={`paper paper-md ${j.status === 'Faulted' ? 'paper-bad' : ''}`} style={{ marginTop: 10 }}><Md text={delivered.args.output} /></div>
          : j.status === 'Running' ? <div style={{ marginTop: 10 }}><State kind="loading" title="Running">{nameOf(m, j.winner)} is running {j.model}. The answer lands here when it calls deliver().</State></div> : null}
      </Sec>

      {(ev(d, 'DrawResolved').length > 0 || d.checks.length > 0) && (
        <Sec id="check" title="Spot check" meta={j.alwaysCheck ? 'paid for by the buyer' : 'sampled from the delivery block hash'}>
          <div className="card checks-card">
            {ev(d, 'DrawResolved').map((e) => (
              <p className="seed" key={e.transactionHash + e.args.purpose}>{Number(e.args.purpose) === 0 ? `Spot-check draw: roll ${e.args.rollBps} of 10000, sampled below ${e.args.thresholdBps}: ${e.args.selected ? 'sampled' : 'not sampled'}` : 'Tiebreaker draw'}{e.args.selected && Number(e.args.pool) > 0 ? ` · ${nameOf(m, e.args.picked)} picked from ${e.args.pool} eligible` : ''} · seed {String(e.args.seed).slice(0, 18)}… <TxL h={e.transactionHash} /></p>
            ))}
            {d.checks.map((c, i) => {
              const e = ev(d, 'CheckDelivered').find((x) => Number(x.args.round) === i);
              const sim = c.delivered ? c.similarityBps : null;
              const bad = sim != null && sim < Number(m?.config.toleranceBps ?? 5000);
              return (
                <div key={i} className="check">
                  <div className="check-row">
                    <span><span className="lbl">{i === 0 ? 'Checker' : 'Tiebreaker'}</span> <b>{nameOf(m, c.owner)}</b> <TxL h={e?.transactionHash} /></span>
                    <span className={`check-v ${bad ? 'bad' : ''}`}>{sim == null ? 're-running…' : `${(sim / 100).toFixed(0)}%`}<small> match{i === 1 && e ? ` · ${(Number(e.args.againstFirstBps) / 100).toFixed(0)}% with checker` : ''}</small></span>
                  </div>
                  {sim != null && <Meter bps={sim} threshold={Number(m?.config.toleranceBps ?? 5000)} bad={bad} />}
                  {e?.args.output && <details className="prompt"><summary>{nameOf(m, c.owner)}'s re-run</summary><div className="paper paper-md"><Md text={e.args.output} /></div></details>}
                </div>
              );
            })}
            <p className="note">The market contract computes the word-set overlap itself. A match needs {Number(m?.config.toleranceBps ?? 5000) / 100}%. Whoever the tiebreaker contradicts is slashed.</p>
          </div>
        </Sec>
      )}

      {(ev(d, 'Payout').length > 0 || ev(d, 'Slashed').length > 0) && (
        <Sec id="money" title="Settlement" meta={closed ? <>closed {utc(Number(closed.timeStamp ?? j.closedAt))} <TxL h={closed.transactionHash} /></> : undefined}>
          <dl className="receipt">
            {ev(d, 'Slashed').map((s, i) => <div key={`s${i}`}><dt><a href={addrUrl(s.args.owner)} target="_blank" rel="noreferrer">{nameOf(m, s.args.owner)}</a><small>slashed: {s.args.reason} → {nameOf(m, s.args.to)}</small></dt><dd className="neg">−{money(s.args.amount, 2)}</dd></div>)}
            {ev(d, 'Payout').map((p, i) => <div key={`p${i}`}><dt><a href={addrUrl(p.args.to)} target="_blank" rel="noreferrer">{nameOf(m, p.args.to)}</a><small>{PAYOUT[Number(p.args.kind)] ?? 'payout'}</small></dt><dd>+{money(p.args.amount)}</dd></div>)}
          </dl>
          <p className="note" style={{ marginTop: 8 }}>
            {d.index ? <>Recorded in the Compute Index at {rate1m(d.index.args.indexRate)} / 1M <TxL h={d.index.transactionHash} /></> : ev1(d, 'IndexSkipped') ? <>Not indexed: {SKIP[Number(ev1(d, 'IndexSkipped').args.reason)]}.</> : j.status === 'Faulted' || j.status === 'Expired' ? 'Not indexed: no paid delivery.' : null}
          </p>
        </Sec>
      )}

      <Sec id="txs" title="Transactions" meta={`${new Set(d.events.map((e) => e.transactionHash)).size} on Avalanche Fuji`}>
        <div className="card card-pad txs">
          {d.x402 && <a href={txUrl(d.x402.transactionHash)} target="_blank" rel="noreferrer"><span>{short(d.x402.args.facilitator)}</span><b>x402 settled: {money(d.x402.args.value)} from {short(d.x402.args.buyer)}</b><em>{d.x402.transactionHash.slice(0, 10)}… <Icon name="external" size={11} /></em></a>}
          {d.events.filter((e, i, a) => a.findIndex((x) => x.transactionHash === e.transactionHash) === i && !(d.x402 && e.transactionHash === d.x402.transactionHash)).map((e) => (
            <a key={e.transactionHash} href={txUrl(e.transactionHash)} target="_blank" rel="noreferrer"><span>{nameOf(m, e.args.node ?? e.args.buyer ?? e.args.owner ?? e.args.to ?? '')}</span><b>{e.eventName}</b><em>{e.transactionHash.slice(0, 10)}… <Icon name="external" size={11} /></em></a>
          ))}
          {!d.events.length && <p className="note">The Snowtrace indexer has not returned this job's events yet. They appear within a few seconds.</p>}
        </div>
      </Sec>
      <p className="note" style={{ marginTop: 12 }}>Status {STATUS.indexOf(j.status)} · {j.status}. Everything above is read from the XorvMarket, XorvRegistry, XorvIndex and X402Router contracts and their events.</p>
    </div>
  );
}
