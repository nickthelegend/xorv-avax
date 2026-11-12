// Posts one job from the buyer account (ERC-20 allowance path) and follows it until it closes.
//   XORV_NETWORK=local node scripts/post-job.ts "your prompt" [--check] [--model groq:openai/gpt-oss-20b]
import { testDollarAbi, xorvMarketAbi } from '../packages/sdk/src/abi.ts';
import { XorvReader } from '../packages/sdk/src/reader.ts';
import { OUTCOME_TEXT } from '../packages/sdk/src/types.ts';
import { walletFor } from '../packages/sdk/src/node.ts';
import { deploymentPath, readJson, recordEvidence, send } from './lib.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const d = readJson(deploymentPath(network));
const args = process.argv.slice(2);
const prompt = args.find((a) => !a.startsWith('--')) ?? 'In one sentence, what does a sealed-bid auction hide?';
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'groq:openai/gpt-oss-20b';
const check = args.includes('--check');
const key = process.env.XORV_POST_AS ?? 'XORV_BUYER_KEY';

async function main() {
  const w = walletFor(d, key, process.env.XORV_RPC);
  const r = new XorvReader(d, process.env.XORV_RPC);
  const allowance = (await w.readContract({ address: d.contracts.testDollar, abi: testDollarAbi, functionName: 'allowance', args: [w.account.address, d.contracts.market] })) as bigint;
  if (allowance < 10n ** 9n) await send(w, { address: d.contracts.testDollar, abi: testDollarAbi, functionName: 'approve', args: [d.contracts.market, 2n ** 255n] }, 'approve market');
  const params = { model, prompt, maxRate: 2000n, maxTokens: 1200, commitSecs: 6, revealSecs: 6, workSecs: 90, alwaysCheck: check };
  const { result: id } = await w.simulateContract({ address: d.contracts.market, abi: xorvMarketAbi, functionName: 'postJob', args: [params], account: w.account });
  const posted = await send(w, { address: d.contracts.market, abi: xorvMarketAbi, functionName: 'postJob', args: [params] }, `post job #${id}`);
  let last = '';
  for (;;) {
    const j = await r.job(Number(id));
    const line = `${j.status} bids=${j.bidCount} revealed=${j.revealed} rate=${j.clearedRate} tokens=${j.tokens}`;
    if (line !== last) console.log(`  #${id} ${line}`);
    last = line;
    if (['Done', 'Faulted', 'Expired'].includes(j.status)) {
      console.log(`  ${OUTCOME_TEXT[j.outcome]} charge ${j.charge} micro-tUSD`);
      recordEvidence(network, 'jobs', { job: Number(id), post: posted.tx, status: j.status, outcome: j.outcome, rate: j.clearedRate.toString(), tokens: j.tokens, charge: j.charge.toString(), check });
      return;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
