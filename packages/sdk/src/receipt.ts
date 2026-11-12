/**
 * Signed desk receipts for the eERC private credit lane.
 *
 * The desk keeps the private-credit ledger off-chain (the amounts are what eERC hides, so they cannot sit in a public
 * contract). To make that ledger checkable, the desk signs a receipt of every line it holds for a buyer, and the
 * buyer checks each line against Fuji:
 *   - the receipt is signed by the desk address in the deployment;
 *   - every top-up is a real EncryptedERC PrivateTransfer from the buyer to the desk, and its amount equals the
 *     amount the buyer's own proof moved (the sender's ElGamal ciphertext in the proof, decrypted with the buyer's
 *     eERC key; see `senderAmount`);
 *   - every PrivateTransfer from the buyer to the desk on-chain appears in the receipt (none dropped);
 *   - every private job was posted on-chain by the desk in that transaction, and each settled job's refund is
 *     its escrow minus the charge the market recorded;
 *   - the credit equals top-ups minus escrows plus refunds.
 * A desk that cheats is caught with its own signature as evidence; it is not prevented from cheating.
 */
import { decodeFunctionData, parseEventLogs, recoverMessageAddress, type Hex, type PublicClient } from 'viem';
import { encryptedErcAbi, xorvMarketAbi } from './abi.ts';
import type { Deployment } from './types.ts';
import type { XorvReader } from './reader.ts';

export interface DeskReceipt {
  desk: Hex;
  buyer: Hex;
  chainId: number;
  encryptedERC: Hex;
  credit: string;
  topups: { tx: Hex; amount: string }[];
  jobs: { job: number; escrow: string; settled: boolean; tx: Hex }[];
  issued: number;
}

export function receiptMessage(r: DeskReceipt): string {
  return [
    'Xorv desk receipt',
    `Desk: ${r.desk.toLowerCase()}`,
    `Buyer: ${r.buyer.toLowerCase()}`,
    `Chain: ${r.chainId}`,
    `EncryptedERC: ${r.encryptedERC.toLowerCase()}`,
    `Credit: ${r.credit}`,
    `Top-ups: ${r.topups.map((t) => `${t.tx.toLowerCase()}=${t.amount}`).join(',') || '-'}`,
    `Jobs: ${r.jobs.map((j) => `${j.job}:${j.tx.toLowerCase()}=${j.escrow}/${j.settled ? 'settled' : 'open'}`).join(',') || '-'}`,
    `Issued: ${r.issued}`,
  ].join('\n');
}

export interface ReceiptCheck { ok: boolean | null; label: string; detail?: string; tx?: Hex }

/** The sender's own amount of a transfer: the proof's sender ciphertext (public signals 6..9), as two points. */
export async function senderCiphertext(client: PublicClient, tx: Hex): Promise<{ c1: [bigint, bigint]; c2: [bigint, bigint] }> {
  const t = await client.getTransaction({ hash: tx });
  const call = decodeFunctionData({ abi: encryptedErcAbi, data: t.input });
  if (call.functionName !== 'transfer') throw new Error(`${tx} is not an eERC transfer`);
  const s = (call.args as any)[2].publicSignals as readonly bigint[];
  return { c1: [s[6], s[7]], c2: [s[8], s[9]] };
}

/**
 * Checks a receipt line by line. `senderAmount(tx, claimed)` answers whether the claimed amount is what the
 * buyer's proof moved (true/false), or null when the buyer's eERC key is not open in this session.
 */
