import { createPublicClient, http, keccak256, toBytes, type Hex, type PublicClient } from 'viem';
import { testDollarAbi, x402RouterAbi, xorvIndexAbi, xorvMarketAbi, xorvRegistryAbi } from './abi.ts';
import { chainFor } from './chain.ts';
import { OUTCOME, STATUS, type Bid, type Check, type Deployment, type Job, type Provider } from './types.ts';

export const modelId = (name: string): Hex => keccak256(toBytes(name));

export interface IndexObservation {
  timestamp: number;
  rate: bigint;
  indexRate: bigint;
  jobId: number;
  tokens: number;
  charge: bigint;
}

export interface IndexModel {
  id: Hex;
  name: string;
  rate: bigint;
  updatedAt: number;
  observations: number;
  twap1h: bigint | null;
  twap24h: bigint | null;
  vwap24h: { rate: bigint; tokens: bigint; usd: bigint; count: number };
}

export function toJob(id: number, r: any): Job {
  return {
    id,
    buyer: r.buyer,
    status: STATUS[Number(r.status)],
    outcome: OUTCOME[Number(r.outcome)],
    alwaysCheck: r.alwaysCheck,
    viaX402: r.viaX402,
    bidCount: Number(r.bidCount),
    revealed: Number(r.revealed),
    model: r.model,
    promptHash: r.promptHash,
    maxRate: r.maxRate,
    maxTokens: Number(r.maxTokens),
    workSecs: Number(r.workSecs),
    escrow: r.escrow,
    createdAt: Number(r.createdAt),
    commitEnd: Number(r.commitEnd),
    revealEnd: Number(r.revealEnd),
    deliverEnd: Number(r.deliverEnd),
    checkEnd: Number(r.checkEnd),
    closedAt: Number(r.closedAt),
    winner: r.winner,
    winnerNode: r.winnerNode,
    clearedRate: r.clearedRate,
    tokens: Number(r.tokens),
    charge: r.charge,
    resultHash: r.resultHash,
    drawBlock: r.drawBlock,
  };
}

/** Reads the live Xorv contracts. Every value comes from the chain; nothing is cached across calls. */
export class XorvReader {
  readonly client: PublicClient;
  readonly d: Deployment;
  constructor(d: Deployment, rpc?: string) {
    this.d = d;
    this.client = createPublicClient({ chain: chainFor(d.chainId, rpc ?? d.rpc), transport: http(rpc ?? d.rpc, { batch: { wait: 16 }, retryCount: 3, timeout: 20_000 }) }) as PublicClient;
  }

  private m = () => ({ address: this.d.contracts.market, abi: xorvMarketAbi }) as const;
  private reg = () => ({ address: this.d.contracts.registry, abi: xorvRegistryAbi }) as const;
  private idx = () => ({ address: this.d.contracts.index, abi: xorvIndexAbi }) as const;

  async jobCount(): Promise<number> {
    return Number(await this.client.readContract({ ...this.m(), functionName: 'jobCount' }));
  }

  async job(id: number): Promise<Job> {
    const r = await this.client.readContract({ ...this.m(), functionName: 'getJob', args: [BigInt(id)] });
    return toJob(id, r);
  }

  /** Newest first. */
  async jobs(limit = 25, before?: number): Promise<Job[]> {
    const n = before ?? (await this.jobCount());
    const ids = Array.from({ length: Math.min(limit, n) }, (_, i) => n - 1 - i);
    return Promise.all(ids.map((i) => this.job(i)));
  }

  async bids(id: number, count?: number): Promise<Bid[]> {
    const n = count ?? (await this.job(id)).bidCount;
    const rows = await Promise.all(Array.from({ length: n }, (_, i) => this.client.readContract({ ...this.m(), functionName: 'bids', args: [BigInt(id), BigInt(i)] })));
    return rows.map((r: any) => ({ owner: r[0], node: r[1], commitment: r[2], committedAt: Number(r[3]), rate: r[4], revealed: r[5] }));
  }

  async checks(id: number): Promise<Check[]> {
    const n = Number(await this.client.readContract({ ...this.m(), functionName: 'checkCount', args: [BigInt(id)] }));
    const rows = await Promise.all(Array.from({ length: n }, (_, i) => this.client.readContract({ ...this.m(), functionName: 'checks', args: [BigInt(id), BigInt(i)] })));
    return rows.map((r: any) => ({ owner: r[0], node: r[1], drawnAt: Number(r[2]), deliveredAt: Number(r[3]), outputHash: r[4], tokens: Number(r[5]), similarityBps: Number(r[6]), delivered: r[7] }));
  }

  async providers(): Promise<Provider[]> {
    const n = Number(await this.client.readContract({ ...this.reg(), functionName: 'providerCount' }));
    const owners = await Promise.all(Array.from({ length: n }, (_, i) => this.client.readContract({ ...this.reg(), functionName: 'providerList', args: [BigInt(i)] })));
    return Promise.all(owners.map((o) => this.provider(o as Hex))) as Promise<Provider[]>;
  }

  async provider(owner: Hex): Promise<Provider | null> {
    const p: any = await this.client.readContract({ ...this.reg(), functionName: 'getProvider', args: [owner] });
    if (/^0x0{40}$/.test(p.owner)) return null;
    return { ...p, active: Number(p.active), wins: Number(p.wins), bids: Number(p.bids), checks: Number(p.checks), slashes: Number(p.slashes) };
  }

