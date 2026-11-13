/**
 * Follow one job on Fuji as it happens, straight from the contracts (no gateway): sealed bids arriving, the reveal,
 * the winner, the delivered answer, the spot check and the settlement. Used by the `xorv` CLI to print each step live.
 */
import { xorvMarketAbi } from './abi.ts';
import type { XorvReader } from './reader.ts';
import type { Job } from './types.ts';

export type Step =
  | { kind: 'bids'; committed: number; nodes: number }
  | { kind: 'revealed'; rates: { label: string; rate: bigint }[] }
  | { kind: 'won'; label: string; rate: bigint }
  | { kind: 'delivered'; label: string; text: string; tokens: number; tx: string | null }
  | { kind: 'draw'; checked: boolean; label?: string }
  | { kind: 'check'; round: number; label: string; similarityBps: number; againstFirstBps: number; tx: string | null }
  | { kind: 'closed'; job: Job };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function followJob(r: XorvReader, id: number, onStep: (s: Step) => void, o: { pollMs?: number; timeoutMs?: number } = {}): Promise<Job> {
  const poll = o.pollMs ?? 1500;
  const t0 = Date.now();
  const providers = await r.providers();
  const label = (a: string) => providers.find((p) => [p.owner.toLowerCase(), p.node.toLowerCase()].includes(String(a).toLowerCase()))?.label ?? `${a.slice(0, 6)}…`;
  const live = providers.filter((p) => p.stake >= BigInt(r.d.config.minStake) && p.unbonding === 0n).length;
  let committed = -1;
  let revealedShown = false;
  let wonShown = false;
  let deliveredShown = false;
  let drawShown = false;
  let checksShown = 0;
  const logOf = async (eventName: string, args: Record<string, unknown>) => {
    for (let i = 0; i < 6; i++) {
      const logs = await r.recentLogs({ address: r.d.contracts.market, abi: xorvMarketAbi, eventName, args }, 300n).catch(() => []);
      if (logs.length) return logs as any[];
      await sleep(1200);
    }
    return [] as any[];
  };
  for (;;) {
    const j = await r.job(id).catch(() => null);
    if (j) {
      if (j.status === 'Bidding' && j.bidCount !== committed) {
        committed = j.bidCount;
        onStep({ kind: 'bids', committed, nodes: live });
      }
      if (!revealedShown && j.status !== 'Bidding') {
        if (committed !== j.bidCount) onStep({ kind: 'bids', committed: j.bidCount, nodes: live });
        const bids = await r.bids(id, j.bidCount);
        onStep({ kind: 'revealed', rates: bids.filter((b) => b.revealed).map((b) => ({ label: label(b.node), rate: b.rate })) });
        revealedShown = true;
      }
      if (!wonShown && j.winner && !/^0x0{40}$/.test(j.winner)) {
        onStep({ kind: 'won', label: label(j.winnerNode), rate: j.clearedRate });
        wonShown = true;
      }
      if (!deliveredShown && j.resultHash !== `0x${'0'.repeat(64)}`) {
        const [d] = await logOf('Delivered', { id: BigInt(id) });
        onStep({ kind: 'delivered', label: label(j.winnerNode), text: d?.args?.output ?? '(answer not in the recent logs yet)', tokens: j.tokens, tx: d?.transactionHash ?? null });
        deliveredShown = true;
      }
      if (deliveredShown && !drawShown && !['Delivered'].includes(j.status)) {
        const checks = await r.checks(id);
        onStep({ kind: 'draw', checked: checks.length > 0, label: checks[0] ? label(checks[0].node) : undefined });
        drawShown = true;
      }
      if (drawShown) {
        const checks = await r.checks(id);
        for (; checksShown < checks.length && checks[checksShown].delivered; checksShown++) {
          const [c] = (await logOf('CheckDelivered', { id: BigInt(id) })).filter((e) => Number(e.args.round) === checksShown);
          onStep({ kind: 'check', round: checksShown, label: label(checks[checksShown].node), similarityBps: checks[checksShown].similarityBps, againstFirstBps: Number(c?.args?.againstFirstBps ?? 0), tx: c?.transactionHash ?? null });
        }
      }
      if (['Done', 'Faulted', 'Expired'].includes(j.status)) {
        onStep({ kind: 'closed', job: j });
        return j;
      }
    }
    if (Date.now() - t0 > (o.timeoutMs ?? 300_000)) throw new Error(`job #${id} did not close within ${(o.timeoutMs ?? 300_000) / 1000} s`);
    await sleep(poll);
  }
}