export async function verifyReceipt(
  d: Deployment,
  reader: XorvReader,
  r: DeskReceipt,
  signature: Hex,
  me: Hex,
  senderAmount?: (tx: Hex, claimed: bigint) => Promise<boolean | null>,
): Promise<{ ok: boolean; checks: ReceiptCheck[] }> {
  const checks: ReceiptCheck[] = [];
  const e = d.eerc!;
  const desk = (e.desk ?? '').toLowerCase();
  const signer = await recoverMessageAddress({ message: receiptMessage(r), signature }).catch(() => null);
  checks.push({ ok: !!signer && signer.toLowerCase() === desk && r.desk.toLowerCase() === desk, label: 'Signed by the Xorv desk', detail: signer ?? 'bad signature' });
  checks.push({ ok: r.buyer.toLowerCase() === me.toLowerCase() && r.chainId === d.chainId && r.encryptedERC.toLowerCase() === e.encryptedERC.toLowerCase(), label: 'For this wallet, chain and eERC' });

  let total = 0n;
  for (const t of r.topups) {
    const rc = await reader.client.getTransactionReceipt({ hash: t.tx }).catch(() => null);
    const ev = rc ? parseEventLogs({ abi: encryptedErcAbi, logs: rc.logs, eventName: 'PrivateTransfer' }).find((l) => l.address.toLowerCase() === e.encryptedERC.toLowerCase() && (l.args as any).from.toLowerCase() === me.toLowerCase() && (l.args as any).to.toLowerCase() === desk) : undefined;
    let amountOk: boolean | null = null;
    if (ev && senderAmount) amountOk = await senderAmount(t.tx, BigInt(t.amount)).catch(() => false);
    checks.push({ ok: !ev ? false : amountOk, label: `Top-up of ${t.amount} micro-tUSD`, detail: !ev ? 'no encrypted transfer from you to the desk in this transaction' : amountOk === null ? 'transfer found on Fuji; open your eERC key to check the amount' : amountOk ? 'transfer found on Fuji; amount matches your proof' : 'amount does NOT match your proof', tx: t.tx });
    total += BigInt(t.amount);
  }

  const onChain = await reader.logs({ address: e.encryptedERC, abi: encryptedErcAbi, eventName: 'PrivateTransfer', args: { from: me, to: e.desk } as any, fromBlock: BigInt((d as any).startBlock ?? 0) }).catch(() => null);
  if (onChain) {
    const listed = new Set(r.topups.map((t) => t.tx.toLowerCase()));
    const missing = onChain.filter((l: any) => !listed.has(l.transactionHash.toLowerCase()));
    checks.push({ ok: missing.length === 0, label: 'Every top-up you sent the desk is listed', detail: missing.length ? `${missing.length} encrypted transfer(s) to the desk are not credited: ${missing.map((l: any) => l.transactionHash.slice(0, 10)).join(', ')}` : `${onChain.length} on Fuji, ${r.topups.length} in the receipt` });
  } else checks.push({ ok: null, label: 'Every top-up you sent the desk is listed', detail: 'could not read eERC events' });

  for (const j of r.jobs) {
    const rc = await reader.client.getTransactionReceipt({ hash: j.tx }).catch(() => null);
    const posted = rc ? parseEventLogs({ abi: xorvMarketAbi, logs: rc.logs, eventName: 'JobPosted' }).find((l) => l.address.toLowerCase() === d.contracts.market.toLowerCase() && Number((l.args as any).id) === j.job) : undefined;
    const job = await reader.job(j.job).catch(() => null);
    const byDesk = !!job && job.buyer.toLowerCase() === desk;
    total -= BigInt(j.escrow);
    let refundNote = '';
    if (j.settled && job) {
      total += BigInt(j.escrow) - job.charge;
      refundNote = ` · refund ${BigInt(j.escrow) - job.charge} after a charge of ${job.charge}`;
    }
    const closed = !!job && ['Done', 'Faulted', 'Expired'].includes(job.status);
    checks.push({ ok: !!posted && byDesk && (!j.settled || closed), label: `Private job #${j.job}, escrow ${j.escrow}`, detail: !posted ? 'no JobPosted for this job in that transaction' : !byDesk ? 'the job was not posted by the desk' : `posted by the desk on Fuji${refundNote}`, tx: j.tx });
  }
  checks.push({ ok: total === BigInt(r.credit), label: `Credit ${r.credit} = top-ups − escrows + refunds`, detail: total === BigInt(r.credit) ? 'adds up from the chain' : `the chain gives ${total}` });
  return { ok: checks.every((c) => c.ok !== false), checks };
}
