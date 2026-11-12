import test from 'node:test';
import assert from 'node:assert/strict';
import { assertQATestnet, finalizeQATransaction } from '../src/lib/qa-signer.ts';

test('QA signer refuses mainnet accounts, RPCs, contracts and budgets above the hard cap', () => {
  const check = (account = 'buyer.testnet', contract = 'escrow.testnet', rpc = 'https://near-testnet.drpc.org', budget = 3n * 10n ** 23n) => assertQATestnet(account, contract, rpc, budget);
  assert.doesNotThrow(() => check());
  assert.throws(() => check('buyer.near'), /non-testnet/);
  assert.throws(() => check('a'.repeat(64)), /non-testnet/);
  assert.throws(() => check(undefined, 'escrow.near'), /non-testnet/);
  for (const rpc of ['https://rpc.mainnet.near.org', 'https://evil.testnet.example', 'http://near-testnet.drpc.org']) assert.throws(() => check(undefined, undefined, rpc), /non-testnet/);
  assert.throws(() => check(undefined, undefined, undefined, 3n * 10n ** 23n + 1n), /budget/);
  assert.doesNotThrow(() => check(undefined, undefined, undefined, 0n)); // Exhausted sessions may connect read-only.
  assert.throws(() => check(undefined, undefined, undefined, -1n), /budget/);
});


test('QA finality polling recovers an uncertain broadcast without another send', async () => {
  let sends = 0, reads = 0;
  const final = { final_execution_status: 'FINAL', status: { SuccessValue: 'MA==' } };
  const provider = {
    async sendTransactionUntil(_signed: unknown, wait: string) { sends++; assert.equal(wait, 'NONE'); throw new Error('RPC response lost'); },
    async viewTransactionStatus(hash: string, buyer: string, wait: string) {
      assert.equal(hash, 'public-hash'); assert.equal(buyer, 'buyer.testnet'); assert.equal(wait, 'NONE');
      reads++;
      if (reads === 1) throw new Error('not indexed yet');
      return reads === 2 ? { final_execution_status: 'INCLUDED' } : final;
    },
  };
  assert.equal(await finalizeQATransaction(provider as never, {} as never, 'public-hash', 'buyer.testnet', 0), final);
  assert.equal(sends, 1); assert.equal(reads, 3);
});
