/**
 * The eERC private credit lane.
 *
 * A buyer converts tUSD into an encrypted eERC balance, then tops up the Xorv desk with a private
 * transfer: on-chain the amount is a ciphertext only the desk and the auditor can read. The desk
 * decrypts each top-up (it is the receiver), credits the buyer in a ledger this gateway keeps, and
 * posts the buyer's chats as its own jobs, so the public job record does not name the buyer.
 *
 * Attribution: eERC numbers every balance change of an account (transactionIndex). The desk walks its
 * own eERC events in chain order to learn which sender each pending amount PCT came from, and records
 * them before it ever spends (spending clears pending PCTs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import { hashMessage, parseEventLogs, recoverMessageAddress, type Hex } from 'viem';
import { chatMessage, creditMessage, receiptMessage, requestHash, type DeskReceipt, encryptedErcAbi, packPrompt, txUrl, xorvMarketAbi, testDollarAbi, type Deployment, type XorvReader } from '@xorv/sdk';
import { ROOT, type Wallet } from '@xorv/sdk/node';
import { Eerc, decryptPCT } from '@xorv/eerc';
import { Facilitator, HttpError, WINDOWS } from './x402.ts';

interface Ledger {
  /** transactionIndex -> credited top-up */
  topups: Record<string, { from: Hex; amount: string; tx: Hex; block: number }>;
  credit: Record<string, string>;
  jobs: Record<string, { buyer: Hex; escrow: string; settled: boolean; tx: Hex }>;
  nonces: Record<string, true>;
}


export class PrivateLane {
  readonly d: Deployment;
  readonly reader: XorvReader;
  readonly desk: Wallet | null;
  readonly facilitator: Facilitator;
  private eerc: Eerc | null = null;
  private ledgerFile: string;
  private ledger: Ledger;
  private syncing: Promise<void> | null = null;

  constructor(d: Deployment, reader: XorvReader, desk: Wallet | null, facilitator: Facilitator) {
    this.d = d;
    this.reader = reader;
    this.desk = desk;
    this.facilitator = facilitator;
    this.ledgerFile = path.join(ROOT, process.env.XORV_GATEWAY_STATE ?? '.xorv/gateway', `private-ledger-${d.chainId}-${d.eerc?.encryptedERC.slice(2, 10) ?? 'none'}.json`);
    mkdirSync(path.dirname(this.ledgerFile), { recursive: true });
    this.ledger = existsSync(this.ledgerFile) ? JSON.parse(readFileSync(this.ledgerFile, 'utf8')) : { topups: {}, credit: {}, jobs: {}, nonces: {} };
  }

  private save() {
    writeFileSync(this.ledgerFile, JSON.stringify(this.ledger, null, 2));
  }

  private async lane(): Promise<Eerc> {
    if (!this.d.eerc) throw new HttpError(503, 'Setup required: this deployment has no eERC contracts');
    if (!this.desk) throw new HttpError(503, 'Setup required: XORV_DESK_KEY');
    if (!this.eerc) this.eerc = await new Eerc(this.d, this.desk).init();
    if (!(await this.eerc.isRegistered())) throw new HttpError(503, 'Setup required: the desk has not registered with eERC (run node scripts/private-lane.ts)');
    return this.eerc;
  }

