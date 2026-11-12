import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  MODELS,
  OUTCOME_TEXT,
  XorvReader,
  modelInfo,
  x402RouterAbi,
  xorvIndexAbi,
  xorvMarketAbi,
  type Bid,
  type Check,
  type Deployment,
  type IndexModel,
  type Job,
  type Provider,
} from '@xorv/sdk';
import fuji from '../../../deployments/fuji.json';

export const D = fuji as unknown as Deployment & { startBlock?: number; evidence?: Record<string, any[]> };
export const reader = new XorvReader(D);
export const C = D.contracts;
export const SNOW = 'https://testnet.snowtrace.io';
export const txUrl = (h: string) => `${SNOW}/tx/${h}`;
export const addrUrl = (a: string) => `${SNOW}/address/${a}`;
export const READ_ERROR = 'Avalanche Fuji could not be read. Check your connection, then retry.';
export const CLOSED = new Set(['Done', 'Faulted', 'Expired']);
export const ZERO = '0x0000000000000000000000000000000000000000';

// ------------------------------------------------------------------ formatting

/** tUSD (6 decimals) as dollars. Small amounts keep enough digits to be honest. */
export function money(micro: bigint | number | string | null | undefined, digits?: number) {
  if (micro == null) return '—';
  const v = Number(BigInt(micro)) / 1e6;
  const d = digits ?? (v !== 0 && Math.abs(v) < 0.01 ? 4 : 2);
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
/** A rate in micro-dollars per 1k tokens shown as dollars per 1M tokens. */
export function rate1m(r: bigint | number | null | undefined, digits = 3) {
  if (r == null) return '—';
  const v = (Number(r) * 1000) / 1e6;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export const int = (n: number | bigint) => Number(n).toLocaleString('en-US');
export const short = (a?: string | null, n = 4) => (!a ? '—' : a.length > 2 + 2 * n ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a);
export const modelName = (id: string) => modelInfo(id).name;
export const hostName = (id: string) => ({ groq: 'Groq', ollama: 'Ollama' } as Record<string, string>)[id.split(':')[0]] ?? id.split(':')[0];
export const modelUrl = (id: string) => `/models/${encodeURIComponent(id)}`;
export const ago = (sec: number, now = Date.now() / 1000) => {
  const s = Math.max(0, Math.round(now - sec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const utc = (sec: number) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
export const queryParam = (k: string) => new URLSearchParams(location.search).get(k);

// ------------------------------------------------------------------ polling

export interface Live<T> { data: T | null; error: string | null; loading: boolean; at: number; reload: () => void }

/** Poll a read gently (never faster than 5 s, three times slower in a hidden tab). Keeps the last good value. */
export function usePoll<T>(fn: () => Promise<T>, ms = 10_000, deps: unknown[] = []): Live<T> {
  const [s, set] = useState<Omit<Live<T>, 'reload'>>({ data: null, error: null, loading: true, at: 0 });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const data = await fnRef.current();
        if (alive) set({ data, error: null, loading: false, at: Date.now() });
      } catch (e) {
        console.warn('read failed', e);
        if (alive) set((p) => ({ ...p, error: READ_ERROR, loading: false }));
      }
      if (alive && ms > 0) timer = setTimeout(tick, (document.hidden ? 3 : 1) * Math.max(5000, ms));
    };
    set((p) => ({ ...p, loading: true }));
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...s, reload: () => setNonce((n) => n + 1) };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now / 1000;
}

// ------------------------------------------------------------------ the market snapshot (one shared poller)

export interface Posted { prompt: string; buyer: string; viaX402: boolean; tx: string; at: number }
export interface Market {
  stats: Awaited<ReturnType<XorvReader['stats']>>;
  providers: Provider[];
  jobs: Job[];
  index: IndexModel[];
  posted: Map<number, Posted>;
  config: { spotCheckBps: number; toleranceBps: number; checkFee: bigint };
}

const closedJobs = new Map<number, Job>();
async function readJob(id: number): Promise<Job> {
  const hit = closedJobs.get(id);
  if (hit) return hit;
  const j = await reader.job(id);
  if (CLOSED.has(j.status)) closedJobs.set(id, j);
  return j;
}

let postedCache: { at: number; map: Map<number, Posted> } = { at: 0, map: new Map() };
async function readPosted(force = false): Promise<Map<number, Posted>> {
  if (!force && Date.now() - postedCache.at < 25_000) return postedCache.map;
  const logs = await reader.logs({ address: C.market, abi: xorvMarketAbi, eventName: 'JobPosted' });
  const map = new Map<number, Posted>();
  for (const l of logs) map.set(Number(l.args.id), { prompt: l.args.prompt, buyer: l.args.buyer, viaX402: l.args.viaX402, tx: l.transactionHash, at: Number(l.timeStamp ?? 0) });
  postedCache = { at: Date.now(), map };
  return map;
}

let cfgCache: Market['config'] | null = null;
async function readConfig() {
  if (cfgCache) return cfgCache;
  const c = (await reader.client.readContract({ address: C.market, abi: xorvMarketAbi, functionName: 'config' })) as readonly [number, number, bigint, number, number];
  cfgCache = { spotCheckBps: Number(c[0]), toleranceBps: Number(c[1]), checkFee: BigInt(c[2]) };
  return cfgCache;
}

async function readMarket(): Promise<Market> {
  const [stats, providers, config] = await Promise.all([reader.stats(), reader.providers(), readConfig()]);
  const ids = Array.from({ length: Math.min(40, stats.jobs) }, (_, i) => stats.jobs - 1 - i);
  const [jobs, index, posted] = await Promise.all([Promise.all(ids.map(readJob)), reader.indexModels(), readPosted().catch(() => postedCache.map)]);
  return { stats, providers, jobs, index, posted, config };
}

type Snap = { data: Market | null; error: string | null; at: number };
let snap: Snap = { data: null, error: null, at: 0 };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
async function refresh() {
  if (inflight) return;
  inflight = true;
  try {
    snap = { data: await readMarket(), error: null, at: Date.now() };
  } catch (e) {
    console.warn('market read failed', e);
    snap = { ...snap, error: READ_ERROR };
  } finally {
    inflight = false;
  }
  subs.forEach((f) => f());
  if (subs.size) timer = setTimeout(refresh, (document.hidden ? 3 : 1) * 12_000);
}
function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1 && !timer && !inflight) void refresh();
  return () => {
    subs.delete(f);
    if (!subs.size && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
export function reloadMarket() {
  if (timer) clearTimeout(timer);
  timer = null;
  postedCache.at = 0;
  void refresh();
}
export function useMarket() {
  const s = useSyncExternalStore(subscribe, () => snap);
  return { ...s, reload: reloadMarket };
}

// ------------------------------------------------------------------ derived views

export const labelOf = (m: Market | null | undefined, who?: string | null) => {
  if (!who || who === ZERO) return null;
  const w = who.toLowerCase();
  const p = m?.providers.find((x) => x.owner.toLowerCase() === w || x.node.toLowerCase() === w);
  if (p) return p.label;
  if (D.eerc?.desk && w === D.eerc.desk.toLowerCase()) return 'Xorv desk';
  return null;
};
export const nameOf = (m: Market | null | undefined, who?: string | null) => labelOf(m, who) ?? short(who);

export function servedModels(m: Market) {
  const min = BigInt(D.config.minStake);
  const out = new Map<string, Provider[]>();
  for (const p of m.providers) if (p.stake >= min && p.unbonding === 0n) for (const x of p.models) out.set(x, [...(out.get(x) ?? []), p]);
  return out;
}
export function allModels(m: Market) {
  const set = new Set<string>([...servedModels(m).keys(), ...m.jobs.map((j) => j.model), ...m.index.map((i) => i.name)]);
  return [...set].sort((a, b) => MODELS.findIndex((x) => x.id === a) - MODELS.findIndex((x) => x.id === b));
}
export const indexFor = (m: Market, model: string) => m.index.find((i) => i.name === model) ?? null;

export function jobTitle(m: Market | null | undefined, j: Job) {
  const p = m?.posted.get(j.id)?.prompt;
  if (!p) return `${modelName(j.model)} request`;
  const one = p.replace(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 70)}…` : one;
}

export type Tone = 'ok' | 'bad' | 'live' | 'dim';
export function verdict(j: Job): { text: string; tone: Tone } {
  switch (j.status) {
    case 'Bidding': return { text: 'Taking sealed bids', tone: 'live' };
    case 'Running': return { text: 'Running', tone: 'live' };
    case 'Delivered': return { text: 'Delivered, drawing check', tone: 'live' };
    case 'Checking': return { text: 'Spot check', tone: 'live' };
    case 'Mismatch': return { text: 'Mismatch, drawing tiebreaker', tone: 'live' };
    case 'Tiebreak': return { text: 'Tiebreak', tone: 'live' };
    case 'Done': return j.outcome === 'RefundedNoTiebreaker' ? { text: 'Refunded', tone: 'dim' } : { text: j.outcome === 'PaidCheckMatched' || j.outcome === 'PaidTiebreakSidedWithProvider' ? 'Paid · checked' : 'Paid', tone: 'ok' };
    case 'Faulted': return { text: 'Slashed', tone: 'bad' };
    case 'Expired': return { text: 'Expired', tone: 'dim' };
    default: return { text: j.status, tone: 'dim' };
  }
}
export const outcomeText = (j: Job) => OUTCOME_TEXT[j.outcome] ?? '';

// ------------------------------------------------------------------ one job, everything about it

export interface JobDetail {
  job: Job;
  bids: Bid[];
  checks: Check[];
  events: any[];
  index: any | null;
  x402: any | null;
}

const doneDetails = new Map<number, JobDetail>();
export async function readJobDetail(id: number): Promise<JobDetail> {
  const hit = doneDetails.get(id);
  if (hit) return hit;
  const job = await reader.job(id);
  const [bids, checks, events, idx, router] = await Promise.all([
    reader.bids(id, job.bidCount),
    reader.checks(id),
    reader.jobEvents(id).catch(() => [] as any[]),
    reader.logs({ address: C.index, abi: xorvIndexAbi, eventName: 'Recorded', args: { jobId: BigInt(id) } }).catch(() => [] as any[]),
    job.viaX402 ? reader.logs({ address: C.router, abi: x402RouterAbi, eventName: 'PaidAndPosted', args: { jobId: BigInt(id) } }).catch(() => [] as any[]) : Promise.resolve([] as any[]),
  ]);
  const d: JobDetail = { job, bids, checks, events, index: idx[0] ?? null, x402: router[0] ?? null };
  // Closed jobs never change; cache once the indexer has caught up with the close.
  if (CLOSED.has(job.status) && events.some((e) => e.eventName === 'JobClosed')) doneDetails.set(id, d);
  return d;
}

export const ev = (d: JobDetail | null, name: string) => d?.events.filter((e) => e.eventName === name) ?? [];
export const ev1 = (d: JobDetail | null, name: string) => ev(d, name)[0] ?? null;

/** Jobs a wallet posted (JobPosted.buyer is indexed). */
export async function jobsOf(buyer: string): Promise<Job[]> {
  const logs = await reader.logs({ address: C.market, abi: xorvMarketAbi, eventName: 'JobPosted', args: { buyer } });
  const ids = [...new Set(logs.map((l) => Number(l.args.id)))].sort((a, b) => b - a).slice(0, 50);
  return Promise.all(ids.map(readJob));
}
