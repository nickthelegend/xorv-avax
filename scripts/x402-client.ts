// A buyer agent paying for one answer with x402: POST without payment -> 402 + requirements ->
// sign EIP-3009 with the buyer key -> retry with X-PAYMENT -> answer + X-PAYMENT-RESPONSE.
//   node scripts/x402-client.ts "question" [--verify] [--model groq:openai/gpt-oss-20b]
import { privateKeyToAccount } from 'viem/accounts';
import { encodePayment, signPayment, type PaymentRequirements } from '../packages/sdk/src/x402.ts';
import { keyByName } from '../packages/sdk/src/node.ts';
import { recordEvidence } from './lib.ts';

const args = process.argv.slice(2);
const question = args.find((a) => !a.startsWith('--')) ?? 'In two sentences: why do sealed-bid auctions make price discovery honest?';
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'groq:openai/gpt-oss-20b';
const gateway = process.env.XORV_GATEWAY ?? 'http://127.0.0.1:5421';
const network = process.env.XORV_NETWORK ?? 'fuji';
const body = { model, messages: [{ role: 'user', content: question }], max_tokens: 1200, xorv: { verify: args.includes('--verify') } };

async function main() {
  const buyer = privateKeyToAccount(keyByName(process.env.XORV_PAY_AS ?? 'XORV_BUYER_KEY'));
  const url = `${gateway}/v1/chat/completions`;
  const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const challenge = await first.json();
  if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${JSON.stringify(challenge).slice(0, 300)}`);
  const req: PaymentRequirements = challenge.accepts[0];
  console.log(`402 Payment Required · ${req.maxAmountRequired} micro-tUSD to ${req.payTo} on ${req.network}`);
  const payment = await signPayment(buyer, req);
  console.log(`signed EIP-3009 authorization from ${buyer.address} (nonce ${payment.payload.authorization.nonce.slice(0, 10)}…)`);
  const t0 = Date.now();
  const paid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': encodePayment(payment) }, body: JSON.stringify(body) });
  const out = await paid.json();
  const receipt = paid.headers.get('x-payment-response');
  if (!paid.ok) throw new Error(`HTTP ${paid.status}: ${JSON.stringify(out).slice(0, 400)}`);
  const settle = receipt ? JSON.parse(Buffer.from(receipt, 'base64').toString()) : null;
  console.log(`\n${out.choices[0].message.content}\n`);
  console.log(`job #${out.xorv.job} · ${out.xorv.bids} sealed bids · cleared ${out.xorv.cleared_rate_per_1k} micro-tUSD per 1k tokens · ${out.usage.total_tokens} tokens · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`settlement ${out.xorv.explorer}`);
  recordEvidence(network, 'x402Calls', { job: out.xorv.job, settleTx: settle?.transaction, payer: buyer.address, value: req.maxAmountRequired, rate: out.xorv.cleared_rate_per_1k, tokens: out.usage.total_tokens, bids: out.xorv.bids, verify: body.xorv.verify, seconds: (Date.now() - t0) / 1000 });

  // Replaying the same payment must fail.
  const replay = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': encodePayment(payment) }, body: JSON.stringify(body) });
  console.log(`replay of the same X-PAYMENT -> HTTP ${replay.status}: ${(await replay.json()).error?.message}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
