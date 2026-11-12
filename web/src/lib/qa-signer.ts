/** QA signer: only imported by the explicitly flagged build. Never persists a key. */
import type { InjectedWallet, WalletModuleFactory } from '@near-wallet-selector/core';
import { Account, KeyPair, KeyPairSigner, providers, transactions, utils } from 'near-api-js';

export const QA_SIGNER_MARKER = 'XORV_QA_SIGNER_TESTNET_ONLY';
const ALLOWED_RPCS = ['https://near-testnet.drpc.org', 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'];
const GAS_RESERVE = 5n * 10n ** 21n;
const MAX_BUDGET = 3n * 10n ** 23n;
type SignAndSendTransactionParams = Parameters<InjectedWallet['signAndSendTransaction']>[0];
type Seed = { accountId: string; privateKey: string; rpcUrl: string; budgetYocto: string };
type RecordTx = { hash: string; signer: string; receiver: string; method: string; deposit: string };
declare global {
  interface Window {
    __XORV_QA_SIGNER__?: Seed;
    __XORV_QA_RECORD__?: (tx: RecordTx) => Promise<void>;
    __XORV_QA_WALLET__?: Pick<InjectedWallet, 'getAccounts' | 'signAndSendTransaction' | 'signAndSendTransactions'>;
  }
}

export function assertQATestnet(account: string, contract: string, rpcUrl: string, budget: bigint) {
  if (!account.endsWith('.testnet') || !contract.endsWith('.testnet') || !ALLOWED_RPCS.includes(rpcUrl)) throw new Error('QA signer refuses non-testnet accounts, contracts or RPCs');
  if (budget < 0n || budget > MAX_BUDGET) throw new Error('QA signer budget must be at most 0.3 testnet NEAR');
}

/** Submit once without an RPC long-poll, then confirm the same hash. Never re-sign/repost. */
export async function finalizeQATransaction(
  provider: Pick<InstanceType<typeof providers.JsonRpcProvider>, 'sendTransactionUntil' | 'viewTransactionStatus'>,
  signed: Awaited<ReturnType<Account['createSignedTransaction']>>,
  hash: string, accountId: string, pollMs = 500,
) {
  try { await provider.sendTransactionUntil(signed, 'NONE'); } catch { /* A timeout can still mean accepted; query the hash. */ }
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const final = await provider.viewTransactionStatus(hash, accountId, 'NONE');
      if ((final as { final_execution_status?: string }).final_execution_status === 'FINAL') return final;
    } catch { /* Wait for indexing; do not submit a second transaction. */ }
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw { message: 'QA signer could not confirm the submitted transaction', transaction_outcome: { id: hash } };
}

export const setupQASigner = (): WalletModuleFactory<InjectedWallet> => async ({ options }) => {
  if (options.network.networkId !== 'testnet' || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('QA signer requires localhost on testnet');
  const seed = window.__XORV_QA_SIGNER__;
  delete window.__XORV_QA_SIGNER__;
  if (!seed) throw new Error('QA signer needs a Playwright-injected testnet credential');
  const { accountId, rpcUrl } = seed;
  const budget = BigInt(seed.budgetYocto);
  assertQATestnet(accountId, 'escrow.xorv-ikic2.testnet', rpcUrl, budget);
  let key: ReturnType<typeof KeyPair.fromString>;
  try { key = KeyPair.fromString(seed.privateKey as `ed25519:${string}`); }
  catch { throw new Error('QA signer credential is invalid'); }
  finally { seed.privateKey = ''; }
  const provider = new providers.JsonRpcProvider({ url: rpcUrl }, { retries: 2, wait: 500, backoff: 2 });
  const account = new Account(accountId, provider, new KeyPairSigner(key));
  let signedIn = false, charged = 0n, busy = false, contract = '';
  const accounts = () => signedIn ? [{ accountId, publicKey: key.getPublicKey().toString() }] : [];
  return {
    id: 'qa-signer', type: 'injected',
    metadata: { name: 'QA signer', description: QA_SIGNER_MARKER, iconUrl: '', downloadUrl: '', available: true, deprecated: false },
    async init({ emitter }) {
      async function signAndSendTransaction({ signerId, receiverId, actions }: SignAndSendTransactionParams) {
        if (!signedIn || (signerId && signerId !== accountId) || busy) throw new Error('QA signer is disconnected, busy or the signer does not match');
        assertQATestnet(accountId, receiverId ?? '', rpcUrl, budget);
        if (receiverId !== contract || actions.length !== 1 || actions[0].enum !== 'functionCall') throw new Error('QA signer only allows a single function call to its connected contract');
        const call = actions[0].functionCall!;
        if (!['post_compute', 'advance'].includes(call.methodName) || BigInt(call.gas) > 50_000_000_000_000n || BigInt(call.deposit) < 0n || (call.methodName === 'advance' && BigInt(call.deposit) !== 0n)) throw new Error('QA signer refuses this action');
        const cost = BigInt(call.deposit) + GAS_RESERVE;
        if (charged + cost > budget) throw new Error('QA signer spending cap reached');
        busy = true;
        try {
          const state = await provider.viewAccount(accountId, { finality: 'final' });
          if (BigInt(state.amount) < cost + 5n * 10n ** 22n) throw new Error('QA signer balance is too low');
          const signed = await account.createSignedTransaction(receiverId, [transactions.functionCall(call.methodName, call.args, BigInt(call.gas), BigInt(call.deposit))]);
          const hash = utils.serialize.base_encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(signed.transaction.encode()))));
          if (!window.__XORV_QA_RECORD__) throw new Error('QA signer requires a durable transaction recorder');
          // Reserve and record BEFORE broadcast; any uncertainty cannot silently fund a second post.
          charged += cost;
          await window.__XORV_QA_RECORD__({ hash, signer: accountId, receiver: receiverId, method: call.methodName, deposit: String(call.deposit) });
          return await finalizeQATransaction(provider, signed, hash, accountId);
        } finally { busy = false; }
      }
      const wallet = {
        async signIn({ contractId, methodNames }: { contractId: string; methodNames?: string[] }) {
          assertQATestnet(accountId, contractId, rpcUrl, budget);
          if (methodNames?.some((m) => m !== 'post_compute')) throw new Error('QA signer only connects for post_compute');
          contract = contractId; signedIn = true;
          emitter.emit('signedIn', { contractId, methodNames: methodNames ?? [], accounts: accounts() });
          return accounts();
        },
        async signOut() { signedIn = false; emitter.emit('signedOut', null); },
        async getAccounts() { return accounts(); },
        async getPublicKey() { return key.getPublicKey(); },
        async signNep413Message(): Promise<never> { throw new Error('QA signer only signs bounded contract calls'); },
        async signTransaction(): Promise<never> { throw new Error('QA signer only signs bounded contract calls'); },
        async signDelegateAction(): Promise<never> { throw new Error('QA signer does not delegate'); },
        async verifyOwner(): Promise<void> { throw new Error('QA signer does not support owner verification'); },
        signAndSendTransaction,
        async signAndSendTransactions({ transactions: txs }: { transactions: SignAndSendTransactionParams[] }) {
          const results = [];
          for (const tx of txs) results.push(await signAndSendTransaction(tx));
          return results;
        },
      };
      window.__XORV_QA_WALLET__ = wallet;
      return wallet;
    },
  };
};
