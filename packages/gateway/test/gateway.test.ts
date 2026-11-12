// The gateway as x402 facilitator and private desk, run as a real process against the local Anvil
// chain (scripts/test-local.sh). Provider nodes are not started; these tests stop at the posted job.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { XorvReader, chatMessage, creditMessage, encodePayment, requestHash, signPayment, type PaymentRequirements } from '@xorv/sdk';
import { ROOT, keyByName, loadDeployment, walletFor } from '@xorv/sdk/node';
import { Eerc, shutdownProver } from '@xorv/eerc';

const d = loadDeployment();
const PORT = 5547;
const base = `http://127.0.0.1:${PORT}`;
const reader = new XorvReader(d, process.env.XORV_RPC);
const buyer = privateKeyToAccount(keyByName('XORV_BUYER_KEY'));
const body = { model: 'groq:openai/gpt-oss-20b', messages: [{ role: 'user', content: 'test question' }], max_tokens: 800 };
let gw: ChildProcess;

before(async () => {
  gw = spawn(process.execPath, [path.join(ROOT, 'packages/gateway/src/server.ts')], {
    cwd: ROOT,
    env: { ...process.env, XORV_GATEWAY_PORT: String(PORT), XORV_EXTERNAL_NODES: '1', XORV_GATEWAY_STATE: `.xorv/test-gw-${Date.now()}`, GROQ_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gw.stderr?.on('data', (b) => process.stderr.write(`[gateway] ${b}`));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('gateway did not start');
});
after(async () => {
  gw?.kill('SIGTERM');
  await shutdownProver();
});

const errText = (j: any): string => (typeof j.error === 'string' ? j.error : j.error?.message ?? '');
const post = (p: string, b: unknown, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });

async function challenge(): Promise<PaymentRequirements> {
  const r = await post('/v1/chat/completions', body);
  assert.equal(r.status, 402);
  const j = await r.json();
  assert.equal(j.x402Version, 1);
  return j.accepts[0];
}

test('an unpaid call gets HTTP 402 with exact-scheme requirements on the router', async () => {
  const req = await challenge();
  assert.equal(req.scheme, 'exact');
  assert.equal(req.payTo.toLowerCase(), d.contracts.router.toLowerCase());
  assert.equal(req.asset.toLowerCase(), d.contracts.testDollar.toLowerCase());
  assert.equal(req.maxAmountRequired, (await reader.escrowFor(2000n, 800)).toString());
  assert.equal(req.extra.name, 'Xorv Test Dollar');
});

test('garbage, underpaid and expired payments are refused before any gas is spent', async () => {
  const req = await challenge();
  assert.equal((await post('/api/chat', body, { 'x-payment': 'not-base64-json' })).status, 400);
  const low = await signPayment(buyer, { ...req, maxAmountRequired: '1' });
  const r1 = await post('/api/chat', body, { 'x-payment': encodePayment(low) });
  assert.equal(r1.status, 402);
  assert.match(errText(await r1.json()), /below/);
  const old = await signPayment(buyer, req, { now: Math.floor(Date.now() / 1000) - 3600, validFor: 60 });
  assert.equal((await post('/api/chat', body, { 'x-payment': encodePayment(old) })).status, 402);
  const broke = privateKeyToAccount(generatePrivateKey());
  const r3 = await post('/api/chat', body, { 'x-payment': encodePayment(await signPayment(broke, req)) });
  assert.equal(r3.status, 402);
  assert.match(errText(await r3.json()), /faucet|holds/);
});

test('a valid payment settles on-chain into a job the payer owns, and its replay is rejected', async () => {
  const req = await challenge();
  const p = await signPayment(buyer, req);
  const before = await reader.tokenBalance(buyer.address);
  const r = await post('/api/chat', body, { 'x-payment': encodePayment(p) });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  const settle = JSON.parse(Buffer.from(r.headers.get('x-payment-response')!, 'base64').toString());
  assert.equal(settle.success, true);
  assert.equal(settle.transaction, j.tx);
  const job = await reader.job(j.job);
  assert.equal(job.buyer.toLowerCase(), buyer.address.toLowerCase());
  assert.equal(job.viaX402, true);
  assert.equal(job.status, 'Bidding');
  assert.equal(await reader.tokenBalance(buyer.address), before - BigInt(req.maxAmountRequired));
  const again = await post('/api/chat', body, { 'x-payment': encodePayment(p) });
  assert.equal(again.status, 409, 'replay');
  assert.equal(await reader.jobCount(), j.job + 1, 'no second job');
});

test('a model no staked node serves is refused', async () => {
  const r = await post('/v1/chat/completions', { ...body, model: 'groq:not-a-model' });
  assert.equal(r.status, 400);
});

test('private credit: signatures are checked, credit comes only from attributed encrypted top-ups', async () => {
  const ts = Math.floor(Date.now() / 1000);
  const wrong = privateKeyToAccount(generatePrivateKey());
  const bad = await post('/api/private/credit', { address: buyer.address, ts, signature: await wrong.signMessage({ message: creditMessage(buyer.address, ts) }) });
  assert.equal(bad.status, 401);
  const stale = ts - 3600;
  assert.equal((await post('/api/private/credit', { address: buyer.address, ts: stale, signature: await buyer.signMessage({ message: creditMessage(buyer.address, stale) }) })).status, 401);

  // the buyer tops up the desk privately (real transfer proof)
  const e = await new Eerc(d, walletFor(d, 'XORV_BUYER_KEY', process.env.XORV_RPC)).init();
  await e.register();
  if ((await e.balance()).amount < 500_000n) await e.deposit(1_000_000n);
  await e.transfer(d.eerc!.desk ?? privateKeyToAccount(keyByName('XORV_DESK_KEY')).address, 400_000n);

  const t2 = Math.floor(Date.now() / 1000);
  const c = await post('/api/private/credit', { address: buyer.address, ts: t2, signature: await buyer.signMessage({ message: creditMessage(buyer.address, t2) }) });
  assert.equal(c.status, 200);
  const credit = await c.json();
  assert.equal(credit.credit, '400000', 'exactly the encrypted top-up, decrypted by the desk');

  const request = { model: body.model, messages: body.messages, max_tokens: 800 };
  const t3 = Math.floor(Date.now() / 1000);
  const sig = await buyer.signMessage({ message: chatMessage(buyer.address, t3, requestHash(request)) });
  const r = await post('/api/private/chat', { address: buyer.address, ts: t3, signature: sig, request });
  assert.equal(r.status, 200, await r.clone().text());
  const posted = await r.json();
  const job = await reader.job(posted.job);
  assert.notEqual(job.buyer.toLowerCase(), buyer.address.toLowerCase(), 'the public job does not name the buyer');
  assert.equal(job.buyer.toLowerCase(), posted.postedBy.toLowerCase());
  assert.equal(BigInt(posted.creditLeft), 400_000n - BigInt(posted.escrow));
  assert.equal((await post('/api/private/chat', { address: buyer.address, ts: t3, signature: sig, request })).status, 409, 'signed request replay');
  const tampered = { ...request, max_tokens: 4000 };
  assert.equal((await post('/api/private/chat', { address: buyer.address, ts: t3, signature: sig, request: tampered })).status, 401, 'signature covers the request');
});
