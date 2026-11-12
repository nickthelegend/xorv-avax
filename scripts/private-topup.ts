// Buyer tops up the Xorv desk with an encrypted eERC transfer (deposits public tUSD first if needed).
//   XORV_NETWORK=fuji node scripts/private-topup.ts 0.5
import { parseUnits, formatUnits } from 'viem';
import { walletFor } from '../packages/sdk/src/node.ts';
import { Eerc, shutdownProver } from '../packages/eerc/src/index.ts';
import { deploymentPath, readJson, recordEvidence } from './lib.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const d = readJson(deploymentPath(network));
const amount = parseUnits(process.argv[2] ?? '0.5', 6);

async function main() {
  if (!d.eerc?.desk) throw new Error('Setup required: run node scripts/private-lane.ts first (desk and auditor registration)');
  const buyer = await new Eerc(d, walletFor(d, process.env.XORV_PAY_AS ?? 'XORV_BUYER_KEY', process.env.XORV_RPC)).init();
  const reg = await buyer.register();
  if (reg) console.log(`registered ${reg}`);
  let bal = await buyer.balance();
  let deposit = null;
  if (bal.amount < amount) {
    deposit = await buyer.deposit(amount * 4n);
    console.log(`deposited ${formatUnits(amount * 4n, 6)} tUSD (public amount) ${deposit}`);
    bal = await buyer.balance();
  }
  const t0 = Date.now();
  const tx = await buyer.transfer(d.eerc.desk, amount);
  console.log(`private top-up to the desk (amount hidden on-chain): ${tx} · proof + tx ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`your encrypted balance, decrypted locally: ${formatUnits((await buyer.balance()).amount, 6)} tUSD`);
  recordEvidence(network, 'privateTopups', { from: buyer.address, to: d.eerc.desk, tx, deposit, amountKnownOnlyToSenderDeskAuditor: true });
  await shutdownProver();
}

main().catch(async (e) => {
  console.error(e.shortMessage ?? e.message);
  await shutdownProver();
  process.exit(1);
});
