import type { PaymentRequirements } from '@xorv/sdk';
import { usePoll } from './data';

export const GATEWAY_START = 'XORV_ENV_FILE=/path/to/.env pnpm gateway';

export class GatewayError extends Error {
  status: number;
  offline: boolean;
  setup?: string[];
  constructor(message: string, status = 0, offline = false, setup?: string[]) {
    super(message);
    this.status = status;
    this.offline = offline;
    this.setup = setup;
  }
}

export interface Health {
  chainId: number;
  network: string;
  facilitator: string | null;
  nodes: { label: string; up: boolean; ready: boolean; fault: string }[];
  models: { id: string; nodes: number }[];
  setup_required: string[];
}
export interface ServedModel { id: string; name: string; nodes: number; index_rate_per_1k: string | null }
export interface Paid { job: number; tx: string; explorer: string; value: string; receipt?: { transaction: string; payer: string; network: string } }
export interface PrivatePosted { job: number; tx: string; explorer: string; escrow: string; creditLeft: string; postedBy: string }
export interface Credit { address: string; credit: string; topups: { from: string; amount: string; tx: string; block: number }[]; jobs: { job: number; escrow: string; settled: boolean; tx: string }[]; receipt?: unknown; signature?: string }
export interface PrivateStatus { enabled: boolean; setup: string | null; encryptedERC: string; registrar: string; desk: string | null; auditor: string | null; privateJobs: number; attributedTopups: number }

async function call<T>(path: string, init?: RequestInit): Promise<{ body: T; res: Response }> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new GatewayError('The Xorv gateway could not be reached.', 0, true);
  }
  if (res.headers.get('x-xorv-gateway') === 'offline') throw new GatewayError('The Xorv gateway is not running.', 0, true);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 402) throw new GatewayError(body?.error?.message ?? `HTTP ${res.status}`, res.status, false, body?.setup);
  return { body, res };
}
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

export const gateway = {
  health: async () => (await call<Health>('/api/health')).body,
  models: async () => (await call<{ data: ServedModel[] }>('/v1/models')).body.data,
  requirements: async (body: unknown): Promise<PaymentRequirements> => {
    const { body: b } = await call<{ accepts: PaymentRequirements[] }>('/api/x402/requirements', json(body));
    if (!b.accepts?.[0]) throw new GatewayError('The gateway returned no payment requirements.');
    return b.accepts[0];
  },
  chat: async (body: unknown, payment: string): Promise<Paid> => {
    const { body: b, res } = await call<Paid & { error?: { message: string } }>('/api/chat', json(body, { 'x-payment': payment }));
    if (res.status === 402) throw new GatewayError(b.error?.message ?? 'Payment was not accepted.', 402);
    const h = res.headers.get('x-payment-response');
    let receipt: Paid['receipt'];
    try {
      receipt = h ? JSON.parse(atob(h)) : undefined;
    } catch {
      receipt = undefined;
    }
    return { ...b, receipt };
  },
  privateChat: async (body: unknown): Promise<PrivatePosted> => {
    const { body: b, res } = await call<PrivatePosted & { error?: { message: string } }>('/api/private/chat', json(body));
    if (res.status === 402) throw new GatewayError(b.error?.message ?? 'Not enough private credit.', 402);
    return b;
  },
  credit: async (body: unknown): Promise<Credit> => {
    const { body: b, res } = await call<Credit & { error?: { message: string } }>('/api/private/credit', json(body));
    if (res.status === 402) throw new GatewayError(b.error?.message ?? 'Credit unavailable.', 402);
    return b;
  },
  privateStatus: async () => (await call<PrivateStatus>('/api/private/status')).body,
};

export function useGateway(ms = 15_000) {
  return usePoll(async () => {
    try {
      return { ok: true as const, health: await gateway.health() };
    } catch (e) {
      return { ok: false as const, error: e as GatewayError };
    }
  }, ms);
}
