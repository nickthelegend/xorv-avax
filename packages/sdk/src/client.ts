/**
 * The buyer side of Xorv in a few lines: offload one AI request to the network and pay for it with x402.
 *
 *   import { Xorv } from '@xorv/sdk';
 *   const xorv = new Xorv({ account: privateKeyToAccount(process.env.XORV_WALLET_KEY) });
 *   const r = await xorv.chat('Summarise this contract in three bullets', { verify: true });
 *   console.log(r.text, r.job, r.settlement);
 *
 * chat(): POST /v1/chat/completions -> HTTP 402 with the payment requirements -> one EIP-3009 signature for test
 * dollars (tUSD) on Avalanche Fuji -> the gateway settles it into the job's escrow on-chain -> staked nodes bid in a
 * sealed auction -> the answer comes back with its Fuji settlement. submit() returns as soon as the job is posted, so
 * a caller can follow the auction itself (followJob). Every failure throws an XorvError with the gateway's reason.
 * Works in Node 22+ and in browsers (only fetch and viem).
 */
import type { LocalAccount } from 'viem';
import { DEFAULT_MAX_TOKENS } from './pricing.ts';
import type { ChatMessage } from './prompt.ts';
import { encodePayment, signPayment, type PaymentRequirements } from './x402.ts';

export const XORV_GATEWAY = 'https://xorv-avax.vercel.app';
export const DEFAULT_MODEL = 'groq:openai/gpt-oss-20b';

export class XorvError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export interface AskOptions {
  /** model id from models(), default groq:openai/gpt-oss-20b */
  model?: string;
  /** the most tokens you will pay for (default 1200, at most 4096) */
  maxTokens?: number;
  /** force a spot check: a second staked node re-runs the prompt and the contract compares the two answers */
  verify?: boolean;
}

export interface Quote {
  model: string;
  /** micro-tUSD you sign for: the ceiling rate x max tokens plus two check fees. Unused escrow is refunded. */
  maxAmount: bigint;
  /** the buyer's ceiling, micro-tUSD per 1k tokens */
  maxRate: bigint;
  maxTokens: number;
  verify: boolean;
  /** what the model last cleared at on the Xorv Compute Index, micro-tUSD per 1k tokens (null before any clearing) */
  indexRate: bigint | null;
  /** staked nodes that serve the model, i.e. how many sealed bids to expect */
  nodes: number;
  requirements: PaymentRequirements;
}

export interface Answer {
  text: string;
  job: number;
  model: string;
  winner: string;
  bids: number;
  revealed: number;
  /** what the auction cleared at, micro-tUSD per 1k tokens */
  clearedRate: bigint;
  tokens: number;
  /** the x402 settlement transaction that funded the escrow and posted the job */
  settleTx: string;
  settlement: string;
  payer: string;
  paidMax: bigint;
}

export interface Posted {
  job: number;
  tx: string;
  explorer: string;
  /** micro-tUSD moved into escrow */
  value: bigint;
  payer: string;
  quote: Quote;
}

export interface ModelRow {
  id: string;
  name: string;
  nodes: number;
  indexRate: bigint | null;
}

type Body = { model: string; messages: ChatMessage[]; max_tokens: number; xorv: { verify: boolean } };

export class Xorv {
  readonly gateway: string;
  readonly account: LocalAccount | null;
  private f: typeof fetch;

  constructor(o: { gateway?: string; account?: LocalAccount | null; fetch?: typeof fetch } = {}) {
    this.gateway = (o.gateway ?? XORV_GATEWAY).replace(/\/+$/, '');
    this.account = o.account ?? null;
    this.f = o.fetch ?? ((...a) => fetch(...a));
  }

  private body(prompt: string | ChatMessage[], o: AskOptions = {}): Body {
    const messages = typeof prompt === 'string' ? [{ role: 'user' as const, content: prompt }] : prompt;
    return { model: o.model ?? DEFAULT_MODEL, messages, max_tokens: Math.min(o.maxTokens ?? DEFAULT_MAX_TOKENS, 4096), xorv: { verify: !!o.verify } };
  }

