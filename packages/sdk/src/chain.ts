import { defineChain, fallback, http, type Chain, type Transport } from 'viem';
import { avalancheFuji } from 'viem/chains';

export const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
export const SNOWTRACE = 'https://testnet.snowtrace.io';

export const fuji: Chain = { ...avalancheFuji, rpcUrls: { default: { http: [FUJI_RPC] } } };

export const anvil: Chain = defineChain({
  id: 31337,
  name: 'Anvil (local)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:5545'] } },
});

export function chainFor(chainId: number, rpc?: string): Chain {
  const base = chainId === 43113 ? fuji : chainId === 31337 ? anvil : null;
  if (!base) throw new Error(`unsupported chain ${chainId}: Xorv runs on Avalanche Fuji (43113) or a local Anvil (31337)`);
  return rpc ? { ...base, rpcUrls: { default: { http: [rpc] } } } : base;
}

export const txUrl = (hash: string, chainId = 43113) => (chainId === 43113 ? `${SNOWTRACE}/tx/${hash}` : `local:${hash}`);
export const addressUrl = (a: string, chainId = 43113) => (chainId === 43113 ? `${SNOWTRACE}/address/${a}` : `local:${a}`);

/**
 * Public Fuji RPCs, used in order; viem falls back to the next on errors or rate limits (HTTP 429).
 * The official endpoint is last: it rate-limits a busy client hard.
 */
export const FUJI_RPCS = ['https://avalanche-fuji-c-chain-rpc.publicnode.com', 'https://avalanche-fuji.drpc.org', FUJI_RPC];

export function rpcTransport(d: { chainId: number; rpc: string }, rpc?: string): Transport {
  const urls = rpc ? rpc.split(',') : d.chainId === 43113 ? FUJI_RPCS : [d.rpc];
  // drpc's free plan answers HTTP 400 to any JSON-RPC batch of more than 3 calls, so its batches stay at 3; the
  // others get modest batches so one page burst never becomes a single huge request.
  const t = urls.map((u) => http(u.trim(), { retryCount: 2, timeout: 20_000, batch: { wait: 16, batchSize: /drpc\.org/.test(u) ? 3 : 20 } }));
  return t.length === 1 ? t[0] : fallback(t, { rank: false });
}
