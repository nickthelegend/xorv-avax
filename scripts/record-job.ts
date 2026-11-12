// Reads one job and every event of it from Fuji and records it under deployments/fuji.json evidence.
//   node scripts/record-job.ts <jobId> <section> "note"
import { XorvReader } from '../packages/sdk/src/reader.ts';
import { loadDeployment } from '../packages/sdk/src/node.ts';
import { recordEvidence } from './lib.ts';

const [id, section = 'jobs', note = ''] = process.argv.slice(2);
const d = loadDeployment();
const r = new XorvReader(d);
const job = await r.job(Number(id));
const events = await r.jobEvents(Number(id));
const rows = events.map((e: any) => ({ event: e.eventName, tx: e.transactionHash, block: Number(e.blockNumber), ...(e.eventName === 'Slashed' ? { owner: e.args.owner, amount: String(e.args.amount), reason: e.args.reason } : {}), ...(e.eventName === 'CheckDelivered' ? { round: Number(e.args.round), similarityBps: Number(e.args.similarityBps), againstFirstBps: Number(e.args.againstFirstBps) } : {}) }));
recordEvidence('fuji', section, { market: d.contracts.market, job: job.id, status: job.status, outcome: job.outcome, winner: job.winner, rate: job.clearedRate.toString(), tokens: job.tokens, note, events: rows });
console.log(`job #${job.id} ${job.status} ${job.outcome}`);
for (const e of rows) console.log(`  ${e.event.padEnd(16)} https://testnet.snowtrace.io/tx/${e.tx}${'amount' in e ? ` slashed ${Number(e.amount) / 1e6} tUSD` : ''}${'similarityBps' in e ? ` similarity ${(e.similarityBps ?? 0) / 100}%` : ''}`);
