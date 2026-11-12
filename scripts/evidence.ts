// Prints the README evidence tables from deployments/fuji.json and live chain reads.
//   node scripts/evidence.ts
import { XorvReader } from '../packages/sdk/src/reader.ts';
import { OUTCOME_TEXT } from '../packages/sdk/src/types.ts';
import { perMillion, usd } from '../packages/sdk/src/format.ts';
import { modelInfo } from '../packages/sdk/src/pricing.ts';
import { loadDeployment } from '../packages/sdk/src/node.ts';

const d = loadDeployment() as any;
const r = new XorvReader(d);
const tx = (h: string) => `[\`${h.slice(0, 10)}…\`](https://testnet.snowtrace.io/tx/${h})`;
const ev = d.evidence ?? {};
const since = Date.parse(d.deployedAt);

const n = await r.jobCount();
console.log(`### Jobs on the current market (${n})\n`);
console.log('| Job | Paid with | Model | Bids (revealed) | Cleared, $/1M tokens | Tokens | Charged | Outcome |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
const jobs = await r.jobs(n);
for (const j of jobs.reverse()) {
  const x = (ev.x402Calls ?? []).find((c: any) => c.job === j.id && Date.parse(c.at) > since);
  const q = (ev.webQaFlow ?? []).find((c: any) => c.job === j.id);
  const p = (ev.privateChats ?? []).find((c: any) => c.job === j.id && Date.parse(c.at) > since);
  const mcp = (ev.mcpAsk ?? []).find((c: any) => c.job === j.id);
  const jx = (ev.judgePath ?? []).find((c: any) => c.x402?.job === j.id);
  const jp = (ev.judgePath ?? []).find((c: any) => c.private?.job === j.id);
  const hostTx = (u: string) => tx(u.split('/tx/')[1]);
  const how = jx ? `x402 from a fresh test wallet (${jx.base.startsWith('https') ? 'hosted app' : 'web build'}) ${hostTx(jx.x402.settlement)}` : jp ? `private credit, top-up proved in the browser ${hostTx(jp.private.settlement)}` : mcp ? `x402 from the MCP tool ${tx(mcp.settleTx)}` : q ? `x402 from the web app (QA signer) ${tx(q.settleTx)}` : x ? `x402 ${tx(x.settleTx)}` : p ? `private credit (desk) ${tx(p.postTx)}` : j.viaX402 ? 'x402' : 'allowance';
  console.log(`| [#${j.id}](https://testnet.snowtrace.io/address/${d.contracts.market}) | ${how} | ${modelInfo(j.model).name}${j.alwaysCheck ? ' (verify)' : ''} | ${j.bidCount} (${j.revealed}) | ${j.clearedRate ? perMillion(j.clearedRate, 3) : '-'} | ${j.tokens} | ${usd(j.charge, 6)} | ${OUTCOME_TEXT[j.outcome]} |`);
}

console.log('\n### Index\n');
for (const m of await r.indexModels()) {
  console.log(`- ${modelInfo(m.name).name}: index ${perMillion(m.rate, 3)} per 1M tokens, TWAP 1h ${m.twap1h !== null ? perMillion(m.twap1h, 3) : '-'}, VWAP 24h ${perMillion(m.vwap24h.rate, 3)} over ${m.vwap24h.tokens} tokens, ${m.observations} clearings.`);
}

const s = await r.stats();
console.log(`\n### Totals\n\njobs ${s.jobs}, clearings ${s.clearings}, staked ${usd(s.staked, 2)}, paid to providers ${usd(s.paid, 6)}, slashed ${usd(s.slashed, 2)} in ${s.slashCount} slash(es)`);
