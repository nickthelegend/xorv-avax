import { useEffect, useRef, useState } from 'react';
import { xorv, type Job, type Provider } from '@xorv/sdk';

export const CONTRACT = (import.meta.env.VITE_XORV_CONTRACT as string | undefined) ?? 'escrow.xorv-ikic2.testnet';
// drpc first in the browser: it sends CORS headers even when busy; FastNEAR is the fallback.
export const RPC = (import.meta.env.VITE_NEAR_RPC_URL as string | undefined) ?? 'https://near-testnet.drpc.org';
const reader = xorv(CONTRACT, RPC);
const settledJobs = new Map<number, Job>();
const pendingJobs = new Map<number, Promise<Job | null>>();
// Closed jobs cannot change on this contract. Reuse their records across market, chat and
// detail polls instead of downloading every historical result every few seconds.
export const chain = {
  ...reader,
  job(id: number): Promise<Job | null> {
    const settled = settledJobs.get(id);
    if (settled) return Promise.resolve(settled);
    const pending = pendingJobs.get(id);
    if (pending) return pending;
    const request = reader.job(id).then((job) => {
      if (job && ['done', 'paid', 'faulted', 'expired', 'refunded', 'forfeited'].includes(job.status)) settledJobs.set(id, job);
      return job;
    }).finally(() => pendingJobs.delete(id));
    pendingJobs.set(id, request);
    return request;
  },
};

export interface Live<T> { data: T | null; error: string | null; loading: boolean; at: number }
export const READ_ERROR = 'NEAR testnet could not be read. Check your connection and reload or retry.';