  private async req(path: string, init?: RequestInit): Promise<{ status: number; json: any; headers: Headers }> {
    let res: Response;
    try {
      res = await this.f(`${this.gateway}${path}`, init);
    } catch (e) {
      throw new XorvError(`the Xorv gateway at ${this.gateway} could not be reached (${(e as Error).message})`);
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  }

  private static reason(r: { status: number; json: any }) {
    return r.json?.error?.message ?? (typeof r.json?.error === 'string' ? r.json.error : null) ?? `HTTP ${r.status}`;
  }

  private signer() {
    if (!this.account) throw new XorvError('Setup required: pass an account (a viem LocalAccount holding Fuji test dollars) to pay for answers');
    return this.account;
  }

  /** Models staked nodes serve right now, with their last index price. */
  async models(): Promise<ModelRow[]> {
    const r = await this.req('/v1/models');
    if (r.status !== 200) throw new XorvError(Xorv.reason(r), r.status);
    return (r.json.data as any[]).map((m) => ({ id: m.id, name: m.name, nodes: m.nodes, indexRate: m.index_rate_per_1k != null ? BigInt(m.index_rate_per_1k) : null }));
  }

  /** What one request would cost at most, without paying: the x402 requirements plus the market's last price. */
  async quote(prompt: string | ChatMessage[], o: AskOptions = {}): Promise<Quote> {
    const body = this.body(prompt, o);
    const [r, models] = await Promise.all([this.req('/api/x402/requirements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), this.models()]);
    if (r.status !== 200) throw new XorvError(Xorv.reason(r), r.status);
    const req: PaymentRequirements = r.json.accepts[0];
    const m = models.find((x) => x.id === body.model);
    const job = req.extra.job as { maxRate: string; maxTokens: number };
    return { model: body.model, maxAmount: BigInt(req.maxAmountRequired), maxRate: BigInt(job.maxRate), maxTokens: job.maxTokens, verify: body.xorv.verify, indexRate: m?.indexRate ?? null, nodes: m?.nodes ?? 0, requirements: req };
  }

  /** 402 -> sign -> paid request. Returns the gateway's answer or throws its reason. */
  private async paid(path: string, body: Body, onSigned?: (from: string, req: PaymentRequirements) => void) {
    const account = this.signer();
    const init = (h: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    const first = await this.req(path, init());
    if (first.status !== 402) throw new XorvError(first.status === 200 ? 'the gateway answered without asking for payment' : Xorv.reason(first), first.status);
    const req: PaymentRequirements = first.json.accepts?.[0];
    if (!req) throw new XorvError('the 402 carried no payment requirements', 402);
    const payment = await signPayment(account, req);
    onSigned?.(account.address, req);
    const res = await this.req(path, init({ 'x-payment': encodePayment(payment) }));
    if (res.status !== 200) throw new XorvError(Xorv.reason(res), res.status);
    const receipt = res.headers.get('x-payment-response');
    const settle = receipt ? JSON.parse(typeof Buffer !== 'undefined' ? Buffer.from(receipt, 'base64').toString() : atob(receipt)) : null;
    return { res, req, settle, payer: account.address };
  }

  /** Pays and posts the job, returning as soon as it is on Fuji (the auction then runs on-chain; see followJob). */
  async submit(prompt: string | ChatMessage[], o: AskOptions & { onSigned?: (from: string, req: PaymentRequirements) => void } = {}): Promise<Posted> {
    const body = this.body(prompt, o);
    const quote = await this.quote(prompt, o);
    const { res, payer } = await this.paid('/api/chat', body, o.onSigned);
    return { job: res.json.job, tx: res.json.tx, explorer: res.json.explorer, value: BigInt(res.json.value), payer, quote };
  }

  /** Pays for one answer and waits for it (about 25-40 s: two auction windows, the model run and Fuji confirmations). */
  async chat(prompt: string | ChatMessage[], o: AskOptions = {}): Promise<Answer> {
    const body = this.body(prompt, o);
    const { res, req, settle, payer } = await this.paid('/v1/chat/completions', body);
    const out = res.json;
    return {
      text: out.choices[0].message.content,
      job: out.xorv.job,
      model: out.model,
      winner: out.xorv.winner,
      bids: out.xorv.bids,
      revealed: out.xorv.revealed,
      clearedRate: BigInt(out.xorv.cleared_rate_per_1k),
      tokens: out.usage.total_tokens,
      settleTx: settle?.transaction ?? out.xorv.settle_tx,
      settlement: out.xorv.explorer,
      payer,
      paidMax: BigInt(req.maxAmountRequired),
    };
  }

  /** One job as the gateway reads it from Fuji (status, bids, every event with its transaction). */
  async job(id: number): Promise<{ job: any; events: { event: string; tx: string; block: number; args: any }[] }> {
    const r = await this.req(`/api/jobs/${id}`);
    if (r.status !== 200) throw new XorvError(Xorv.reason(r), r.status);
    return r.json;
  }

  /** The Xorv Compute Index as JSON. */
  async index(): Promise<any> {
    const r = await this.req('/api/index');
    if (r.status !== 200) throw new XorvError(Xorv.reason(r), r.status);
    return r.json;
  }
}
