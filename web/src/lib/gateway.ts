import { useEffect, useState } from 'react';

/**
 * The Xorv gateway (packages/gateway) signs jobs with the buyer key and runs the provider nodes.
 * The web app reaches it through the Vite proxy at /api and /v1. Without it the app stays read-only
 * and says so ("Setup required"), it never pretends.
 */
export interface NodeStatus { label: string; node: string; price: number; keeper: boolean; up: boolean; pid: number | null; started_ms: number; restarts: number; last_error: string | null }
export interface Health { contract: string; network: string; buyer: string | null; provider_keys: Record<string, boolean>; nodes: NodeStatus[]; external_nodes: boolean; models: { id: string; ready: boolean; demo_ready: boolean }[]; provider_setup_required: string[]; setup_required: string[] }
export interface Account { account: string; balance: string; locked: string; storage_bytes: number; explorer: string }
export interface Posted { job: number; tx: string; model: string; units: number; max_near: number; deposit_near: string; explorer: string }
export interface Receipt { at: string; node: string; event: string; tx: string; job: number }
export interface Receipts { job: number; post: { at: string; job: number; tx: string; model: string; source: string } | null; nodes: Receipt[] }
export interface ApiKey { id: string; name: string; prefix: string; created_ms: number; last_used_ms: number; requests: number; jobs: number[]; revoked: boolean }

export class GatewayError extends Error {
  constructor(message: string, public status: number, public setup?: string, public offline = false) { super(message); }
}

export const GATEWAY_START = 'GROQ_API_KEY=your_groq_api_key pnpm gateway';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } }); }
  catch { throw new GatewayError('The Xorv gateway is not reachable.', 0, 'gateway', true); }
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  // The dev/preview proxy answers 502/504 with an HTML or empty body when the gateway process is down.
  if ((!body && !r.ok) || body?.gateway_offline) throw new GatewayError('The Xorv gateway is not running.', r.status, 'gateway', true);
  if (!r.ok) throw new GatewayError(body?.error?.message ?? `HTTP ${r.status}`, r.status, body?.error?.setup);
  return body as T;
}

export const gateway = {
  health: () => req<Health>('/api/health'),
  account: () => req<Account>('/api/account'),
  chat: (model: string, messages: { role: string; content: string }[]) => req<Posted>('/api/chat', { method: 'POST', body: JSON.stringify({ model, messages }) }),
  receipts: (job: number) => req<Receipts>(`/api/jobs/${job}/receipts`),
  recordWalletPost: (job: number, tx: string) => req(`/api/jobs/${job}/receipt`, { method: 'POST', body: JSON.stringify({ tx }) }),
  keys: () => req<ApiKey[]>('/api/keys'),
  createKey: (name: string) => req<{ key: string; record: ApiKey }>('/api/keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeKey: (id: string) => req<{ revoked: string }>(`/api/keys/${id}`, { method: 'DELETE' }),
};

/** Poll the gateway's health. `error` is set (and data null) when the gateway is down. */
export function useGateway(ms = 8000) {
  const [s, set] = useState<{ data: Health | null; error: GatewayError | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const d = await gateway.health(); if (alive) set({ data: d, error: null, loading: false }); }
      catch (e) { if (alive) set({ data: null, error: e as GatewayError, loading: false }); }
      if (alive) t = setTimeout(tick, document.hidden ? ms * 3 : ms);
    };
    tick();
    return () => { alive = false; clearTimeout(t); };
  }, [ms]);
  return s;
}
