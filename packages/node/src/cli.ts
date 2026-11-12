#!/usr/bin/env node
/**
 * xorv-node: run a provider node.
 *   node packages/node/src/cli.ts start --label atlas [--models groq:openai/gpt-oss-20b] [--margin 1.2] [--keeper] [--fault deliver|check]
 *   node packages/node/src/cli.ts status
 * The node key is read by name (XORV_NODE_<LABEL>_KEY) from the environment or the gitignored .env.
 * GROQ_API_KEY comes from the environment or XORV_ENV_FILE (only that variable is read).
 */
import path from 'node:path';
import { XorvReader, perMillion, usd } from '@xorv/sdk';
import { ROOT, keyByName, loadDeployment, readEnvFile } from '@xorv/sdk/node';
import { startNode, type Fault } from './node.ts';

/** What each upstream model costs this operator, in micro-dollars per 1k tokens (blended in/out). */
export const DEFAULT_COST: Record<string, number> = {
  'groq:openai/gpt-oss-20b': 300,
  'groq:openai/gpt-oss-120b': 600,
};

function flag(args: string[], name: string, fallback?: string) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const d = loadDeployment();
  if (cmd === 'status') {
    const r = new XorvReader(d, process.env.XORV_RPC);
    const [s, ps] = await Promise.all([r.stats(), r.providers()]);
    console.log(`market ${d.contracts.market} on ${d.network}`);
    console.log(`  jobs ${s.jobs} · clearings ${s.clearings} · staked ${usd(s.staked, 2)} · paid ${usd(s.paid)} · slashed ${usd(s.slashed, 2)} (${s.slashCount})`);
    for (const p of ps) console.log(`  ${p.label.padEnd(8)} stake ${usd(p.stake, 2)} wins ${p.wins} bids ${p.bids} checks ${p.checks} slashes ${p.slashes} earned ${usd(p.totalEarned)}`);
    for (const m of await r.indexModels()) console.log(`  index ${m.name}: ${perMillion(m.rate)} per 1M tokens (${m.observations} clearings)`);
    return;
  }
  if (cmd !== 'start') throw new Error('usage: cli.ts start --label <name> | status');
  const label = flag(args, 'label');
  if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('--label is required (lowercase letters, digits, dashes)');
  if (!process.env.GROQ_API_KEY && process.env.XORV_ENV_FILE) {
    for (const f of process.env.XORV_ENV_FILE.split(':')) Object.assign(process.env, readEnvFile(f, ['GROQ_API_KEY', 'OLLAMA_HOST']));
  }
  const models = (flag(args, 'models') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  await startNode({
    deployment: d,
    rpc: process.env.XORV_RPC,
    nodeKey: keyByName(`XORV_NODE_${label.toUpperCase().replace(/-/g, '_')}_KEY`),
    label,
    models,
    cost: DEFAULT_COST,
    margin: Number(flag(args, 'margin', '1.2')),
    stateDir: path.resolve(ROOT, process.env.XORV_STATE_DIR ?? '.xorv/nodes'),
    fault: (flag(args, 'fault', 'none') as Fault) ?? 'none',
    keeper: flag(args, 'keeper') === 'true',
    pollMs: Number(flag(args, 'poll', '1500')),
  });
}

main().catch((e) => {
  console.error(String(e.shortMessage ?? e.message));
  process.exit(1);
});
