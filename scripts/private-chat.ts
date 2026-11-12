// A buyer spends private eERC credit: sign (no gas) -> the desk posts the job under its own address ->
// the answer arrives -> unused escrow returns to the buyer's private credit.
//   XORV_NETWORK=fuji node scripts/private-chat.ts "question"
import { privateKeyToAccount } from 'viem/accounts';
import { chatMessage, creditMessage, requestHash } from '../packages/sdk/src/private.ts';
import { keyByName } from '../packages/sdk/src/node.ts';
import { recordEvidence } from './lib.ts';

const gateway = process.env.XORV_GATEWAY ?? 'http://127.0.0.1:5421';
const network = process.env.XORV_NETWORK ?? 'fuji';
const question = process.argv[2] ?? 'In one sentence, why would a company hide how much it spends on AI?';
const buyer = privateKeyToAccount(keyByName(process.env.XORV_PAY_AS ?? 'XORV_BUYER_KEY'));

async function credit() {
  const ts = Math.floor(Date.now() / 1000);
  const signature = await buyer.signMessage({ message: creditMessage(buyer.address, ts) });
  const r = await fetch(`${gateway}/api/private/credit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: buyer.address, ts, signature }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? r.status);
  return j;
}

async function main() {
  const c0 = await credit();
  console.log(`private credit ${Number(c0.credit) / 1e6} tUSD from ${c0.topups.length} encrypted top-up(s)`);
  const request = { model: 'groq:openai/gpt-oss-20b', messages: [{ role: 'user', content: question }], max_tokens: 1200 };
  const ts = Math.floor(Date.now() / 1000);
  const signature = await buyer.signMessage({ message: chatMessage(buyer.address, ts, requestHash(request)) });
  const r = await fetch(`${gateway}/api/private/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: buyer.address, ts, signature, request }) });
  const posted = await r.json();
  if (!r.ok) throw new Error(posted.error?.message ?? r.status);
  console.log(`job #${posted.job} posted by the desk ${posted.postedBy}, not by ${buyer.address}: ${posted.explorer}`);
  let job: any;
  for (;;) {
    job = (await (await fetch(`${gateway}/api/jobs/${posted.job}`)).json()).job;
    if (['Done', 'Faulted', 'Expired'].includes(job.status)) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  const c1 = await credit();
  console.log(`job ${job.status}, charged ${job.charge} micro-tUSD; private credit now ${Number(c1.credit) / 1e6} tUSD`);
  recordEvidence(network, 'privateChats', { job: posted.job, postTx: posted.tx, postedBy: posted.postedBy, buyerOnChain: job.buyer, creditBefore: c0.credit, creditAfter: c1.credit, charge: job.charge });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
