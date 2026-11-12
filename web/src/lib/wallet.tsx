import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createWalletClient, custom, type Address, type Hex, type LocalAccount, type WalletClient } from 'viem';
import { fuji, rpcTransport, signPayment, type PaymentPayload, type PaymentRequirements } from '@xorv/sdk';
import { D } from './data';

/**
 * Build flag for the Playwright QA signer. Only a build made with VITE_XORV_QA=1 contains this path;
 * the test key is injected at runtime as window.__XORV_QA_KEY__ and is never part of the bundle.
 */
export const QA = import.meta.env.VITE_XORV_QA === '1';

type Kind = 'injected' | 'qa';
interface Wallet {
  address: Address | null;
  kind: Kind | null;
  connecting: boolean;
  error: string | null;
  hasInjected: boolean;
  qaAvailable: boolean;
  connect: (kind?: Kind) => Promise<void>;
  disconnect: () => void;
  signPayment: (req: PaymentRequirements) => Promise<PaymentPayload>;
  signMessage: (message: string) => Promise<Hex>;
  write: (req: { address: Address; abi: any; functionName: string; args?: unknown[] }) => Promise<Hex>;
}

const Ctx = createContext<Wallet | null>(null);
const FUJI_HEX = '0xa869';
const STORE = 'xorv.wallet';

const eth = () => (window as any).ethereum as { request: (a: { method: string; params?: unknown[] }) => Promise<any>; on?: any; removeListener?: any } | undefined;

async function ensureFuji() {
  const p = eth()!;
  const id = await p.request({ method: 'eth_chainId' });
  if (id === FUJI_HEX) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: FUJI_HEX }] });
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: FUJI_HEX, chainName: 'Avalanche Fuji C-Chain', nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 }, rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'], blockExplorerUrls: ['https://testnet.snowtrace.io'] }],
    });
  }
}

export function walletMessage(e: unknown): string {
  const err = e as any;
  if (err?.code === 4001 || /reject|denied/i.test(String(err?.message))) return 'You declined the request in your wallet. Nothing was signed or sent.';
  return String(err?.shortMessage ?? err?.message ?? e).slice(0, 240);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [client, setClient] = useState<WalletClient | null>(null);
  const [local, setLocal] = useState<LocalAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInjected = typeof window !== 'undefined' && !!eth();
  const qaAvailable = QA && typeof window !== 'undefined' && typeof (window as any).__XORV_QA_KEY__ === 'string';

  const useInjected = useCallback(async (request: boolean) => {
    const p = eth();
    if (!p) throw new Error('No browser wallet found. Install Core or MetaMask, or use a QA build.');
    const accounts: string[] = await p.request({ method: request ? 'eth_requestAccounts' : 'eth_accounts' });
    if (!accounts[0]) return false;
    await ensureFuji();
    const c = createWalletClient({ account: accounts[0] as Address, chain: fuji, transport: custom(p) });
    setClient(c);
    setLocal(null);
    setAddress(accounts[0] as Address);
    setKind('injected');
    return true;
  }, []);

  // In a normal build QA is the literal false, so this whole branch (and its key lookup) is dropped.
  const useQa = useCallback(QA ? async () => {
    const key = (window as any).__XORV_QA_KEY__ as Hex | undefined;
    if (!key) throw new Error('QA signer: no key was injected for this session.');
    const { privateKeyToAccount } = await import('viem/accounts');
    const acct = privateKeyToAccount(key);
    setLocal(acct);
    setClient(createWalletClient({ account: acct, chain: fuji, transport: rpcTransport(D) }));
    setAddress(acct.address);
    setKind('qa');
    return true;
  } : async () => false, []);

  const connect = useCallback(async (k?: Kind) => {
    setConnecting(true);
    setError(null);
    try {
      const want = k ?? (qaAvailable ? 'qa' : 'injected');
      if (want === 'qa') await useQa();
      else await useInjected(true);
      try { localStorage.setItem(STORE, want); } catch { /* private mode */ }
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setConnecting(false);
    }
  }, [qaAvailable, useInjected, useQa]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setKind(null);
    setClient(null);
    setLocal(null);
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  }, []);

  // Reconnect silently on reload (no wallet pop-up).
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORE); } catch { /* ignore */ }
    if (saved === 'qa' && qaAvailable) void useQa();
    else if (saved === 'injected' && hasInjected) void useInjected(false).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = eth();
    if (!p?.on || kind !== 'injected') return;
    const onAcc = (a: string[]) => (a[0] ? setAddress(a[0] as Address) : disconnect());
    p.on('accountsChanged', onAcc);
    return () => p.removeListener?.('accountsChanged', onAcc);
  }, [kind, disconnect]);

  const value = useMemo<Wallet>(() => ({
    address,
    kind,
    connecting,
    error,
    hasInjected,
    qaAvailable,
    connect,
    disconnect,
    signPayment: async (req) => {
      if (!address || !client) throw new Error('Connect a wallet first.');
      if (kind === 'injected') await ensureFuji();
      return local ? signPayment(local, req) : signPayment({ account: address, client }, req);
    },
    signMessage: async (message) => {
      if (!address || !client) throw new Error('Connect a wallet first.');
      return local ? local.signMessage({ message }) : client.signMessage({ account: address, message });
    },
    write: async (req) => {
      if (!address || !client) throw new Error('Connect a wallet first.');
      if (kind === 'injected') await ensureFuji();
      return client.writeContract({ ...req, account: local ?? address, chain: fuji } as any);
    },
  }), [address, kind, connecting, error, hasInjected, qaAvailable, connect, disconnect, client, local]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWallet outside WalletProvider');
  return w;
}
