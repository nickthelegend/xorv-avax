// Funds this repo's test accounts with gas and tUSD and registers the four provider nodes.
// Idempotent: skips what is already done. Prints addresses and tx hashes, never keys.
//   XORV_NETWORK=fuji node scripts/setup-providers.ts
import { formatEther, parseEther, type Hex } from 'viem';
import { testDollarAbi, xorvRegistryAbi } from '../packages/sdk/src/abi.ts';
import { walletFor, type Wallet } from '../packages/sdk/src/node.ts';
import { deploymentPath, readJson, recordEvidence, send } from './lib.ts';
import { ACCOUNTS, LABELS } from './accounts.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const d = readJson(deploymentPath(network));
if (!d.contracts) throw new Error(`Setup required: deploy first (deployments/${network}.json missing)`);
const rpc = process.env.XORV_RPC ?? d.rpc;

const BOTH = ['groq:openai/gpt-oss-20b', 'groq:openai/gpt-oss-120b'];
export const SERVES: Record<string, string[]> = { atlas: BOTH, birch: BOTH, cobalt: BOTH, dune: BOTH };
const STAKE = 10_000_000n;
const GAS_EACH = parseEther(process.env.XORV_GAS_EACH ?? '0.004');

async function faucetIfLow(w: Wallet, min: bigint) {
  const bal = (await w.readContract({ address: d.contracts.testDollar, abi: testDollarAbi, functionName: 'balanceOf', args: [w.account.address] })) as bigint;
  if (bal >= min) return null;
  return send(w, { address: d.contracts.testDollar, abi: testDollarAbi, functionName: 'faucet' }, `faucet ${w.account.address.slice(0, 8)}`);
}

async function main() {
  const deployer = walletFor(d, 'XORV_DEPLOYER_KEY', rpc);
  const log: Record<string, unknown> = {};
  // gas for everyone else
  for (const [label, name] of Object.entries(ACCOUNTS)) {
    if (label === 'deployer') continue;
    const w = walletFor(d, name, rpc);
    const bal = await deployer.getBalance({ address: w.account.address });
    if (bal >= GAS_EACH / 2n) continue;
    const hash = await deployer.sendTransaction({ to: w.account.address, value: GAS_EACH });
    await deployer.waitForTransactionReceipt({ hash });
    console.log(`  gas ${formatEther(GAS_EACH)} → ${label.padEnd(12)} tx ${hash}`);
    log[`gas.${label}`] = hash;
  }
  for (const label of ['buyer', 'qa', 'desk']) {
    const r = await faucetIfLow(walletFor(d, ACCOUNTS[label], rpc), 20_000_000n);
    if (r) log[`faucet.${label}`] = r.tx;
  }
  for (const l of LABELS) {
    const owner = walletFor(d, ACCOUNTS[`owner.${l}`], rpc);
    const node = walletFor(d, ACCOUNTS[`node.${l}`], rpc);
    const p: any = await owner.readContract({ address: d.contracts.registry, abi: xorvRegistryAbi, functionName: 'getProvider', args: [owner.account.address] });
    if (!/^0x0{40}$/.test(p.owner)) {
      console.log(`  ${l} already registered (stake ${Number(p.stake) / 1e6} tUSD)`);
      continue;
    }
    const f = await faucetIfLow(owner, STAKE);
    if (f) log[`faucet.owner.${l}`] = f.tx;
    log[`approve.${l}`] = (await send(owner, { address: d.contracts.testDollar, abi: testDollarAbi, functionName: 'approve', args: [d.contracts.registry, 2n ** 255n] }, `approve registry (${l})`)).tx;
    log[`register.${l}`] = (await send(owner, { address: d.contracts.registry, abi: xorvRegistryAbi, functionName: 'register', args: [node.account.address as Hex, l, 'api', SERVES[l], STAKE] }, `register ${l} (10 tUSD stake)`)).tx;
  }
  if (Object.keys(log).length) recordEvidence(network, 'setup', log);
  console.log('providers ready');
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
