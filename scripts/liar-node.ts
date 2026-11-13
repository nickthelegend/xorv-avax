// The liar: a fifth provider that bids lowest and returns junk on purpose (the node runs with --fault deliver),
// so the film can show a cheater caught by the spot check and slashed live. It stakes the minimum (5 tUSD), so one
// slash (10%) leaves it below the minimum and the registry stops letting it bid or be drawn as a checker.
//   XORV_NETWORK=fuji node scripts/liar-node.ts prep    gas check, tUSD faucet, approve the registry (no register)
//   XORV_NETWORK=fuji node scripts/liar-node.ts join    register the node (5 tUSD stake, GPT-OSS 20B only)
//   XORV_NETWORK=fuji node scripts/liar-node.ts park    serve only GPT-OSS 120B (not the film's model) while stopped
//   XORV_NETWORK=fuji node scripts/liar-node.ts status
//   XORV_NETWORK=fuji node scripts/liar-node.ts leave   start unbonding what is left (withdraw after unbondSecs)
//   XORV_NETWORK=fuji node scripts/liar-node.ts withdraw
// Gas comes from the Avalanche funding hub (avax/.hub/fund.sh xorv <address> ...). Prints addresses and tx hashes, never keys.
import { formatEther, type Hex } from 'viem';
import { testDollarAbi, xorvRegistryAbi } from '../packages/sdk/src/abi.ts';
import { walletFor } from '../packages/sdk/src/node.ts';
import { deploymentPath, readJson, recordEvidence, send } from './lib.ts';

const network = process.env.XORV_NETWORK ?? 'fuji';
const d = readJson(deploymentPath(network));
const rpc = process.env.XORV_RPC ?? d.rpc;
const STAKE = BigInt(d.config.minStake);
const MODELS = ['groq:openai/gpt-oss-20b'];
const PARKED = ['groq:openai/gpt-oss-120b'];
const owner = walletFor(d, 'XORV_OWNER_LIAR_KEY', rpc);
const node = walletFor(d, 'XORV_NODE_LIAR_KEY', rpc);
const reg = { address: d.contracts.registry as Hex, abi: xorvRegistryAbi };
const tusd = { address: d.contracts.testDollar as Hex, abi: testDollarAbi };

async function state() {
  const [p, bal, allow, gasO, gasN] = await Promise.all([
    owner.readContract({ ...reg, functionName: 'getProvider', args: [owner.account.address] }) as Promise<any>,
    owner.readContract({ ...tusd, functionName: 'balanceOf', args: [owner.account.address] }) as Promise<bigint>,
    owner.readContract({ ...tusd, functionName: 'allowance', args: [owner.account.address, d.contracts.registry] }) as Promise<bigint>,
    owner.getBalance({ address: owner.account.address }),
    owner.getBalance({ address: node.account.address }),
  ]);
  return { registered: !/^0x0{40}$/.test(p.owner), p, bal, allow, gasO, gasN };
}

async function main() {
  const cmd = process.argv[2] ?? 'status';
  console.log(`liar owner ${owner.account.address} · node ${node.account.address} · registry ${d.contracts.registry}`);
  const s = await state();
  console.log(`  gas owner ${formatEther(s.gasO)} AVAX · node ${formatEther(s.gasN)} AVAX · tUSD ${Number(s.bal) / 1e6} · registered ${s.registered}${s.registered ? ` · stake ${Number(s.p.stake) / 1e6} · unbonding ${Number(s.p.unbonding) / 1e6} · slashes ${s.p.slashes}` : ''}`);
  if (cmd === 'status') return;
  if (cmd === 'prep') {
    if (s.gasO < 2_000_000_000_000_000n || s.gasN < 2_000_000_000_000_000n) throw new Error('Setup required: fund both addresses with gas first (avax/.hub/fund.sh xorv <address> 0.01 "...")');
    const log: Record<string, unknown> = {};
    if (s.bal < STAKE) log.faucet = (await send(owner, { ...tusd, functionName: 'faucet' }, 'faucet (liar owner)')).tx;
    if (s.allow < STAKE) log.approve = (await send(owner, { ...tusd, functionName: 'approve', args: [d.contracts.registry, 2n ** 255n] }, 'approve registry (liar)')).tx;
    if (Object.keys(log).length) recordEvidence(network, 'liar', { step: 'prep', ...log });
    console.log('liar prepared (not registered)');
    return;
  }
  if (cmd === 'park') {
    // Off the film model between takes: a registered node that is not running must not be drawn as a checker.
    const r = await send(owner, { ...reg, functionName: 'updateProfile', args: ['liar', 'api', PARKED] }, 'park liar on GPT-OSS 120B only');
    recordEvidence(network, 'liar', { step: 'park', tx: r.tx, models: PARKED });
    return;
  }
  if (cmd === 'join') {
    if (s.registered && !s.p.models.includes(MODELS[0])) {
      const r = await send(owner, { ...reg, functionName: 'updateProfile', args: ['liar', 'api', MODELS] }, 'liar serves GPT-OSS 20B again');
      recordEvidence(network, 'liar', { step: 'unpark', tx: r.tx, models: MODELS });
    }
    if (s.registered) {
      if (s.p.stake < STAKE) {
        const r = await send(owner, { ...reg, functionName: 'addStake', args: [STAKE - s.p.stake] }, 'top up to the minimum stake');
        recordEvidence(network, 'liar', { step: 'addStake', tx: r.tx });
      } else console.log('  already registered and eligible');
      return;
    }
    const r = await send(owner, { ...reg, functionName: 'register', args: [node.account.address, 'liar', 'api', MODELS, STAKE] }, `register liar (${Number(STAKE) / 1e6} tUSD stake)`);
    recordEvidence(network, 'liar', { step: 'register', tx: r.tx, block: r.block, owner: owner.account.address, node: node.account.address, stake: STAKE.toString(), models: MODELS, note: 'film v5: a node that lies on purpose (--fault deliver)' });
    return;
  }
  if (cmd === 'leave') {
    if (!s.registered || s.p.stake === 0n) return console.log('  nothing bonded');
    const r = await send(owner, { ...reg, functionName: 'requestUnstake', args: [s.p.stake] }, 'request unstake (liar)');
    recordEvidence(network, 'liar', { step: 'requestUnstake', tx: r.tx, amount: s.p.stake.toString() });
    return;
  }
  if (cmd === 'withdraw') {
    const r = await send(owner, { ...reg, functionName: 'withdrawStake' }, 'withdraw stake (liar)');
    recordEvidence(network, 'liar', { step: 'withdrawStake', tx: r.tx });
    return;
  }
  throw new Error('usage: liar-node.ts prep|join|park|status|leave|withdraw');
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