  async ownerOfNode(node: Hex): Promise<Hex | null> {
    const o = (await this.client.readContract({ ...this.reg(), functionName: 'ownerOfNode', args: [node] })) as Hex;
    return /^0x0{40}$/.test(o) ? null : o;
  }

  async stats() {
    const [jobs, clearings, staked, paid, slashed, slashCount, escrow] = await Promise.all([
      this.jobCount(),
      this.client.readContract({ ...this.m(), functionName: 'clearings' }),
      this.client.readContract({ ...this.reg(), functionName: 'totalStaked' }),
      this.client.readContract({ ...this.reg(), functionName: 'paidTotal' }),
      this.client.readContract({ ...this.reg(), functionName: 'slashedTotal' }),
      this.client.readContract({ ...this.reg(), functionName: 'slashCount' }),
      this.client.readContract({ ...this.m(), functionName: 'totalEscrow' }),
    ]);
    return { jobs, clearings: Number(clearings), staked: staked as bigint, paid: paid as bigint, slashed: slashed as bigint, slashCount: Number(slashCount), escrow: escrow as bigint };
  }

  async escrowFor(maxRate: bigint, maxTokens: number): Promise<bigint> {
    return (await this.client.readContract({ ...this.m(), functionName: 'escrowFor', args: [maxRate, maxTokens] })) as bigint;
  }

  async tokenBalance(owner: Hex): Promise<bigint> {
    return (await this.client.readContract({ address: this.d.contracts.testDollar, abi: testDollarAbi, functionName: 'balanceOf', args: [owner] })) as bigint;
  }

  async authorizationUsed(from: Hex, nonce: Hex): Promise<boolean> {
    return (await this.client.readContract({ address: this.d.contracts.testDollar, abi: testDollarAbi, functionName: 'authorizationState', args: [from, nonce] })) as boolean;
  }

  // ------------------------------------------------------------------ the Xorv Compute Index

  async indexModels(): Promise<IndexModel[]> {
    const n = Number(await this.client.readContract({ ...this.idx(), functionName: 'modelCount' }));
    const ids = (await Promise.all(Array.from({ length: n }, (_, i) => this.client.readContract({ ...this.idx(), functionName: 'modelIds', args: [BigInt(i)] })))) as Hex[];
    return Promise.all(ids.map((id) => this.indexModel(id)));
  }

  async indexModel(id: Hex): Promise<IndexModel> {
    const [name, latest, vw] = await Promise.all([
      this.client.readContract({ ...this.idx(), functionName: 'nameOf', args: [id] }) as Promise<string>,
      this.client.readContract({ ...this.idx(), functionName: 'latest', args: [id] }) as Promise<readonly [bigint, bigint, bigint]>,
      this.client.readContract({ ...this.idx(), functionName: 'vwap', args: [id, 86_400n] }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
    ]);
    const twap = async (w: bigint) => (latest[2] > 0n ? ((await this.client.readContract({ ...this.idx(), functionName: 'twap', args: [id, w] })) as bigint) : null);
    const [twap1h, twap24h] = await Promise.all([twap(3600n), twap(86_400n)]);
    return { id, name, rate: latest[0], updatedAt: Number(latest[1]), observations: Number(latest[2]), twap1h, twap24h, vwap24h: { rate: vw[0], tokens: vw[1], usd: vw[2], count: Number(vw[3]) } };
  }

  async observations(id: Hex, from = 0, limit = 500): Promise<IndexObservation[]> {
    const rows = (await this.client.readContract({ ...this.idx(), functionName: 'observations', args: [id, BigInt(from), BigInt(limit)] })) as any[];
    return rows.map((o) => ({ timestamp: Number(o.timestamp), rate: o.rate, indexRate: o.indexRate, jobId: Number(o.jobId), tokens: Number(o.tokens), charge: o.charge }));
  }

  // ------------------------------------------------------------------ events

  /** Market events for one job (post, bids, delivery text, checks, payouts, close), oldest first. */
  async jobEvents(id: number, fromBlock?: bigint) {
    const from = fromBlock ?? BigInt((this.d as any).startBlock ?? 0);
    const logs = await this.getLogsChunked({ address: this.d.contracts.market, abi: xorvMarketAbi, args: { id: BigInt(id) }, fromBlock: from });
    const slashes = await this.getLogsChunked({ address: this.d.contracts.registry, abi: xorvRegistryAbi, eventName: 'Slashed', args: { jobId: BigInt(id) }, fromBlock: from });
    return [...logs, ...slashes].sort((a: any, b: any) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));
  }

  /** Fuji's public RPC caps eth_getLogs ranges, so long ranges are walked in 2,048-block chunks. */
  async getLogsChunked(q: any): Promise<any[]> {
    const latest = await this.client.getBlockNumber();
    const out: any[] = [];
    const step = 2048n;
    for (let a = BigInt(q.fromBlock ?? 0n); a <= latest; a += step) {
      const b = a + step - 1n > latest ? latest : a + step - 1n;
      out.push(...(await this.client.getContractEvents({ ...q, fromBlock: a, toBlock: b })));
    }
    return out;
  }

  routerAbi() {
    return x402RouterAbi;
  }
}