/** Poll a chain read. Keeps the last good value on a failed refresh and shows the error. */
export function usePoll<T>(fn: () => Promise<T>, ms = 5000, deps: unknown[] = []): Live<T> {
  const [s, set] = useState<Live<T>>({ data: null, error: null, loading: true, at: 0 });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const data = await fnRef.current();
        if (alive) set({ data, error: null, loading: false, at: Date.now() });
      } catch {
        if (alive) set((p) => ({ ...p, error: READ_ERROR, loading: false }));
      }
      if (alive && ms > 0) timer = setTimeout(tick, document.hidden ? ms * 3 : ms);
    };
    set((p) => ({ ...p, loading: true }));
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export const near = (y: string | bigint | null | undefined, d = 3) => {
  if (y == null) return '—';
  const v = Number(BigInt(y) / 10n ** 15n) / 1e9;
  return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
};
export const short = (a: string) => a.replace(/\.xorv-[a-z0-9]+\.testnet$/, '');
export const ago = (ms: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const txUrl = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
export const acctUrl = (a: string) => `https://testnet.nearblocks.io/address/${a}`;
export const servesModel = (p: Provider, model: string) => p.roles.includes('compute') && BigInt(p.stake) > 0n && p.models.includes(model);
/** Buyer-funded work payments; refunds and redistributed provider stake are not spend. */
export const paidForWork = (job: Pick<Job, 'payouts'>) => job.payouts
  .filter((p) => ['clearing price', 'check fee', 'verifier fee', 'bounty reward'].includes(p.reason))
  .reduce((total, p) => total + nearNum(p.amount), 0);

/** Jobs whose cleared price should not count: the winner was slashed, so no real work was bought. */
export async function indexInputs() {
  const [clearings, jobs] = await Promise.all([chain.clearings(), chain.jobs(0, 100)]);
  const excluded = new Set(jobs.filter((j) => j.status === 'faulted').map((j) => j.id));
  return { clearings, excluded };
}

/** One read of the market: stats, job summaries and the full record of the newest jobs (for nodes and checks). */
export async function marketRead() {
  const [stats, jobs, providers, clearings] = await Promise.all([chain.stats(), chain.jobs(0, 40), chain.providers(), chain.clearings()]);
  const full = await Promise.all(jobs.slice(0, 20).map((j) => chain.job(j.id)));
  return { stats, jobs, providers, clearings, full: new Map(full.filter(Boolean).map((j) => [j!.id, j!])) };
}
export type MarketRead = Awaited<ReturnType<typeof marketRead>>;

const CLOSED_ST = ['done', 'paid', 'faulted', 'expired', 'refunded', 'forfeited'];
export const isLive = (status: string) => !CLOSED_ST.includes(status);

/** Every node owner that touched a job (bid, patch, check or vote), and which of them were slashed. */
export function jobNodes(j: Job) {
  const s = new Set<string>();
  j.bids.forEach((b) => s.add(b.owner));
  j.patches.forEach((p) => s.add(p.owner));
  j.checks.forEach((c) => s.add(c.owner));
  j.verifiers.forEach((v) => s.add(v.owner));
  if (j.winner) s.add(j.winner);
  const slashed = new Set(j.slashes.map((x) => x.account));
  return [...s].map((owner) => ({ owner, name: short(owner), slashed: slashed.has(owner) }));
}

/** Plain verdict for a job, from its on-chain status and checks. */
export function verdict(j: Pick<Job, 'kind' | 'status' | 'checks'> & { stage?: string }): { text: string; tone: 'ok' | 'bad' | 'live' | 'dim' } {
  if (j.status === 'faulted') return { text: 'Slashed ✕', tone: 'bad' };
  if (j.status === 'forfeited') return { text: 'Bond forfeited ✕', tone: 'bad' };
  if (j.status === 'done' || j.status === 'paid') return j.kind === 'compute' && j.checks.length === 0 ? { text: 'Paid · not sampled', tone: 'dim' } : { text: 'Verified ✓', tone: 'ok' };
  if (j.status === 'expired' || j.status === 'refunded') return { text: 'Refunded', tone: 'dim' };
  return { text: STAGE[j.stage ?? j.status] ?? STAGE[j.status] ?? j.status, tone: 'live' };
}
export const STAGE: Record<string, string> = { commit: 'Sealed bids open', bidding: 'Sealed bids open', reveal: 'Revealing', closing: 'Clearing', running: 'Running', checking: 'Spot check', tiebreak: 'Tiebreak', solve: 'Solving', solving: 'Solving', verifying: 'Verifying' };

export const longDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** A provider's capacity as the chain shows it: its last revealed bid per unit and its job-by-job record. */
export function capacity(p: Provider, full: Map<number, Job>) {
  const jobs = [...full.values()].sort((a, b) => a.id - b.id);
  const worked = jobs.filter((j) => jobNodes(j).some((n) => n.owner === p.owner)).map((j) => ({ id: j.id, slashed: j.slashes.some((x) => x.account === p.owner) }));
  let lastBid: { perUnit: number; job: number } | null = null;
  for (const j of [...jobs].reverse()) {
    const b = j.bids.find((x) => x.owner === p.owner && x.price);
    if (b && j.units > 0) { lastBid = { perUnit: Number(BigInt(b.price!) / 10n ** 15n) / 1e9 / j.units, job: j.id }; break; }
  }
  return { worked, lastBid };
}

/* ---------- shared market store: one poll for every page and the header search ---------- */
type Store = { data: MarketRead | null; error: string | null; loading: boolean; at: number };
let store: Store = { data: null, error: null, loading: false, at: 0 };
const subs = new Set<(s: Store) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
async function tickStore() {
  store = { ...store, loading: true };
  subs.forEach((f) => f(store));
  try { store = { data: await marketRead(), error: null, loading: false, at: Date.now() }; }
  catch { store = { ...store, error: READ_ERROR, loading: false }; }
  subs.forEach((f) => f(store));
  if (subs.size) timer = setTimeout(tickStore, document.hidden ? 30000 : 10000);
  else timer = null;
}
export function refreshMarket() { if (timer) clearTimeout(timer); tickStore(); }
export function useMarket() {
  const [s, set] = useState(store);
  useEffect(() => {
    subs.add(set);
    if (!timer && !store.loading) { if (!store.data || Date.now() - store.at > 10000) tickStore(); else timer = setTimeout(tickStore, 10000); }
    return () => { subs.delete(set); };
  }, []);
  return { ...s, reload: refreshMarket };
}

/* ---------- derived metrics, all from chain records ---------- */
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Delivery samples for an owner: time from assignment to deliver() (winner: from reveal close) and output length. */
export function deliveries(full: Map<number, Job>, owner?: string) {
  const out: { job: number; owner: string; ms: number; chars: number; role: 'winner' | 'checker' }[] = [];
  for (const j of full.values()) {
    if (j.result && j.result.delivered_ms) {
      const start = j.result.drawn_ms || j.reveal_end_ms;
      if ((!owner || j.result.owner === owner) && j.result.delivered_ms > start) out.push({ job: j.id, owner: j.result.owner, ms: j.result.delivered_ms - start, chars: j.result.output?.length ?? 0, role: 'winner' });
    }
    for (const c of j.checks) if (c.delivered_ms && c.drawn_ms && c.delivered_ms > c.drawn_ms && (!owner || c.owner === owner)) out.push({ job: j.id, owner: c.owner, ms: c.delivered_ms - c.drawn_ms, chars: c.output?.length ?? 0, role: 'checker' });
  }
  return out.sort((a, b) => a.job - b.job);
}

export function nodeStats(p: Provider, full: Map<number, Job>) {
  const cap = capacity(p, full);
  const d = deliveries(full, p.owner);
  const bad = cap.worked.filter((w) => w.slashed).length;
  const ms = d.reduce((n, x) => n + x.ms, 0);
  return {
    ...cap, bad, samples: d,
    latencyMs: median(d.map((x) => x.ms)),
    charsPerSec: ms > 0 ? d.reduce((n, x) => n + x.chars, 0) / (ms / 1000) : null,
    clean: cap.worked.length ? (cap.worked.length - bad) / cap.worked.length : null,
  };
}

export function modelStats(model: string, m: MarketRead) {
  const nodes = m.providers.filter((p) => servesModel(p, model));
  const jobs = m.jobs.filter((j) => j.kind === 'compute' && j.model === model);
  const ids = new Set(jobs.map((j) => j.id));
  const d = deliveries(m.full).filter((x) => ids.has(x.job));
  const clear = m.clearings.filter((c) => c.model === model);
  const ms = d.reduce((n, x) => n + x.ms, 0);
  return { model, nodes, jobs, clearings: clear, deliveries: d, latencyMs: median(d.map((x) => x.ms)), charsPerSec: ms > 0 ? d.reduce((n, x) => n + x.chars, 0) / (ms / 1000) : null };
}

export const allModels = (m: MarketRead) => [...new Set([...m.providers.flatMap((p) => p.models), ...m.jobs.filter((j) => j.kind === 'compute').map((j) => j.model)])].filter(Boolean);
export const secs = (ms: number | null) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const modelLabel = (m: string) => m.split(':').slice(1).join(':') || m;
export const modelHost = (m: string) => m.split(':')[0] || '';
export const modelUrl = (m: string) => `/models/${encodeURIComponent(m)}`;

const ORGS: Record<string, string> = { nvidia: 'NVIDIA', cohere: 'Cohere', openai: 'OpenAI', 'meta-llama': 'Meta', meta: 'Meta', qwen: 'Qwen', google: 'Google', mistralai: 'Mistral', deepseek: 'DeepSeek', anthropic: 'Anthropic', moonshotai: 'Moonshot' };
/** OpenRouter-style title: "groq:openai/gpt-oss-20b" → "OpenAI: gpt-oss-20b". */
export const modelName = (m: string) => {
  const id = modelLabel(m);
  const [org, ...rest] = id.split('/');
  if (!rest.length) return id;
  const name = rest.join('/').replace(/:free$/, ' (free)');
  return `${ORGS[org] ?? org.charAt(0).toUpperCase() + org.slice(1)}: ${name}`;
};
export const HOSTS: Record<string, string> = { groq: 'Groq', openrouter: 'OpenRouter', api: 'OpenAI-compatible API', ollama: 'Ollama (local)', 'claude-code': 'Claude Code', codex: 'Codex' };
export const hostName = (m: string) => HOSTS[modelHost(m)] ?? modelHost(m);
export const KIND: Record<string, string> = { ollama: 'Local model', api: 'API key', subscription: 'Subscription CLI' };
/** NEAR as a number, for sorting and maths. */
export const nearNum = (y: string | bigint | null | undefined) => (y == null ? 0 : Number(BigInt(y) / 10n ** 15n) / 1e9);
export const queryParam = (k: string) => new URLSearchParams(location.search).get(k);
