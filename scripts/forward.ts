// Compute forwards against the Xorv Compute Index on Fuji.
//   node scripts/forward.ts deploy
//   node scripts/forward.ts open <minutes>   buyer goes long, provider owner (atlas) goes short, strike = index now
//   node scripts/forward.ts settle <id>
import { xorvIndexAbi } from '../packages/sdk/src/abi.ts';
import { modelId } from '../packages/sdk/src/reader.ts';
import { loadDeployment, walletFor } from '../packages/sdk/src/node.ts';
import { artifact, deploy, deploymentPath, readJson, recordEvidence, send, writeJson } from './lib.ts';

const MODEL = 'groq:openai/gpt-oss-20b';
const [cmd, arg] = process.argv.slice(2);
const file = deploymentPath('fuji');
const d = loadDeployment(file);
const fa = artifact('XorvForward.sol', 'XorvForward');
const tokenAbi = artifact('TestDollar.sol', 'TestDollar').abi;

async function main() {
  if (cmd === 'deploy') {
    const w = walletFor(d, 'XORV_DEPLOYER_KEY');
    const f = await deploy(w, fa, [d.contracts.testDollar, d.contracts.index], {}, 'XorvForward');
    const j = readJson(file);
    j.contracts.forward = f.address;
    j.deployTxs.forward = f;
    writeJson(file, j);
    return;
  }
  const fwd = (d.contracts as any).forward as `0x${string}`;
  if (!fwd) throw new Error('Setup required: node scripts/forward.ts deploy');
  if (cmd === 'open') {
    const long = walletFor(d, 'XORV_BUYER_KEY');
    const short = walletFor(d, 'XORV_OWNER_ATLAS_KEY');
    const [rate] = (await long.readContract({ address: d.contracts.index, abi: xorvIndexAbi, functionName: 'latest', args: [modelId(MODEL)] })) as readonly [bigint, bigint, bigint];
    if (rate === 0n) throw new Error('the index has no clearings for this model yet');
    for (const w of [long, short]) await send(w, { address: d.contracts.testDollar, abi: tokenAbi, functionName: 'approve', args: [fwd, 2n ** 255n] }, `approve forward (${w.account.address.slice(0, 8)})`);
    const minutes = BigInt(arg ?? '20');
    const sim = await long.simulateContract({ address: fwd, abi: fa.abi, functionName: 'offer', args: [MODEL, true, rate, 10_000_000n, 2_000_000n, minutes * 60n], account: long.account });
    const offer = await send(long, sim.request, `offer long 10M tokens at ${rate}/1k`);
    const id = sim.result as bigint;
    const take = await send(short, { address: fwd, abi: fa.abi, functionName: 'take', args: [id] }, `take short #${id}`);
    recordEvidence('fuji', 'forwards', { id: Number(id), model: MODEL, strike: rate.toString(), notionalTokens: 10_000_000, margin: '2000000', minutes: Number(minutes), long: long.account.address, short: short.account.address, offerTx: offer.tx, takeTx: take.tx });
    console.log(`forward #${id}: buyer long, atlas short, strike ${rate} micro per 1k, expires in ${minutes} min`);
    return;
  }
  if (cmd === 'settle') {
    const w = walletFor(d, 'XORV_DEPLOYER_KEY');
    const r = await send(w, { address: fwd, abi: fa.abi, functionName: 'settle', args: [BigInt(arg)] }, `settle #${arg}`);
    const f: any = await w.readContract({ address: fwd, abi: fa.abi, functionName: 'getForward', args: [BigInt(arg)] });
    console.log(`settled at index TWAP ${f.settleRate} vs strike ${f.strike}: payoff to long ${f.payoffToLong} micro-tUSD`);
    recordEvidence('fuji', 'forwardSettlements', { id: Number(arg), settleTx: r.tx, settleRate: String(f.settleRate), strike: String(f.strike), payoffToLong: String(f.payoffToLong) });
    return;
  }
  throw new Error('usage: forward.ts deploy | open <minutes> | settle <id>');
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
