#!/usr/bin/env node
/**
 * xorv-node: sell AI capacity you already pay for (an API key, or a local model) on the Xorv market, Avalanche Fuji.
 *
 *   xorv-node init  --label <name>                     owner + node keys into $XORV_HOME/keys.env (addresses printed, keys never)
 *   xorv-node join  --label <name> [--stake 5] [--models groq:openai/gpt-oss-20b,...]
 *                                                      tUSD from the faucet if needed, approve, register (or top up the stake)
 *   xorv-node start --label <name> [--margin 1.2] [--fault deliver|check]   bid, serve, get paid; lie and get slashed
 *   xorv-node status [--label <name>]                  the market, or one provider
 *   xorv-node leave --label <name>                     start unbonding the stake; withdraw after the unbonding period
 *   xorv-node withdraw --label <name>                  unbonded stake back to the owner
 *
 * The owner key stakes and withdraws; the node key only bids, delivers and checks. Both are read by name
 * (XORV_OWNER_<LABEL>_KEY, XORV_NODE_<LABEL>_KEY) from the environment, the repo's gitignored .env or $XORV_HOME/keys.env.
 * GROQ_API_KEY comes from the environment or XORV_ENV_FILE (only that variable is read). Gas: a little Fuji test AVAX
 * on both addresses (https://core.app/tools/testnet-faucet).
 */
