/**
 * The provider node loop. It acts only with the node key (bid, reveal, deliver, check, resolve, advance);
 * stake and earnings stay with the owner key, which this process never loads.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createWalletClient, http, publicActions, type Hex } from 'viem';
import { privateKeyToAccount, nonceManager } from 'viem/accounts';
import { XorvReader, bidCommitment, chainFor, newSalt, similarityBps, xorvMarketAbi, type Deployment, type Job } from '@xorv/sdk';
import { runModel, vendorOf, TERMS, type RunResult } from './providers.ts';

export type Fault = 'none' | 'deliver' | 'check';

export interface NodeOptions {
  deployment: Deployment;
  rpc?: string;
  nodeKey: Hex;
  label: string;
  models: string[];
  /** micro-dollars per 1k tokens this node pays for each model upstream */
  cost: Record<string, number>;
  /** ask = cost x margin, before load and jitter */
  margin: number;
  stateDir: string;
  fault: Fault;
  keeper: boolean;
  pollMs: number;
  once?: boolean;
}

interface State {
  bids: Record<string, { rate: string; salt: Hex }>;
  done: Record<string, true>;
}

const JUNK = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. (xorv fault injection: this node returns junk on purpose)';
const CLOSED = new Set(['Done', 'Faulted', 'Expired']);

