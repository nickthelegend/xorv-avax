/**
 * Check one Xorv job from the chain alone, without trusting the gateway or the nodes: every value below is read from
 * Avalanche Fuji (contract state and event logs) and recomputed locally.
 *
 *   prompt    keccak256 of the prompt in JobPosted equals the job's stored promptHash
 *   auction   the cleared rate is the lowest revealed sealed bid, and the winner is that bidder
 *   answer    keccak256 of the delivered text equals the job's resultHash
 *   check     for every re-run, the word-overlap score recomputed here equals the score the contract stored
 *   verdict   the outcome follows from those scores and the market's tolerance
 *   money     charge = cleared rate x tokens; every payout plus the refund adds up to the escrow the buyer paid
 *   slash     on a fault, the Slashed event moved the liar's stake to the buyer
 */
import { keccak256, toBytes } from 'viem';
import { txUrl } from './chain.ts';
import { similarityBps } from './similarity.ts';
import type { XorvReader } from './reader.ts';
import type { Job } from './types.ts';

export interface VerifyLine {
  key: 'prompt' | 'auction' | 'answer' | 'check' | 'verdict' | 'money' | 'slash';
  ok: boolean;
  text: string;
  tx?: string;
}

export interface Verified {
  job: Job;
  ok: boolean;
  lines: VerifyLine[];
  prompt: string | null;
  answer: string | null;
  labels: Map<string, string>;
  txs: { event: string; tx: string; url: string }[];
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export async function verifyJob(r: XorvReader, id: number): Promise<Verified> {
  const [job, ev, providers] = await Promise.all([r.job(id), r.jobEvents(id), r.providers()]);
  if (job.status === 'None') throw new Error(`job #${id} does not exist on this market`);
  const labels = new Map<string, string>();
  for (const p of providers) {
    labels.set(p.owner.toLowerCase(), p.label);
    labels.set(p.node.toLowerCase(), p.label);
  }
  const who = (a: string) => labels.get(String(a).toLowerCase()) ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
  const one = (name: string) => ev.find((e: any) => e.eventName === name) as any;
  const all = (name: string) => ev.filter((e: any) => e.eventName === name) as any[];
  const lines: VerifyLine[] = [];
  const tol = r.d.config.toleranceBps;

  const posted = one('JobPosted');
  const prompt: string | null = posted?.args.prompt ?? null;
  if (prompt !== null) {
    const ok = keccak256(toBytes(prompt)) === job.promptHash;
    lines.push({ key: 'prompt', ok, text: ok ? 'prompt on-chain matches its stored hash' : 'prompt does NOT match the stored promptHash', tx: posted.transactionHash });
  } else lines.push({ key: 'prompt', ok: false, text: 'JobPosted event not found' });

  const revealed = all('BidRevealed');
  const cleared = one('AuctionCleared');
  if (cleared) {
    const low = revealed.reduce((m: bigint | null, e: any) => (m === null || e.args.rate < m ? e.args.rate : m), null);
    const lowNodes = revealed.filter((e: any) => e.args.rate === low).map((e: any) => String(e.args.node).toLowerCase());
    const ok = low === cleared.args.rate && lowNodes.includes(String(cleared.args.node).toLowerCase());
    const ratesText = revealed.map((e: any) => `${who(e.args.node)} ${(Number(e.args.rate) / 1000).toFixed(3)}`).join(', ');
    lines.push({ key: 'auction', ok, text: `${all('BidCommitted').length} sealed bids, ${revealed.length} revealed ($/1M: ${ratesText}); lowest wins: ${who(cleared.args.node)}${ok ? '' : ' (MISMATCH)'}`, tx: cleared.transactionHash });
  } else lines.push({ key: 'auction', ok: job.status === 'Expired', text: job.status === 'Expired' ? 'no revealed bids; refunded' : 'auction not cleared yet' });

  const delivered = one('Delivered');
  const answer: string | null = delivered?.args.output ?? null;
  if (answer !== null) {
    const ok = keccak256(toBytes(answer)) === job.resultHash;
    lines.push({ key: 'answer', ok, text: ok ? `answer (${job.tokens} tokens) matches the hash stored at delivery` : 'answer does NOT match the stored resultHash', tx: delivered.transactionHash });
  }

  const checks = all('CheckDelivered');
  for (const c of checks) {
    const mine = answer !== null ? similarityBps(answer, c.args.output) : -1;
    const onChain = Number(c.args.similarityBps);
    const ok = mine === onChain;
    const role = Number(c.args.round) === 0 ? 'spot check' : 'tiebreak';
    const extra = Number(c.args.round) === 1 ? `, ${pct(Number(c.args.againstFirstBps))} with the first check` : '';
    lines.push({ key: 'check', ok, text: `${role} by ${who(c.args.node)}: ${pct(onChain)} word overlap with the answer${extra}; recomputed here: ${mine < 0 ? '?' : pct(mine)}`, tx: c.transactionHash });
  }

  const closed = one('JobClosed');
  if (closed) {
    let expect: string | null = null;
    const first = checks.find((c) => Number(c.args.round) === 0);
    const tie = checks.find((c) => Number(c.args.round) === 1);
    if (!first) expect = job.outcome;
    else if (Number(first.args.similarityBps) >= tol) expect = 'PaidCheckMatched';
    else if (tie) {
      const withAnswer = Number(tie.args.similarityBps) >= tol;
      const withCheck = Number(tie.args.againstFirstBps) >= tol;
      expect = withCheck && !withAnswer ? 'FaultedTiebreakSidedWithChecker' : withAnswer && !withCheck ? 'PaidTiebreakSidedWithProvider' : 'PaidTiebreakInconclusive';
    }
    const ok = expect === null || expect === job.outcome;
    lines.push({ key: 'verdict', ok, text: `${job.outcome} (${pct(tol)} overlap needed)${ok ? '' : `, expected ${expect}`}`, tx: closed.transactionHash });

    const payouts = all('Payout');
    const paid = payouts.reduce((s: bigint, e: any) => s + BigInt(e.args.amount), 0n);
    const escrow = posted ? BigInt(posted.args.escrow) : 0n;
    const charge = BigInt(closed.args.charge);
    const want = job.outcome.startsWith('Paid') ? (job.clearedRate * BigInt(job.tokens) + 999n) / 1000n : 0n;
    const chargeOk = charge === (want > escrow ? escrow : want);
    const fees = payouts.filter((e: any) => [2, 3].includes(Number(e.args.kind))).reduce((s: bigint, e: any) => s + BigInt(e.args.amount), 0n);
    const fmt = (m: bigint) => `$${(Number(m) / 1e6).toFixed(6)}`;
    lines.push({ key: 'money', ok: paid === escrow && chargeOk, text: `escrow ${fmt(escrow)} = charge ${fmt(charge)} + check fees ${fmt(fees)} + refund ${fmt(BigInt(closed.args.refund))}`, tx: closed.transactionHash });
  }

  // A lying (or silent) winner's slash goes to the buyer; a checker contradicted by the tiebreaker pays the winner.
  for (const s of all('Slashed')) {
    const owner = String(s.args.owner).toLowerCase();
    const isWinner = owner === job.winner.toLowerCase();
    const want = isWinner ? job.buyer : job.winner;
    const ok = String(s.args.to).toLowerCase() === want.toLowerCase();
    const whom = isWinner ? 'the buyer' : `${who(job.winner)}, the provider it contradicted`;
    lines.push({ key: 'slash', ok, text: `${who(s.args.owner)}${isWinner ? '' : ' (the checker)'} slashed $${(Number(s.args.amount) / 1e6).toFixed(2)} of stake, paid to ${ok ? whom : s.args.to}`, tx: s.transactionHash });
  }

  const seen = new Set<string>();
  const txs = ev.filter((e: any) => !seen.has(e.transactionHash) && seen.add(e.transactionHash)).map((e: any) => ({ event: e.eventName, tx: e.transactionHash, url: txUrl(e.transactionHash, r.d.chainId) }));
  return { job, ok: lines.every((l) => l.ok), lines, prompt, answer, labels, txs };
}
