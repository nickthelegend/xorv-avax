import { defineChain, type Chain } from 'viem';
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
