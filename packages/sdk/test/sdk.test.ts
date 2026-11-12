// Runs against the local Anvil chain started by scripts/test-local.sh (real contracts, no mocks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { XorvReader, bidCommitment, packPrompt, similarityBps, signPayment, verifyPayment, X402Error, xorvMarketAbi, testDollarAbi, type PaymentRequirements } from '../src/index.ts';
import { loadDeployment, walletFor } from '../src/node.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/node.ts';

const d = loadDeployment();
const r = new XorvReader(d, process.env.XORV_RPC);

const TEXTS = [
  'Sealed bids hide each price until every bidder has committed.',
  'SEALED bids — hide each PRICE until every bidder has committed!',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Höher, schneller, weiter: naïve café déjà vu 日本語 テスト',
  '',
  '1 2 3 4 5 6 7 8 9 10 a b c d e f',
  'x'.repeat(5000),
];

test('similarity in TypeScript matches the on-chain Similarity library byte for byte', async () => {
  const abi = JSON.parse(readFileSync(path.join(ROOT, 'contracts/out/Similarity.sol/Similarity.json'), 'utf8')).abi;
  for (const a of TEXTS) {
    for (const b of TEXTS) {
      const onchain = (await r.client.readContract({ address: d.contracts.similarity, abi, functionName: 'jaccardBps', args: [new TextEncoder().encode(a), new TextEncoder().encode(b)].map((u) => `0x${Buffer.from(u).toString('hex')}`) })) as bigint;
      assert.equal(similarityBps(a, b), Number(onchain), `mismatch for ${JSON.stringify(a.slice(0, 20))} vs ${JSON.stringify(b.slice(0, 20))}`);
    }
  }
});

test('bid commitment matches XorvMarket.bidCommitment', async () => {
  const node = privateKeyToAccount(generatePrivateKey()).address;
  const salt = `0x${'ab'.repeat(32)}` as const;
  const onchain = await r.client.readContract({ address: d.contracts.market, abi: xorvMarketAbi, functionName: 'bidCommitment', args: [7n, node, 333n, salt] });
  assert.equal(bidCommitment(d.chainId, d.contracts.market, 7, node, 333n, salt), onchain);
});

function requirements(): PaymentRequirements {
  return { scheme: 'exact', network: 'anvil-local', maxAmountRequired: '2800', resource: 'http://x/v1/chat/completions', description: '', mimeType: 'application/json', payTo: d.contracts.router, maxTimeoutSeconds: 300, asset: d.contracts.testDollar, extra: { name: 'Xorv Test Dollar', version: '1', chainId: d.chainId } };
}

test('x402 payment signs EIP-3009 and verifies; tampering is caught off-chain', async () => {
  const buyer = privateKeyToAccount(generatePrivateKey());
  const req = requirements();
  const p = await signPayment(buyer, req);
  const a = await verifyPayment(p, req);
  assert.equal(a.from, buyer.address);
  const more = structuredClone(p);
  more.payload.authorization.value = '999999';
  await assert.rejects(verifyPayment(more, { ...req, maxAmountRequired: '2800' }), X402Error, 'raised amount breaks the signature');
  await assert.rejects(verifyPayment(p, { ...req, payTo: buyer.address }), /payTo/);
  await assert.rejects(verifyPayment(p, { ...req, maxAmountRequired: '5000' }), /below/);
  const old = await signPayment(buyer, req, { now: Math.floor(Date.now() / 1000) - 10_000, validFor: 60 });
  await assert.rejects(verifyPayment(old, req), /expired/);
  await assert.rejects(verifyPayment({ ...p, network: 'base' }, req), /network|payment is for/);
});

test('the token accepts the SDK signature on-chain (the domain is right)', async () => {
  const req = requirements();
  const buyer = walletFor(d, 'XORV_BUYER_KEY', process.env.XORV_RPC);
  const p = await signPayment(buyer.account, { ...req, payTo: privateKeyToAccount(generatePrivateKey()).address, maxAmountRequired: '1' });
  const a = p.payload.authorization;
  const sig = p.payload.signature;
  const hash = await buyer.writeContract({
    address: d.contracts.testDollar,
    abi: testDollarAbi,
    functionName: 'transferWithAuthorization',
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(`0x${sig.slice(130, 132)}`), `0x${sig.slice(2, 66)}`, `0x${sig.slice(66, 130)}`],
  });
  const rc = await buyer.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, 'success');
  assert.equal(await r.authorizationUsed(a.from, a.nonce), true);
});

test('packPrompt keeps the newest turns and requires a user turn last', () => {
  assert.equal(packPrompt([{ role: 'user', content: 'hi' }]), 'hi');
  const long = Array.from({ length: 50 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `turn ${i} `.repeat(30) }));
  long.push({ role: 'user', content: 'last question' });
  const p = packPrompt(long);
  assert.ok(new TextEncoder().encode(p).length <= 4000);
  assert.match(p, /User: last question\n\nAssistant:$/);
  assert.throws(() => packPrompt([{ role: 'assistant', content: 'x' }]), /last message/);
  assert.throws(() => packPrompt([{ role: 'user', content: 'x'.repeat(4001) }]), /longer/);
});

test('reader decodes market and registry state from the chain', async () => {
  const ps = await r.providers();
  assert.equal(ps.length, 4);
  assert.deepEqual(ps.map((p) => p.label).sort(), ['atlas', 'birch', 'cobalt', 'dune']);
  assert.equal(await r.escrowFor(2000n, 1200), 2400n + 400n);
});
