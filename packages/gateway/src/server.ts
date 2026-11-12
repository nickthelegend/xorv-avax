#!/usr/bin/env node
/**
 * Xorv gateway: one OpenAI-compatible API in front of the Xorv market on Avalanche Fuji.
 *
 *   POST /v1/chat/completions   x402: without X-PAYMENT it answers 402 with the payment requirements;
 *                               with a signed payment it settles on-chain, waits for delivery, answers
 *   GET  /v1/models             models that staked nodes serve, with their last cleared price
 *   POST /api/x402/requirements the requirements for a chat (the web app signs these in the wallet)
 *   POST /api/chat              settle a signed payment and return the job id at once (the web follows it on-chain)
 *   GET  /api/index             the Xorv Compute Index as JSON (read from the XorvIndex contract)
 *   GET  /api/jobs/:id          one job with every event and its transaction hash
 *   GET  /api/health            what is set up
 *   /api/private/*              the eERC private credit lane (see private.ts)
 *
 * Env: XORV_DEPLOYMENT, XORV_RPC, XORV_GATEWAY_PORT (5421), XORV_ENV_FILE (only GROQ_API_KEY is read),
 *      XORV_GATEWAY_NODES (atlas:1.2,birch:1.08,cobalt:1.35,dune:1.15), XORV_PUBLIC_URL.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { OUTCOME_TEXT, PromptError, XorvReader, modelInfo, packPrompt, txUrl, xorvMarketAbi, type Job } from '@xorv/sdk';
import { ROOT, keyByName, loadDeployment, readEnvFile, walletFor, type Wallet } from '@xorv/sdk/node';
import { NodePool, parseNodes } from './nodes.ts';
import { Facilitator, HttpError } from './x402.ts';
import { PrivateLane } from './private.ts';

const d = loadDeployment();
const rpc = process.env.XORV_RPC ?? d.rpc;
const port = Number(process.env.XORV_GATEWAY_PORT ?? 5421);
const publicUrl = process.env.XORV_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const reader = new XorvReader(d, rpc);

let desk: Wallet | null = null;
try {
  keyByName('XORV_DESK_KEY');
  desk = walletFor(d, 'XORV_DESK_KEY', rpc);
} catch {
  desk = null;
}
const facilitator = new Facilitator(d, reader, desk, publicUrl);
const lane = new PrivateLane(d, reader, desk, facilitator);

const providerEnv: Record<string, string> = {};
for (const f of (process.env.XORV_ENV_FILE ?? '').split(':').filter(Boolean)) Object.assign(providerEnv, readEnvFile(f, ['GROQ_API_KEY']));
if (process.env.GROQ_API_KEY) providerEnv.GROQ_API_KEY = process.env.GROQ_API_KEY;
const pool = new NodePool(providerEnv.GROQ_API_KEY && process.env.XORV_EXTERNAL_NODES !== '1' ? parseNodes(process.env.XORV_GATEWAY_NODES ?? 'atlas:1.2,birch:1.08,cobalt:1.35,dune:1.15') : [], providerEnv);

function setupNeeds(): string[] {
  const n: string[] = [];
  if (!desk) n.push('XORV_DESK_KEY (facilitator account, in the gitignored .env)');
  if (process.env.XORV_EXTERNAL_NODES !== '1') {
    if (!providerEnv.GROQ_API_KEY) n.push('GROQ_API_KEY (set it in the environment or point XORV_ENV_FILE at a file that has it)');
    else if (pool.online().length === 0) n.push('provider self-check (waiting for a node to pass its model check; see the gateway log)');
  }
  return n;
}

async function servedModels() {
  const ps = await reader.providers();
  const min = BigInt(d.config.minStake);
  const out = new Map<string, number>();
  for (const p of ps) if (p.stake >= min && p.unbonding === 0n) for (const m of p.models) out.set(m, (out.get(m) ?? 0) + 1);
  return out;
}

async function readJson(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const ch of req) {
    s += ch;
    if (s.length > 64_000) throw new HttpError(413, 'body too large');
  }
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    throw new HttpError(400, 'body is not JSON');
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-payment, authorization, x-xorv-signature',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'x-payment-response',
};
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function chatTerms(body: any) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  let prompt: string;
  try {
    prompt = packPrompt(messages);
  } catch (e) {
    if (e instanceof PromptError) throw new HttpError(400, e.message);
    throw e;
  }
  const t = Facilitator.terms(body, prompt);
  if (!t.model) throw new HttpError(400, 'model is required');
  const served = await servedModels();
  if (!served.has(t.model)) throw new HttpError(400, `no staked node serves "${t.model}"; GET /v1/models lists what is served`);
  if ((served.get(t.model) ?? 0) < 2) throw new HttpError(503, `only one node serves ${t.model}, so there is no auction`);
  return t;
}

async function paymentRequired(res: ServerResponse, body: any, resource: string) {
  const t = await chatTerms(body);
  const req = await facilitator.requirements(t, resource);
  send(res, 402, { x402Version: 1, error: 'X-PAYMENT header is required', accepts: [req] });
}

async function deliveredText(job: Job): Promise<string | null> {
  // Load-balanced public RPCs can return the new state a moment before the matching log; retry briefly.
  for (let i = 0; i < 6; i++) {
    const logs = await reader.recentLogs({ address: d.contracts.market, abi: xorvMarketAbi, eventName: 'Delivered', args: { id: BigInt(job.id) } }, 400n).catch(() => []);
    if (logs[0]?.args?.output) return logs[0].args.output as string;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function waitForDelivery(id: number, timeoutMs = 150_000): Promise<Job> {
  const t0 = Date.now();
  for (;;) {
    const j = await reader.job(id).catch(() => null);
    if (j && !['Bidding', 'Running'].includes(j.status)) return j;
    if (Date.now() - t0 > timeoutMs) throw new HttpError(504, `job ${id} was not delivered within ${timeoutMs / 1000} s; follow it at /jobs/${id}`);
    await new Promise((r) => setTimeout(r, 2500));
  }
}

async function completion(id: number, settleTx: string) {
  const j = await waitForDelivery(id);
  const content = j.resultHash !== `0x${'0'.repeat(64)}` ? await deliveredText(j) : null;
  return {
    status: content ? 200 : 502,
    body: {
      id: `xorv-job-${id}`,
      object: 'chat.completion',
      created: j.createdAt,
      model: j.model,
      choices: content ? [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] : [],
      usage: { total_tokens: j.tokens },
      ...(content ? {} : { error: { message: `job ${id} ended ${j.status} without a delivery: ${OUTCOME_TEXT[j.outcome]}` } }),
      xorv: { job: id, status: j.status, winner: j.winner, cleared_rate_per_1k: j.clearedRate.toString(), bids: j.bidCount, revealed: j.revealed, settle_tx: settleTx, explorer: txUrl(settleTx, d.chainId), job_url: `/jobs/${id}` },
    },
  };
}

async function indexJson() {
  const models = await reader.indexModels();
  return {
    contract: d.contracts.index,
    chainId: d.chainId,
    unit: 'micro-tUSD per 1k tokens (1 tUSD = 1,000,000 micro); multiply by 1000 / 1e6 for dollars per 1M tokens',
    maxStepBps: d.config.indexMaxStepBps,
    models: await Promise.all(models.map(async (m) => ({ ...m, observations_list: await reader.observations(m.id, Math.max(0, m.observations - 200), 200) }))),
  };
}

const WEB_DIST = path.join(ROOT, 'web/dist');
function serveStatic(p: string, res: ServerResponse) {
  if (!existsSync(WEB_DIST)) return false;
  let f = path.join(WEB_DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(WEB_DIST) || !existsSync(f) || statSync(f).isDirectory()) f = path.join(WEB_DIST, 'index.html');
  const type: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'content-type': type[path.extname(f)] ?? 'application/octet-stream', 'cache-control': f.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
  res.end(readFileSync(f));
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && p === '/api/health') {
      const served = await servedModels().catch(() => new Map());
      return send(res, 200, { chainId: d.chainId, network: d.network, contracts: d.contracts, facilitator: desk?.account.address ?? null, nodes: pool.status(), models: [...served].map(([id, n]) => ({ id, nodes: n })), setup_required: setupNeeds() });
    }
    if (req.method === 'GET' && p === '/v1/models') {
      const [served, idx] = await Promise.all([servedModels(), reader.indexModels()]);
      return send(res, 200, { object: 'list', data: [...served].map(([id, n]) => ({ id, object: 'model', owned_by: id.split(':')[0], name: modelInfo(id).name, nodes: n, index_rate_per_1k: idx.find((m) => m.name === id)?.rate.toString() ?? null })) });
    }
    if (req.method === 'GET' && p === '/api/index') return send(res, 200, await indexJson());
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && (m = p.match(/^\/api\/jobs\/(\d+)$/))) {
      const id = Number(m[1]);
      const [job, events] = await Promise.all([reader.job(id), reader.jobEvents(id)]);
      return send(res, 200, { job, events: events.map((e: any) => ({ event: e.eventName, tx: e.transactionHash, block: Number(e.blockNumber), args: e.args })) });
    }
    if (req.method === 'POST' && p === '/api/x402/requirements') {
      const t = await chatTerms(await readJson(req));
      return send(res, 200, { x402Version: 1, accepts: [await facilitator.requirements(t, '/api/chat')] });
    }
    if (req.method === 'POST' && (p === '/api/chat' || p === '/v1/chat/completions')) {
      const needs = setupNeeds();
      const body = await readJson(req);
      const header = req.headers['x-payment'];
      if (!header) return paymentRequired(res, body, p);
      if (needs.length) throw new HttpError(503, `Setup required: ${needs.join('; ')}`, { setup: needs });
      const t = await chatTerms(body);
      const s = await facilitator.settle(String(header), t);
      const paymentResponse = Buffer.from(JSON.stringify({ success: true, transaction: s.tx, network: facilitator.networkName(), payer: s.payer })).toString('base64');
      if (p === '/api/chat') return send(res, 200, { job: s.job, tx: s.tx, explorer: txUrl(s.tx, d.chainId), value: s.value.toString() }, { 'x-payment-response': paymentResponse });
      const c = await completion(s.job, s.tx);
      return send(res, c.status, c.body, { 'x-payment-response': paymentResponse });
    }
    if (p.startsWith('/api/private')) return send(res, ...(await lane.route(req.method ?? 'GET', p, req.method === 'POST' ? await readJson(req) : {}, req.headers)));
    if (req.method === 'GET' && !p.startsWith('/api') && !p.startsWith('/v1') && serveStatic(p, res)) return;
    throw new HttpError(404, `no route ${req.method} ${p}`);
  } catch (e) {
    const err = e as HttpError;
    const status = err.status ?? 500;
    if (status >= 500) console.error(`gateway: ${req.method} ${p}: ${err.message}`);
    send(res, status, { error: { message: err.message }, ...(err.extra?.x402 ? (err.extra.x402 as object) : {}), ...(err.extra?.setup ? { setup: err.extra.setup } : {}) });
  }
});

pool.start();
server.listen(port, '127.0.0.1', () => {
  console.log(`xorv gateway on http://127.0.0.1:${port} · ${d.network} · market ${d.contracts.market} · facilitator ${desk?.account.address ?? '(missing)'}`);
  const needs = setupNeeds();
  if (needs.length) console.log(`  Setup required: ${needs.join('; ')}`);
});
const stop = () => {
  pool.stop();
  server.close();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
