import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { InjectedWallet, WalletSelector } from '@near-wallet-selector/core';
import { computeChatRequest, postedJobId, formatNear, NEAR, rpc, TESTNET_RPCS, type ChatMessage } from '@xorv/sdk';
import { CONTRACT, RPC, acctUrl, chain, txUrl } from './data';
import { walletError } from './wallet-errors';
import type { Account, Posted } from './gateway';

let selectorPromise: Promise<WalletSelector> | null = null;
function selector() {
  return selectorPromise ??= import('./polyfills').then(() => Promise.all([
    import('@near-wallet-selector/core'), import('@near-wallet-selector/meteor-wallet'),
  ])).then(async ([core, meteor]) => {
    const module = import.meta.env.VITE_QA_SIGNER === '1'
      ? (await import('./qa-signer')).setupQASigner() : meteor.setupMeteorWallet();
    return core.setupWalletSelector({ network: 'testnet', modules: [module] });
  })
    .catch((error) => { selectorPromise = null; throw error; });
}

export async function readAccount(id: string): Promise<Account> {
  if (id.endsWith('.near')) throw new Error('mainnet account');
  const view = await rpc<{ amount: string; locked: string; storage_usage: number }>([RPC, ...TESTNET_RPCS.filter((u) => u !== RPC)], 'query', { request_type: 'view_account', finality: 'final', account_id: id });
  return { account: id, balance: view.amount, locked: view.locked, storage_bytes: view.storage_usage, explorer: acctUrl(id) };
}

export class EscrowConfirmationError extends Error {
  constructor(message: string, public tx: string) { super(message); }
}
type WalletState = { account: string; ready: boolean; connecting: boolean; error: string | null; connect: () => Promise<void>; disconnect: () => Promise<void>; postChat: (model: string, messages: ChatMessage[]) => Promise<Posted>; };
const Context = createContext<WalletState | null>(null);
export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState('');
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    selector().then((s) => {
      if (!alive) return;
      const sync = () => { if (alive) setAccount(s.store.getState().accounts.find((a) => a.active)?.accountId ?? ''); };
      sync();
      setReady(true);
      const sub = s.store.observable.subscribe(sync);
      stop = () => sub.unsubscribe();
    }).catch((e) => { if (alive) { setError(walletError(e)); setReady(true); } });
    return () => { alive = false; stop?.(); };
  }, []);
  async function connect() {
    if (connecting) return;
    setConnecting(true); setError(null);
    try { const wallet = await (await selector()).wallet<InjectedWallet>(import.meta.env.VITE_QA_SIGNER === '1' ? 'qa-signer' : 'meteor-wallet'); await wallet.signIn({ contractId: CONTRACT, methodNames: ['post_compute'] }); }
    catch (e) { setError(walletError(e)); }
    finally { setConnecting(false); }
  }
  async function disconnect() {
    setError(null);
    try { await (await (await selector()).wallet()).signOut(); setAccount(''); }
    catch (e) { setError(walletError(e)); }
  }
  async function postChat(model: string, messages: ChatMessage[]): Promise<Posted> {
    const buyer = account;
    if (!buyer) throw new Error('Wallet not signed in');
    const [config, balance, core, s] = await Promise.all([chain.config(), readAccount(buyer), import('@near-wallet-selector/core'), selector()]);
    const request = computeChatRequest(config, model, messages);
    if (BigInt(balance.balance) < BigInt(request.deposit) + BigInt(NEAR(0.05))) throw new Error('NotEnoughBalance');
    const wallet = await s.wallet();
    let outcome: unknown;
    let hash = '';
    try {
      outcome = await wallet.signAndSendTransaction({ signerId: buyer, receiverId: CONTRACT,
        actions: [core.actionCreators.functionCall(request.methodName, request.args, BigInt(request.gas), BigInt(request.deposit))] });
      const result = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | undefined;
      hash = result?.transaction?.hash ?? result?.transaction_outcome?.id ?? '';
    } catch (e) {
      // A landed transaction must never be re-sent just because finality lookup failed.
      hash = (e as { transaction_outcome?: { id?: string } })?.transaction_outcome?.id
        ?? String((e as Error)?.message ?? '').match(/Transaction (\w{43,44}) doesn't exist/)?.[1] ?? '';
      if (!hash) throw e;
    }
    if (!hash) throw new Error('The wallet returned no transaction. Check Meteor Wallet before retrying.');
    try {
      outcome = await rpc([RPC, ...TESTNET_RPCS.filter((u) => u !== RPC)], 'tx', { tx_hash: hash, sender_account_id: buyer, wait_until: 'FINAL' });
      const job = postedJobId(outcome);
      let record = await chain.job(job);
      for (let attempt = 0; !record && attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        record = await chain.job(job);
      }
      if (!record || record.buyer !== buyer || record.model !== model) throw new Error('Escrow confirmation did not match this account and model.');
      return { job, tx: hash, model, units: request.args.units, max_near: 0.05, deposit_near: formatNear(request.deposit, 4), explorer: txUrl(hash) };
    } catch {
      throw new EscrowConfirmationError('The escrow transaction was submitted, but its job could not be confirmed. Check the transaction before retrying; it has not been sent again.', hash);
    }
  }
  return <Context.Provider value={{ account, ready, connecting, error, connect, disconnect, postChat }}>{children}</Context.Provider>;
}
export function useWallet() {
  const wallet = useContext(Context);
  if (!wallet) throw new Error('WalletProvider is missing');
  return wallet;
}
