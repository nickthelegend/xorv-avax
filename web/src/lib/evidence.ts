// Recorded testnet evidence (real transaction hashes), bundled at build time from deployments/.
import deploy from '../../../../deployments/testnet-2026-11-09.json';
import run from '../../../../deployments/testnet-run-2026-11-09.json';
import quotes from '../../../../deployments/oneclick-dry-2026-11-09.json';

export const dryQuotes = (quotes as any).quotes as { direction: string; from: string; to: string; correlationId: string; timestamp: string }[];

export interface TxRow { at?: string; who: string; what: string; hash: string; job?: number }

export const deployment = deploy as any;
export const runEvidence = run as any;

export function recordedTxs(): TxRow[] {
  const nodeTxs: TxRow[] = (runEvidence.nodeTxs ?? []).map((e: any) => ({ at: e.at, who: String(e.node).replace(/\.xorv-[a-z0-9]+\.testnet$/, ''), what: e.event, hash: e.tx, job: e.job }));
  const posts: TxRow[] = Object.entries(runEvidence.jobs ?? {}).map(([k, j]: [string, any]) => ({ who: 'buyer', what: `post job #${j.id} (${k === 'C' ? 'bounty' : 'compute'})`, hash: j.postTx, job: j.id }));
  const reveals: TxRow[] = Object.values(runEvidence.jobs ?? {}).filter((j: any) => j.revealTestTx).map((j: any) => ({ who: 'buyer', what: `reveal_test (hash matched)`, hash: j.revealTestTx, job: j.id }));
  return [...posts, ...reveals, ...nodeTxs];
}