import path from 'node:path';
import { formatEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { XorvReader, perMillion, testDollarAbi, txUrl, usd, xorvRegistryAbi } from '@xorv/sdk';
import { ROOT, keysFile, keyByName, loadDeployment, maybeKey, readEnvFile, saveKeys, t, tick, walletFor, type Wallet } from '@xorv/sdk/node';
import { startNode, type Fault } from './node.ts';

/**
 * What each upstream model costs this operator, in micro-dollars per 1k tokens: Groq's published price
 * per 1M tokens (console.groq.com/docs/model, read Nov 12, 2026) blended as 40% input / 60% output.
 *   gpt-oss-20b:  $0.075 in, $0.30 out  -> $0.21 per 1M  -> 210
 *   gpt-oss-120b: $0.15 in,  $0.60 out  -> $0.42 per 1M  -> 420
 */
export const DEFAULT_COST: Record<string, number> = {
  'groq:openai/gpt-oss-20b': 210,
  'groq:openai/gpt-oss-120b': 420,
};
const DEFAULT_MODELS = 'groq:openai/gpt-oss-20b,groq:openai/gpt-oss-120b';

function flag(args: string[], name: string, fallback?: string) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

const keyNames = (label: string) => {
  const L = label.toUpperCase().replace(/-/g, '_');
  return { owner: `XORV_OWNER_${L}_KEY`, node: `XORV_NODE_${L}_KEY` };
};

function needLabel(args: string[]) {
  const label = flag(args, 'label');
  if (!label || !/^[a-z0-9-]{1,24}$/.test(label)) throw new Error('--label is required (lowercase letters, digits, dashes)');
  return label;
}

async function send(w: Wallet, req: any, what: string) {
  const hash = await w.writeContract(req);
  const r = await w.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success') throw new Error(`${what} reverted: ${txUrl(hash)}`);
  console.log(`  ${tick()} ${what.padEnd(30)} ${t.dim(txUrl(hash))}`);
  return hash;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const d = loadDeployment();
  const reg = { address: d.contracts.registry as Hex, abi: xorvRegistryAbi };
  const tusd = { address: d.contracts.testDollar as Hex, abi: testDollarAbi };

  if (cmd === 'init') {
    const label = needLabel(args);
    const n = keyNames(label);
    const have = { owner: maybeKey(n.owner), node: maybeKey(n.node) };
    const made: Record<string, string> = {};
    if (!have.owner) made[n.owner] = generatePrivateKey();
    if (!have.node) made[n.node] = generatePrivateKey();
    if (Object.keys(made).length) saveKeys(made);
    const owner = privateKeyToAccount((have.owner ?? made[n.owner]) as Hex).address;
    const node = privateKeyToAccount((have.node ?? made[n.node]) as Hex).address;
    console.log(`${t.b(`xorv-node ${label}`)} ${Object.keys(made).length ? `keys written to ${keysFile()} (mode 600)` : 'keys already set'}`);
    console.log(`  owner ${owner}  ${t.dim('stakes, withdraws, receives earnings')}`);
    console.log(`  node  ${node}  ${t.dim('bids, delivers, checks')}`);
    console.log(`  next: send a little Fuji test AVAX to both for gas, then  xorv-node join --label ${label}`);
    return;
  }

  if (cmd === 'join') {
    const label = needLabel(args);
    const n = keyNames(label);
    const owner = walletFor(d, n.owner);
    const node = privateKeyToAccount(keyByName(n.node)).address;
    const stake = BigInt(Math.round(Number(flag(args, 'stake', String(Number(d.config.minStake) / 1e6))) * 1e6));
    if (stake < BigInt(d.config.minStake)) throw new Error(`--stake must be at least ${Number(d.config.minStake) / 1e6} tUSD (the registry's minimum)`);
    const models = (flag(args, 'models') ?? DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);
    const kind = flag(args, 'kind', 'api')!;
    const [p, bal, allow, gasO, gasN] = await Promise.all([
      owner.readContract({ ...reg, functionName: 'getProvider', args: [owner.account.address] }) as Promise<any>,
      owner.readContract({ ...tusd, functionName: 'balanceOf', args: [owner.account.address] }) as Promise<bigint>,
      owner.readContract({ ...tusd, functionName: 'allowance', args: [owner.account.address, d.contracts.registry] }) as Promise<bigint>,
      owner.getBalance({ address: owner.account.address }),
      owner.getBalance({ address: node }),
    ]);
    const registered = !/^0x0{40}$/.test(p.owner);
    console.log(`${t.b(`xorv-node join ${label}`)} · registry ${d.contracts.registry} on Avalanche Fuji`);
    console.log(`  owner ${owner.account.address} · ${formatEther(gasO)} AVAX · ${usd(bal, 2)} tUSD${registered ? ` · staked ${usd(p.stake, 2)}` : ''}`);
    console.log(`  node  ${node} · ${formatEther(gasN)} AVAX`);
    if (gasO === 0n || gasN === 0n) throw new Error(`Setup required: send a little Fuji test AVAX for gas to ${gasO === 0n ? owner.account.address : node} (https://core.app/tools/testnet-faucet)`);
    const need = registered ? (stake > p.stake ? stake - p.stake : 0n) : stake;
    if (need > 0n && bal < need) await send(owner, { ...tusd, functionName: 'faucet' }, 'tUSD from the test faucet');
    if (need > 0n && allow < need) await send(owner, { ...tusd, functionName: 'approve', args: [d.contracts.registry, 2n ** 255n] }, 'approve the registry');
    if (!registered) {
      await send(owner, { ...reg, functionName: 'register', args: [node, label, kind, models, stake] }, `register, stake ${usd(stake, 2)}`);
    } else {
      const same = models.length === p.models.length && models.every((m: string) => p.models.includes(m));
      if (!same) await send(owner, { ...reg, functionName: 'updateProfile', args: [label, kind, models] }, 'update the models served');
      if (need > 0n) await send(owner, { ...reg, functionName: 'addStake', args: [need] }, `stake ${usd(need, 2)} more (to ${usd(stake, 2)})`);
      if (same && need === 0n) console.log(`  ${tick()} already registered with ${usd(p.stake, 2)} staked`);
    }
    console.log(`  serves ${models.join(', ')}`);
    console.log(`  next: xorv-node start --label ${label}`);
    return;
  }

  if (cmd === 'leave' || cmd === 'withdraw') {
    const label = needLabel(args);
    const owner = walletFor(d, keyNames(label).owner);
    const p: any = await owner.readContract({ ...reg, functionName: 'getProvider', args: [owner.account.address] });
    if (/^0x0{40}$/.test(p.owner)) throw new Error(`${label} is not registered`);
    if (cmd === 'leave') {
      if (p.stake === 0n) return console.log('  nothing bonded');
      await send(owner, { ...reg, functionName: 'requestUnstake', args: [p.stake] }, `unbond ${usd(p.stake, 2)}`);
      console.log(`  withdraw after ${new Date(Date.now() + d.config.unbondSecs * 1000).toISOString()}: xorv-node withdraw --label ${label}`);
    } else await send(owner, { ...reg, functionName: 'withdrawStake' }, `withdraw ${usd(p.unbonding, 2)}`);
    return;
  }

  if (cmd === 'status') {
    const r = new XorvReader(d, process.env.XORV_RPC);
    const [s, ps] = await Promise.all([r.stats(), r.providers()]);
    const only = flag(args, 'label');
    console.log(`market ${d.contracts.market} on ${d.network}`);
    console.log(`  jobs ${s.jobs} · clearings ${s.clearings} · staked ${usd(s.staked, 2)} · paid ${usd(s.paid)} · slashed ${usd(s.slashed, 2)} (${s.slashCount})`);
    for (const p of ps) if (!only || p.label === only) console.log(`  ${p.label.padEnd(8)} stake ${usd(p.stake, 2)} wins ${p.wins} bids ${p.bids} checks ${p.checks} slashes ${p.slashes} earned ${usd(p.totalEarned)}`);
    if (!only) for (const m of await r.indexModels()) console.log(`  index ${m.name}: ${perMillion(m.rate)} per 1M tokens (${m.observations} clearings)`);
    return;
  }

  if (cmd !== 'start') throw new Error('usage: xorv-node init|join|start|status|leave|withdraw --label <name>   (see the header of packages/node/src/cli.ts)');
  const label = needLabel(args);
  if (!process.env.GROQ_API_KEY && process.env.XORV_ENV_FILE) {
    for (const f of process.env.XORV_ENV_FILE.split(':')) Object.assign(process.env, readEnvFile(f, ['GROQ_API_KEY', 'OLLAMA_HOST']));
  }
  const models = (flag(args, 'models') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  await startNode({
    deployment: d,
    rpc: process.env.XORV_RPC,
    nodeKey: keyByName(keyNames(label).node),
    label,
    models,
    cost: DEFAULT_COST,
    margin: Number(flag(args, 'margin', '1.2')),
    stateDir: path.resolve(ROOT, process.env.XORV_STATE_DIR ?? '.xorv/nodes'),
    fault: (flag(args, 'fault', 'none') as Fault) ?? 'none',
    keeper: flag(args, 'keeper') === 'true',
    pollMs: Number(flag(args, 'poll', '2500')),
  });
}

main().catch((e) => {
  console.error(String(e.shortMessage ?? e.message));
  process.exit(1);
});
