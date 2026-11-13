// Read-only checks against the live Fuji deployment and the hosted gateway (real network, no mocks, nothing paid).
//   node --test packages/sdk/test/fuji.test.ts      (XORV_GATEWAY overrides https://xorv-avax.vercel.app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Xorv, XorvError, XorvReader, verifyJob } from '../src/index.ts';
import { loadDeployment } from '../src/node.ts';

const d = loadDeployment();
const r = new XorvReader(d, process.env.XORV_RPC);
const gateway = process.env.XORV_GATEWAY ?? 'https://xorv-avax.vercel.app';

test('verifyJob: the honest job #57 checks out from the chain alone (lowest bid won, check recomputed, money adds up)', async () => {
  const v = await verifyJob(r, 57);
  assert.equal(v.job.outcome, 'PaidCheckMatched');
  assert.ok(v.ok, v.lines.filter((l) => !l.ok).map((l) => l.text).join('; '));
  assert.deepEqual(v.lines.map((l) => l.key), ['prompt', 'auction', 'answer', 'check', 'verdict', 'money']);
});

test('verifyJob: the liar of job #58 was slashed to the buyer, and the 0% scores recompute exactly', async () => {
  const v = await verifyJob(r, 58);
  assert.equal(v.job.outcome, 'FaultedTiebreakSidedWithChecker');
  assert.ok(v.ok);
  const slash = v.lines.find((l) => l.key === 'slash');
  assert.match(slash!.text, /liar slashed \$0\.50 of stake, paid to the buyer/);
  assert.equal(v.lines.filter((l) => l.key === 'check').length, 2);
});

test('verifyJob: a checker contradicted by the tiebreaker (job #61) pays the provider, not the buyer', async () => {
  const v = await verifyJob(r, 61);
  assert.equal(v.job.outcome, 'PaidTiebreakSidedWithProvider');
  assert.ok(v.ok);
  assert.match(v.lines.find((l) => l.key === 'slash')!.text, /\(the checker\).*the provider it contradicted/);
});

test('Xorv client: quote reads the real x402 requirements and the index price without paying', async () => {
  const q = await new Xorv({ gateway }).quote('In one sentence: what is a sealed bid?', { verify: true });
  assert.equal(q.requirements.scheme, 'exact');
  assert.equal(q.requirements.network, 'avalanche-fuji');
  assert.equal(q.requirements.payTo.toLowerCase(), d.contracts.router.toLowerCase());
  assert.equal(q.maxAmount, q.maxRate * BigInt(q.maxTokens) / 1000n + 2n * BigInt(d.config.checkFee));
  assert.ok(q.nodes >= 2 && q.indexRate !== null && q.indexRate > 0n);
});

test('Xorv client: paying without an account fails loudly with "Setup required"', async () => {
  await assert.rejects(new Xorv({ gateway }).chat('hello'), (e: unknown) => e instanceof XorvError && /Setup required/.test((e as Error).message));
});

test('Xorv client: an unserved model is refused by the gateway with its reason', async () => {
  await assert.rejects(new Xorv({ gateway }).quote('hi', { model: 'groq:nope/none' }), (e: unknown) => e instanceof XorvError && (e as XorvError).status === 400 && /no staked node serves/.test((e as Error).message));
});
