// The eERC private credit lane, end to end, with real proofs and real transactions:
//   1. the auditor registers its eERC key and the deployer sets it as the eERC auditor
//   2. the buyer and the Xorv desk register
//   3. the buyer deposits tUSD (public amount) and privately tops up the desk (hidden amount)
//   4. the desk decrypts what it received; the auditor decrypts the same amount from the event
//   5. a provider owner sweeps public earnings into eERC and pays its treasury privately
//   6. the desk withdraws to fund public escrows
//   XORV_NETWORK=fuji node scripts/private-lane.ts
import { formatUnits, type Hex } from 'viem';
import { encryptedErcAbi } from '../packages/sdk/src/abi.ts';
import { walletFor } from '../packages/sdk/src/node.ts';
import { Eerc, shutdownProver } from '../packages/eerc/src/index.ts';
import { deploymentPath, readJson, recordEvidence, send, writeJson } from './lib.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const file = deploymentPath(network);
const d = readJson(file);
const rpc = process.env.XORV_RPC ?? d.rpc;
const fmt = (v: bigint) => `${formatUnits(v, 6)} tUSD`;
const steps: Record<string, unknown> = {};
const t = (label: string, hash: Hex | null) => {
  if (!hash) return console.log(`  ${label}: already done`);
  steps[label] = hash;
  console.log(`  ${label.padEnd(36)} ${d.chainId === 43113 ? `https://testnet.snowtrace.io/tx/${hash}` : hash}`);
};

async function main() {
  const auditor = await new Eerc(d, walletFor(d, 'XORV_AUDITOR_KEY', rpc)).init();
  const buyer = await new Eerc(d, walletFor(d, 'XORV_BUYER_KEY', rpc)).init();
  const desk = await new Eerc(d, walletFor(d, 'XORV_DESK_KEY', rpc)).init();
  const owner = await new Eerc(d, walletFor(d, 'XORV_OWNER_ATLAS_KEY', rpc)).init();
  const treasury = await new Eerc(d, walletFor(d, 'XORV_QA_KEY', rpc)).init();
  const deployer = walletFor(d, 'XORV_DEPLOYER_KEY', rpc);

  console.log('1. auditor');
  t('auditor registers', await auditor.register());
  const set = (await deployer.readContract({ address: d.eerc.encryptedERC, abi: encryptedErcAbi, functionName: 'isAuditorKeySet' })) as boolean;
  if (!set) t('deployer sets auditor key', (await send(deployer, { address: d.eerc.encryptedERC, abi: encryptedErcAbi, functionName: 'setAuditorPublicKey', args: [auditor.address] }, 'setAuditorPublicKey')).tx as Hex);
  d.eerc.auditor = auditor.address;
  d.eerc.desk = desk.address;
  writeJson(file, d);

  console.log('2. register buyer, desk, provider owner, treasury (Groth16 proofs made here)');
  for (const [n, u] of [['buyer', buyer], ['desk', desk], ['provider owner (atlas)', owner], ['provider treasury', treasury]] as const) t(`${n} registers`, await u.register());

  console.log('3. buyer funds private credit');
  t('buyer deposits 5 tUSD (public)', await buyer.deposit(5_000_000n));
  const before = (await desk.balance()).amount;
  t('buyer -> desk private top-up', await buyer.transfer(desk.address, 1_750_000n));

  console.log('4. who can read the top-up');
  const deskBal = await desk.balance();
  console.log(`  desk decrypts its balance: ${fmt(deskBal.amount)} (was ${fmt(before)}; consistent with ciphertext: ${deskBal.consistent})`);
  const logs = await auditor.privateTransferLogs(BigInt(d.startBlock ?? 0), { from: buyer.address, to: desk.address });
  const last = logs[logs.length - 1];
  const audited = auditor.auditorAmount(last.args.auditorPCT);
  console.log(`  auditor decrypts the transfer event: ${fmt(audited)}`);
  console.log(`  everyone else sees: from ${buyer.address.slice(0, 10)}… to ${desk.address.slice(0, 10)}…, amount = ciphertext ${String(last.args.auditorPCT[0]).slice(0, 18)}…`);
  const buyerBal = await buyer.balance();
  console.log(`  buyer's remaining private credit: ${fmt(buyerBal.amount)}`);

  console.log('5. provider revenue goes private');
  t('atlas owner deposits 0.5 tUSD earnings', await owner.deposit(500_000n));
  t('atlas owner -> treasury private payout', await owner.transfer(treasury.address, 400_000n));
  const tr = await treasury.balance();
  console.log(`  treasury decrypts: ${fmt(tr.amount)} (consistent: ${tr.consistent})`);

  console.log('6. desk withdraws to fund public job escrows');
  t('desk withdraws 1 tUSD', await desk.withdraw(1_000_000n));
  const deskAfter = await desk.balance();
  console.log(`  desk private balance now ${fmt(deskAfter.amount)}`);

  recordEvidence(network, 'eerc', {
    steps,
    decrypted: { deskReceived: (deskBal.amount - before).toString(), auditorRead: audited.toString(), buyerRemaining: buyerBal.amount.toString(), treasury: tr.amount.toString(), deskAfterWithdraw: deskAfter.amount.toString() },
    consistent: deskBal.consistent && buyerBal.consistent && tr.consistent && deskAfter.consistent,
  });
  await shutdownProver();
}

main().catch(async (e) => {
  console.error(e.shortMessage ?? e.message);
  await shutdownProver();
  process.exit(1);
});
