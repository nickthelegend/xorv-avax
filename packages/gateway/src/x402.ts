/**
 * The gateway as x402 facilitator for Xorv on Fuji. Requirements name the X402Router as payTo and
 * tUSD as the asset. A paid request is verified off-chain, then settled on-chain with
 * X402Router.payAndPost, which funds the buyer's job escrow in the same transaction.
 */
import { parseEventLogs, type Hex } from 'viem';
import {
  DEFAULT_MAX_RATE,
  DEFAULT_MAX_TOKENS,
  NETWORK_FUJI,
  X402Error,
  XorvReader,
  decodePayment,
  routerAuthorization,
  txUrl,
  verifyPayment,
  x402RouterAbi,
  type Deployment,
  type PaymentPayload,
  type PaymentRequirements,
} from '@xorv/sdk';
import type { Wallet } from '@xorv/sdk/node';

export interface JobTerms {
  model: string;
  prompt: string;
  maxRate: bigint;
  maxTokens: number;
  alwaysCheck: boolean;
}

export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const WINDOWS = { commitSecs: 6, revealSecs: 6, workSecs: 90 };

export class Facilitator {
  private d: Deployment;
  private reader: XorvReader;
  private desk: Wallet | null;
  private publicUrl: string;
  constructor(d: Deployment, reader: XorvReader, desk: Wallet | null, publicUrl: string) {
    this.d = d;
    this.reader = reader;
    this.desk = desk;
    this.publicUrl = publicUrl;
  }

  networkName() {
    return this.d.chainId === 43113 ? NETWORK_FUJI : 'anvil-local';
  }

  async requirements(t: Pick<JobTerms, 'model' | 'maxRate' | 'maxTokens' | 'alwaysCheck'>, resource = '/v1/chat/completions'): Promise<PaymentRequirements> {
    const value = await this.reader.escrowFor(t.maxRate, t.maxTokens);
    return {
      scheme: 'exact',
      network: this.networkName(),
      maxAmountRequired: value.toString(),
      resource: `${this.publicUrl}${resource}`,
      description: `One sealed-bid auction for ${t.model}: up to ${t.maxTokens} tokens at most ${t.maxRate} micro-tUSD per 1k tokens, plus two spot-check fees. Unused escrow is refunded on-chain.`,
      mimeType: 'application/json',
      payTo: this.d.contracts.router,
      maxTimeoutSeconds: 300,
      asset: this.d.contracts.testDollar,
      extra: { name: 'Xorv Test Dollar', version: '1', chainId: this.d.chainId, job: { model: t.model, maxRate: t.maxRate.toString(), maxTokens: t.maxTokens, alwaysCheck: t.alwaysCheck, ...WINDOWS } },
    };
  }

  /** Reads model and limits from an OpenAI-style body plus Xorv extensions. */
  static terms(body: any, prompt: string): JobTerms {
    const maxTokens = Math.min(Number(body?.max_tokens ?? DEFAULT_MAX_TOKENS) || DEFAULT_MAX_TOKENS, 4096);
    const maxRate = BigInt(body?.xorv?.max_rate ?? DEFAULT_MAX_RATE);
    if (maxRate <= 0n || maxRate > 1_000_000n) throw new HttpError(400, 'xorv.max_rate must be 1 to 1,000,000 micro-tUSD per 1k tokens');
    return { model: String(body?.model ?? ''), prompt, maxRate, maxTokens, alwaysCheck: !!body?.xorv?.verify };
  }

  /** Verifies and settles. Returns the job id and the settlement transaction. */
  async settle(header: string, t: JobTerms): Promise<{ job: number; tx: Hex; payer: Hex; value: bigint }> {
    if (!this.desk) throw new HttpError(503, 'Setup required: XORV_DESK_KEY (the facilitator account that submits x402 settlements)', { setup: 'XORV_DESK_KEY' });
    let p: PaymentPayload;
    try {
      p = decodePayment(header);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const req = await this.requirements(t);
    try {
      await verifyPayment(p, req);
    } catch (e) {
      if (e instanceof X402Error) throw new HttpError(402, e.message, { x402: { x402Version: 1, error: e.message, accepts: [req] } });
      throw e;
    }
    const a = p.payload.authorization;
    if (await this.reader.authorizationUsed(a.from, a.nonce)) throw new HttpError(409, 'this payment authorization was already used (replay rejected)');
    const bal = await this.reader.tokenBalance(a.from);
    if (bal < BigInt(a.value)) throw new HttpError(402, `payer ${a.from} holds ${bal} micro-tUSD, the payment is ${a.value}. Use the tUSD faucet first.`, { x402: { x402Version: 1, error: 'insufficient_funds', accepts: [req] } });
    const params = { model: t.model, prompt: t.prompt, maxRate: t.maxRate, maxTokens: t.maxTokens, alwaysCheck: t.alwaysCheck, ...WINDOWS };
    const auth = routerAuthorization(p);
    const sim = await this.desk.simulateContract({ address: this.d.contracts.router, abi: x402RouterAbi, functionName: 'payAndPost', args: [params, auth], account: this.desk.account }).catch((e) => {
      throw new HttpError(402, `settlement would fail: ${e.shortMessage ?? e.message}`);
    });
    const hash = await this.desk.writeContract(sim.request as any);
    const r = await this.desk.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (r.status !== 'success') throw new HttpError(502, `settlement reverted: ${txUrl(hash, this.d.chainId)}`);
    const ev = parseEventLogs({ abi: x402RouterAbi, logs: r.logs, eventName: 'PaidAndPosted' })[0];
    if (!ev) throw new HttpError(502, `settlement emitted no PaidAndPosted event: ${txUrl(hash, this.d.chainId)}`);
    return { job: Number(ev.args.jobId), tx: hash, payer: a.from, value: BigInt(a.value) };
  }
}
