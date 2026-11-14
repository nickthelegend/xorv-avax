// Live test against the Anthropic API (needs ANTHROPIC_API_KEY; skipped with a "Setup required" note otherwise):
//   node --env-file ~/.config/grokbot/anthropic.env --test packages/node/test/claude.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkModel, runModel } from '../src/providers.ts';
import { similarityBps } from '../../sdk/src/similarity.ts';

const M = 'anthropic:claude-haiku-5-5';
const Q = 'In one sentence: why does a deposit keep a seller honest?';
const JUNK = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. (xorv fault injection: this node returns junk on purpose)';
const skip = process.env.ANTHROPIC_API_KEY ? false : 'Setup required: ANTHROPIC_API_KEY';

test('Claude: an honest answer passes the review check (100%), junk fails it', { skip }, async () => {
  const a = await runModel(M, Q, { maxTokens: 300 });
  assert.ok(a.text.length > 20 && a.tokens > 0);
  const ok = await checkModel(M, Q, a.text, { maxTokens: 300 });
  assert.equal(ok.reviewed, true);
  assert.equal(ok.agreed, true, `reviewer disagreed with an honest answer: ${ok.text}`);
  assert.equal(similarityBps(a.text, ok.text), 10000);
  const bad = await checkModel(M, Q, JUNK, { maxTokens: 300 });
  assert.equal(bad.agreed, false);
  assert.ok(similarityBps(JUNK, bad.text) < 1000, `junk scored ${similarityBps(JUNK, bad.text)} bps`);
});

// Job #76 on Fuji (Nov 14): an honest answer that questions the premise. The first reviewer prompt rejected it, the
// tiebreaker sided with the provider and the checker was slashed; the reviewer now accepts reasonable answers.
const Q76 = "In two sentences: why do sealed-bid auctions keep prices honest?";
const A76 = "They don't, in general: sealed-bid auctions tend to push bidders to shade their bids below their true values, since winning at a price close to their own bid is what matters, so prices are not necessarily \"honest\" in the sense of reflecting true worth. What they do offer is that no bidder can see or react to rivals' bids, which limits collusion-by-signaling and bidding wars, and under certain conditions (such as the Vickrey second-price variant) truthful bidding becomes the best strategy.";
test('Claude: the review accepts an honest answer that questions the premise (job #76)', { skip }, async () => {
  const c = await checkModel(M, Q76, A76, { maxTokens: 400 });
  assert.equal(c.agreed, true, `rejected: ${c.text.slice(0, 200)}`);
});

test('Claude: a missing key fails loudly', async () => {
  const k = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try { await assert.rejects(runModel(M, Q, { maxTokens: 10 }), /Setup required: ANTHROPIC_API_KEY/); } finally { if (k) process.env.ANTHROPIC_API_KEY = k; }
});