  /** Reads every eERC event that changed the desk's balance and credits new top-ups to their senders. */
  async sync() {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const e = await this.lane();
      const desk = e.address;
      const from = BigInt((this.d as any).startBlock ?? 0);
      const q = async (eventName: string, args: Record<string, Hex>) => this.reader.logs({ address: this.d.eerc!.encryptedERC, abi: encryptedErcAbi, eventName, args, fromBlock: from });
      const [inT, outT, dep, wd] = await Promise.all([q('PrivateTransfer', { to: desk }), q('PrivateTransfer', { from: desk }), q('Deposit', { user: desk }), q('Withdraw', { user: desk })]);
      const all = [...inT.map((l) => ({ l, incoming: true })), ...outT.map((l) => ({ l, incoming: false })), ...dep.map((l) => ({ l, incoming: true, deposit: true })), ...wd.map((l) => ({ l, incoming: false }))]
        .sort((a: any, b: any) => (a.l.blockNumber === b.l.blockNumber ? a.l.logIndex - b.l.logIndex : Number(a.l.blockNumber - b.l.blockNumber)));
      const tokenId = await e.tokenId();
      const [, , amountPCTs] = (await e.w.readContract({ address: this.d.eerc!.encryptedERC, abi: encryptedErcAbi, functionName: 'balanceOf', args: [desk, tokenId] })) as any;
      const pending = new Map<string, readonly bigint[]>(amountPCTs.map((a: any) => [String(a.index), a.pct]));
      all.forEach((x: any, i) => {
        const idx = String(i);
        if (!x.incoming || x.deposit || this.ledger.topups[idx]) return;
        const pct = pending.get(idx);
        if (!pct) return; // already spent before this ledger existed; cannot be attributed
        const amount = decryptPCT(e.key.privateKey, pct)[0];
        const sender = (x.l.args.from as Hex).toLowerCase() as Hex;
        this.ledger.topups[idx] = { from: sender, amount: amount.toString(), tx: x.l.transactionHash, block: Number(x.l.blockNumber) };
        this.ledger.credit[sender] = (BigInt(this.ledger.credit[sender] ?? '0') + amount).toString();
      });
      this.save();
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** Every ledger line the desk holds for one buyer, signed by the desk so the buyer can check it on Fuji. */
  private async receipt(a: Hex): Promise<{ receipt: DeskReceipt; signature: Hex }> {
    const desk = this.desk!;
    const receipt: DeskReceipt = {
      desk: desk.account.address,
      buyer: a,
      chainId: this.d.chainId,
      encryptedERC: this.d.eerc!.encryptedERC,
      credit: this.ledger.credit[a] ?? '0',
      topups: Object.values(this.ledger.topups).filter((t) => t.from === a).sort((x, y) => x.block - y.block).map((t) => ({ tx: t.tx, amount: t.amount })),
      jobs: Object.entries(this.ledger.jobs).filter(([, j]) => j.buyer === a).map(([id, j]) => ({ job: Number(id), escrow: j.escrow, settled: j.settled, tx: j.tx })).sort((x, y) => x.job - y.job),
      issued: Math.floor(Date.now() / 1000),
    };
    return { receipt, signature: await desk.account.signMessage!({ message: receiptMessage(receipt) }) };
  }

  /** Returns unused escrow of closed private jobs to the buyer's credit. */
  private async settleJobs() {
    for (const [id, j] of Object.entries(this.ledger.jobs)) {
      if (j.settled) continue;
      const job = await this.reader.job(Number(id));
      if (!['Done', 'Faulted', 'Expired'].includes(job.status)) continue;
      const refund = BigInt(j.escrow) - job.charge;
      this.ledger.credit[j.buyer] = (BigInt(this.ledger.credit[j.buyer] ?? '0') + refund).toString();
      j.settled = true;
    }
    this.save();
  }

  private async verify(message: string, signature: Hex, address: Hex, ts: number) {
    if (Math.abs(Date.now() / 1000 - ts) > 300) throw new HttpError(401, 'signature timestamp is more than 5 minutes off');
    const signer = await recoverMessageAddress({ message, signature }).catch(() => null);
    if (!signer || signer.toLowerCase() !== address.toLowerCase()) throw new HttpError(401, 'signature does not match the account');
    const n = hashMessage(message);
    if (this.ledger.nonces[n]) throw new HttpError(409, 'this signed request was already used');
    return n;
  }

  async route(method: string, p: string, body: any, _headers: IncomingHttpHeaders): Promise<[number, unknown]> {
    if (method === 'GET' && p === '/api/private/status') {
      if (!this.d.eerc) return [200, { enabled: false, reason: 'no eERC contracts in this deployment' }];
      const ready = await this.lane().then(() => true).catch((e) => e.message as string);
      return [200, { enabled: ready === true, setup: ready === true ? null : ready, encryptedERC: this.d.eerc.encryptedERC, registrar: this.d.eerc.registrar, desk: this.desk?.account.address ?? null, auditor: this.d.eerc.auditor ?? null, privateJobs: Object.keys(this.ledger.jobs).length, attributedTopups: Object.keys(this.ledger.topups).length }];
    }
    if (method === 'POST' && p === '/api/private/credit') {
      const { address, ts, signature } = body ?? {};
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(address))) throw new HttpError(400, 'address is required');
      await this.verify(creditMessage(address, Number(ts)), signature, address, Number(ts));
      await this.sync();
      await this.settleJobs();
      const a = String(address).toLowerCase();
      const topups = Object.values(this.ledger.topups).filter((t) => t.from === a);
      const jobs = Object.entries(this.ledger.jobs).filter(([, j]) => j.buyer === a).map(([id, j]) => ({ job: Number(id), escrow: j.escrow, settled: j.settled, tx: j.tx }));
      return [200, { address: a, credit: this.ledger.credit[a] ?? '0', topups, jobs, ...(await this.receipt(a as Hex)) }];
    }
    if (method === 'POST' && p === '/api/private/chat') {
      const { address, ts, signature, request } = body ?? {};
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(address))) throw new HttpError(400, 'address is required');
      const bodyHash = requestHash(request ?? {});
      const nonce = await this.verify(chatMessage(address, Number(ts), bodyHash), signature, address, Number(ts));
      let prompt: string;
      try {
        prompt = packPrompt(request?.messages ?? []);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const t = Facilitator.terms(request, prompt);
      await this.sync();
      await this.settleJobs();
      const a = String(address).toLowerCase() as Hex;
      const escrow = await this.reader.escrowFor(t.maxRate, t.maxTokens);
      const credit = BigInt(this.ledger.credit[a] ?? '0');
      if (credit < escrow) throw new HttpError(402, `private credit ${credit} micro-tUSD is below this request's escrow ${escrow}; top up the desk with a private eERC transfer first`);
      const desk = this.desk!;
      const pub = await this.reader.tokenBalance(desk.account.address);
      if (pub < escrow) throw new HttpError(503, 'the desk needs public tUSD for escrow; it withdraws from eERC to refill');
      const allowance = (await desk.readContract({ address: this.d.contracts.testDollar, abi: testDollarAbi, functionName: 'allowance', args: [desk.account.address, this.d.contracts.market] })) as bigint;
      if (allowance < escrow) await desk.waitForTransactionReceipt({ hash: await desk.writeContract({ address: this.d.contracts.testDollar, abi: testDollarAbi, functionName: 'approve', args: [this.d.contracts.market, 2n ** 255n], account: desk.account, chain: desk.chain }) });
      this.ledger.nonces[nonce] = true;
      this.ledger.credit[a] = (credit - escrow).toString();
      this.save();
      const params = { model: t.model, prompt: t.prompt, maxRate: t.maxRate, maxTokens: t.maxTokens, alwaysCheck: t.alwaysCheck, ...WINDOWS };
      try {
        const sim = await desk.simulateContract({ address: this.d.contracts.market, abi: xorvMarketAbi, functionName: 'postJob', args: [params], account: desk.account });
        const gas = await desk.estimateContractGas({ address: this.d.contracts.market, abi: xorvMarketAbi, functionName: 'postJob', args: [params], account: desk.account });
        const hash = await desk.writeContract({ ...(sim.request as any), gas: (gas * 14n) / 10n });
        const r = await desk.waitForTransactionReceipt({ hash });
        if (r.status !== 'success') throw new Error(`postJob reverted ${hash}`);
        const ev = parseEventLogs({ abi: xorvMarketAbi, logs: r.logs, eventName: 'JobPosted' })[0];
        const id = Number(ev.args.id);
        this.ledger.jobs[String(id)] = { buyer: a, escrow: escrow.toString(), settled: false, tx: hash };
        this.save();
        return [200, { job: id, tx: hash, explorer: txUrl(hash, this.d.chainId), escrow: escrow.toString(), creditLeft: this.ledger.credit[a], postedBy: desk.account.address, ...(await this.receipt(a)) }];
      } catch (e) {
        this.ledger.credit[a] = credit.toString();
        this.save();
        throw new HttpError(502, `the desk could not post the job: ${(e as any).shortMessage ?? (e as Error).message}`);
      }
    }
    throw new HttpError(404, `no route ${method} ${p}`);
  }
}