export async function startNode(o: NodeOptions) {
  const d = o.deployment;
  const url = o.rpc ?? d.rpc;
  const account = privateKeyToAccount(o.nodeKey, { nonceManager });
  const me = account.address;
  const w = createWalletClient({ account, chain: chainFor(d.chainId, url), transport: http(url, { retryCount: 3, timeout: 30_000 }) }).extend(publicActions);
  const reader = new XorvReader(d, url);
  const owner = await reader.ownerOfNode(me);
  if (!owner) throw new Error(`${me} is not a registered node on ${d.contracts.registry}; run node scripts/setup-providers.ts first`);
  const profile = await reader.provider(owner);
  if (!o.models.length) o.models = [...(profile?.models ?? [])];

  mkdirSync(o.stateDir, { recursive: true });
  const stateFile = path.join(o.stateDir, `node.${o.label}.json`);
  const logFile = path.join(o.stateDir, `node.${o.label}.events.jsonl`);
  const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { bids: {}, done: {} };
  const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const log = (event: string, data: Record<string, unknown> = {}) => {
    const line = { at: new Date().toISOString(), node: o.label, address: me, event, ...data };
    appendFileSync(logFile, `${JSON.stringify(line)}\n`);
    console.log(`[${o.label}] ${event} ${Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')}`);
  };

  // One transaction at a time per node key; nonces come from viem's nonce manager.
  let queue: Promise<unknown> = Promise.resolve();
  const tx = (functionName: string, args: unknown[], label: string, data: Record<string, unknown> = {}) => {
    const run = queue.then(async () => {
      const hash = await w.writeContract({ address: d.contracts.market, abi: xorvMarketAbi, functionName: functionName as any, args: args as any, account, chain: w.chain });
      const r = await w.waitForTransactionReceipt({ hash, timeout: 90_000 });
      log(r.status === 'success' ? label : `${label} REVERTED`, { ...data, tx: hash, gas: Number(r.gasUsed) });
      if (r.status !== 'success') throw new Error(`${label} reverted (${hash})`);
      return hash;
    });
    queue = run.catch(() => undefined);
    return run;
  };

  console.log(`xorv node ${o.label} ${me} · owner ${owner} · stake ${profile ? Number(profile.stake) / 1e6 : 0} tUSD · models ${o.models.join(', ')}`);
  for (const v of new Set(o.models.map(vendorOf))) console.log(`  ${TERMS[v].name}: ${TERMS[v].links.join(' ')}`);
  if (o.fault !== 'none') console.log(`  FAULT INJECTION ON (${o.fault}): this node returns junk on purpose so the spot check can slash it`);

  // Pre-bid self-check: a node that wins a job it cannot run gets slashed for not delivering. Every
  // model is run once at start and again every 10 minutes; a model that fails is benched (no bids).
  const benched = new Map<string, { until: number; reason: string }>();
  const healthyAt = new Map<string, number>();
  const selfCheck = async (model: string) => {
    if (o.fault !== 'none' || process.env.XORV_SKIP_PREFLIGHT === '1') return true;
    if (Date.now() - (healthyAt.get(model) ?? 0) < 600_000) return true;
    try {
      await runModel(model, 'Reply with the single word OK.', { maxTokens: 64, timeoutMs: 30_000 });
      healthyAt.set(model, Date.now());
      benched.delete(model);
      return true;
    } catch (e) {
      const reason = (e as Error).message.slice(0, 160);
      benched.set(model, { until: Date.now() + 600_000, reason });
      log('self-check failed, not bidding', { model, reason });
      return false;
    }
  };
  let healthy = 0;
  for (const m of o.models) {
    if (await selfCheck(m)) {
      healthy++;
      console.log(`  self-check ${m}: ok`);
    } else console.log(`  self-check ${m}: FAILED, benched (no bids on it): ${benched.get(m)?.reason}`);
  }
  if (!healthy) throw new Error('every model failed its self-check; this node would only lose stake, so it will not start');
  console.log('XORV_NODE_READY');

  const run = async (job: Job, prompt: string): Promise<RunResult> => {
    try {
      return await runModel(job.model, prompt, { maxTokens: Math.min(1024, job.maxTokens) });
    } catch (e) {
      benched.set(job.model, { until: Date.now() + 600_000, reason: (e as Error).message.slice(0, 160) });
      healthyAt.delete(job.model);
      throw e;
    }
  };

  const busy = new Set<string>();
  const once = async (key: string, fn: () => Promise<unknown>) => {
    if (busy.has(key) || state.done[key]) return;
    busy.add(key);
    try {
      await fn();
      state.done[key] = true;
      save();
    } catch (e) {
      const msg = (e as any).shortMessage ?? (e as Error).message;
      log('error', { key, error: String(msg).slice(0, 240) });
    } finally {
      busy.delete(key);
    }
  };

  const texts = new Map<string, string>();
  const eventText = async (job: Job, eventName: 'JobPosted' | 'Delivered' | 'CheckDelivered', field: 'prompt' | 'output', round?: number) => {
    const k = `${job.id}:${eventName}:${round ?? ''}`;
    if (texts.has(k)) return texts.get(k)!;
    const latest = await w.getBlockNumber();
    const from = latest > 4000n ? latest - 4000n : 0n;
    const logs = await reader.getLogsChunked({ address: d.contracts.market, abi: xorvMarketAbi, eventName, args: { id: BigInt(job.id) }, fromBlock: from });
    const hit = logs.find((l: any) => round === undefined || Number(l.args.round) === round);
    if (!hit) throw new Error(`no ${eventName} event for job ${job.id} in the last 4,000 blocks`);
    const text = hit.args[field] as string;
    texts.set(k, text);
    return text;
  };

  const askFor = async (model: string): Promise<bigint> => {
    if (o.fault === 'deliver') return 1n; // a cheater underbids to win, then skips the work
    const p = await reader.provider(owner);
    const load = 1 + 0.1 * Number(p?.active ?? 0);
    const jitter = 0.97 + Math.random() * 0.06;
    return BigInt(Math.max(1, Math.round((o.cost[model] ?? 300) * o.margin * load * jitter)));
  };

  const open = new Set<number>();
  let cursor = Math.max(0, (await reader.jobCount()) - 10);

  const tick = async () => {
    const [count, block] = await Promise.all([reader.jobCount(), w.getBlock()]);
    for (; cursor < count; cursor++) open.add(cursor);
    const now = Number(block.timestamp);
    const height = block.number;
    for (const id of [...open]) {
      const j = await reader.job(id);
      if (CLOSED.has(j.status)) {
        open.delete(id);
        continue;
      }
      const key = String(id);
      const mine = o.models.includes(j.model);

      if (j.status === 'Bidding') {
        if (now < j.commitEnd && mine && !state.bids[key] && !((benched.get(j.model)?.until ?? 0) > Date.now())) {
          if (!(await selfCheck(j.model))) continue;
          const rate = await askFor(j.model);
          if (rate > j.maxRate) {
            log('skip', { job: id, reason: `ask ${rate} is above the buyer's ceiling ${j.maxRate}` });
            state.bids[key] = { rate: '0', salt: '0x' };
            save();
            continue;
          }
          const salt = newSalt();
          state.bids[key] = { rate: rate.toString(), salt };
          save();
          await once(`commit:${key}`, () => tx('commitBid', [BigInt(id), bidCommitment(d.chainId, d.contracts.market, id, me, rate, salt)], 'commit sealed bid', { job: id, sealed_rate: Number(rate) }));
        }
        const bid = state.bids[key];
        if (now >= j.commitEnd && now < j.revealEnd && bid && bid.rate !== '0') {
          await once(`reveal:${key}`, () => tx('revealBid', [BigInt(id), BigInt(bid.rate), bid.salt], 'reveal bid', { job: id, rate: Number(bid.rate) }));
        }
        if (now >= j.revealEnd && o.keeper) await once(`close:${key}`, () => tx('advance', [BigInt(id)], 'close auction', { job: id }));
        continue;
      }

      if (j.status === 'Running') {
        if (j.winnerNode.toLowerCase() === me.toLowerCase()) {
          await once(`deliver:${key}`, async () => {
            let out: RunResult;
            if (o.fault === 'deliver') {
              out = { text: JUNK, tokens: j.maxTokens };
              log('fault injection: junk output, model not run', { job: id });
            } else {
              out = await run(j, await eventText(j, 'JobPosted', 'prompt'));
              log('ran model', { job: id, model: j.model, tokens: out.tokens, chars: out.text.length });
            }
            await tx('deliver', [BigInt(id), out.text, out.tokens], 'deliver', { job: id, tokens: out.tokens });
          });
        } else if (now >= j.deliverEnd && o.keeper) {
          await once(`nodeliver:${key}`, () => tx('advance', [BigInt(id)], 'slash non-delivery', { job: id }));
        }
        continue;
      }

      if (j.status === 'Delivered' || j.status === 'Mismatch') {
        const winner = j.winnerNode.toLowerCase() === me.toLowerCase();
        if (height > j.drawBlock && ((j.status === 'Delivered' && winner) || o.keeper)) {
          await once(`draw:${key}:${j.status}`, () => tx('resolveDraw', [BigInt(id)], j.status === 'Delivered' ? 'resolve spot-check draw' : 'draw tiebreaker', { job: id }));
        }
        continue;
      }

      if (j.status === 'Checking' || j.status === 'Tiebreak') {
        const checks = await reader.checks(id);
        const round = checks.length - 1;
        const c = checks[round];
        if (c && c.node.toLowerCase() === me.toLowerCase() && !c.delivered) {
          await once(`check:${key}:${round}`, async () => {
            const result = await eventText(j, 'Delivered', 'output');
            const first = round === 1 ? await eventText(j, 'CheckDelivered', 'output', 0) : '';
            let out: RunResult;
            if (o.fault === 'check') {
              out = { text: JUNK, tokens: 10 };
              log('fault injection: junk check, model not run', { job: id });
            } else {
              out = await run(j, await eventText(j, 'JobPosted', 'prompt'));
            }
            const sim = similarityBps(result, out.text);
            log(round === 0 ? 're-ran model for spot check' : 're-ran model as tiebreaker', { job: id, similarity_bps: sim, ...(round === 1 ? { vs_first_check_bps: similarityBps(first, out.text) } : {}) });
            await tx('deliverCheck', [BigInt(id), out.text, out.tokens, result, first], round === 0 ? 'deliver spot check' : 'deliver tiebreak', { job: id, similarity_bps: sim });
          });
        } else if (now >= j.checkEnd && o.keeper) {
          await once(`checktimeout:${key}:${round}`, () => tx('advance', [BigInt(id)], 'close timed-out check', { job: id }));
        }
      }
    }
  };

  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error(`[${o.label}] tick: ${String((e as any).shortMessage ?? (e as Error).message).slice(0, 200)}`);
    }
    if (o.once) return;
    await new Promise((r) => setTimeout(r, o.pollMs));
  }
}
