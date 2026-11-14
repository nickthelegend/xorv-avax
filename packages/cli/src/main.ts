#!/usr/bin/env node
/**
 * xorv: offload AI work to the Xorv market from a terminal. Each request is a sealed-bid auction among staked provider
 * nodes on Avalanche Fuji, paid per call with x402 (one EIP-3009 signature for test dollars, tUSD).
 *
 *   xorv wallet [new]                   a test wallet in $XORV_HOME/keys.env (address printed, key never) and its balances
 *   xorv fund                           one-time test funds from XorvGasStation (2 tUSD + a sip of AVAX), gasless
 *   xorv models                         models staked nodes serve, with their index price
 *   xorv quote "prompt" [--verify]      the most it can cost, before paying
 *   xorv chat  "prompt" [--verify] [--model id] [--max-tokens n] [--json]
 *                                       pay, then follow the auction live on Fuji: sealed bids, winner, answer, check, settlement
 *   xorv jobs [--mine] [--limit n]      recent jobs from the market contract
 *   xorv verify <job>                   re-check a job from the chain alone: hashes, lowest bid, re-computed check, money
 *   xorv index                          the Xorv Compute Index (what AI work actually cleared at)
 *
 * Env: XORV_GATEWAY (https://xorv-avax.vercel.app), XORV_RPC, XORV_HOME (~/.xorv), XORV_WALLET_KEY (or the keys file).
 */
import { formatEther, parseEventLogs, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  OUTCOME_TEXT, Xorv, XorvError, XorvReader, XORV_GATEWAY, fundDigest, followJob, modelInfo, perMillion, providerOf, reviewedCheck, txUrl, usd, verifyJob, xorvMarketAbi, xorvRegistryAbi, type Step,
} from '@xorv/sdk';
import { keysFile, loadDeployment, maybeKey, saveKeys, t, tick, cross, wrapText } from '@xorv/sdk/node';

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;
const has = (f: string) => rest.includes(`--${f}`);
const opt = (f: string) => {
  const i = rest.indexOf(`--${f}`);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined;
};
const positional = () => rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && ['model', 'max-tokens', 'limit'].includes(rest[i - 1].slice(2))));

const d = loadDeployment();
const reader = new XorvReader(d, process.env.XORV_RPC);
const gateway = process.env.XORV_GATEWAY ?? XORV_GATEWAY;
const WALLET = 'XORV_WALLET_KEY';
const account = () => {
  const k = maybeKey(WALLET);
  return k ? privateKeyToAccount(k) : null;
};
const needAccount = () => {
  const a = account();
  if (!a) throw new XorvError(`Setup required: no test wallet yet. Run  xorv wallet new  then  xorv fund`);
  return a;
};
const xorv = () => new Xorv({ gateway, account: account() });
const per1m = (r: bigint | null) => (r === null ? '—' : perMillion(r, 3));
const host = gateway.replace(/^https?:\/\//, '');
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function balances(addr: Hex) {
  const [tusd, avax] = await Promise.all([reader.tokenBalance(addr), reader.client.getBalance({ address: addr })]);
  return { tusd, avax };
}

async function wallet() {
  if (rest[0] === 'new') {
    if (account()) throw new XorvError(`a test wallet already exists (${account()!.address}) in ${keysFile()}`);
    saveKeys({ [WALLET]: generatePrivateKey() });
    console.log(`${tick()} new test wallet ${account()!.address}`);
    console.log(t.dim(`  key saved in ${keysFile()} (mode 600), never printed. Fuji test funds only.`));
    console.log(`  next: xorv fund`);
    return;
  }
  const a = needAccount();
  const b = await balances(a.address);
  console.log(`${t.b('wallet')} ${a.address}  ${t.dim('Avalanche Fuji')}`);
  console.log(`  ${usd(b.tusd, 6)} tUSD · ${Number(formatEther(b.avax)).toFixed(5)} AVAX`);
}

async function fund() {
  const a = needAccount();
  const station = d.contracts.gasStation;
  if (!station) throw new XorvError('Setup required: no XorvGasStation in the deployment');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await a.signMessage({ message: { raw: fundDigest(station, a.address, deadline, BigInt(d.chainId)) } });
  console.log(`signed a gasless request for test funds (wallet ${short(a.address)}, station ${short(station)})`);
  const res = await fetch(`${gateway}/api/fund`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: a.address, deadline: deadline.toString(), signature }) }).catch(() => null);
  if (!res) throw new XorvError(`the gateway at ${gateway} could not be reached`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new XorvError(body?.error?.message ?? `HTTP ${res.status}`, res.status);
  await reader.client.waitForTransactionReceipt({ hash: body.hash }).catch(() => undefined);
  console.log(`${tick()} XorvGasStation sent ${usd(body.tusd, 2).slice(1)} tUSD${Number(body.avax) > 0 ? ` + ${body.avax} AVAX` : ''}  ${t.dim(txUrl(body.hash))}`);
}

async function models() {
  const ms = await xorv().models();
  if (!ms.length) return console.log('No staked node serves a model right now.');
  console.log(t.dim(`${'provider'.padEnd(10)} ${'model'.padEnd(17)} ${'id'.padEnd(27)} ${'nodes'.padStart(5)}  ${'index/1M'.padStart(8)}  list/1M`));
  const sorted = [...ms].sort((a, b) => providerOf(a.id).localeCompare(providerOf(b.id)) || a.id.localeCompare(b.id));
  for (const m of sorted) {
    const l = modelInfo(m.id).list;
    console.log(`${providerOf(m.id).padEnd(10)} ${modelInfo(m.id).name.padEnd(17)} ${m.id.padEnd(27)} ${String(m.nodes).padStart(5)}  ${per1m(m.indexRate).padStart(8)}  ${l ? '$' + (0.4 * l.input + 0.6 * l.output).toFixed(3) : '—'}`);
  }
  console.log(t.dim('  one sealed-bid auction per model · list = the provider\'s published price, 40% input / 60% output'));
}

const askOpts = () => ({ model: opt('model'), maxTokens: opt('max-tokens') ? Number(opt('max-tokens')) : undefined, verify: has('verify') });
const promptArg = () => {
  const p = positional().join(' ').trim();
  if (!p) throw new XorvError('usage: xorv chat "your prompt" [--verify] [--model id] [--max-tokens n]');
  return p;
};

async function quote() {
  const q = await xorv().quote(promptArg(), askOpts());
  console.log(`${t.b('quote')} ${modelInfo(q.model).name} · ${q.nodes} staked nodes will bid · verify ${q.verify ? 'on' : 'off (30% are checked at random)'}`);
  console.log(`  you sign at most   ${usd(q.maxAmount, 6)} tUSD  ${t.dim(`= ceiling ${per1m(q.maxRate)} x ${q.maxTokens} tokens + two check fees`)}`);
  console.log(`  last clearing      ${per1m(q.indexRate)} per 1M tokens ${t.dim('(Xorv Compute Index)')}`);
  console.log(`  check fee          ${usd(d.config.checkFee, 6)} ${t.dim('per re-run, paid only when a check runs')}`);
  console.log(t.dim('  you pay the cleared rate for the tokens used; the rest of the escrow is refunded on-chain'));
}

async function chat() {
  const prompt = promptArg();
  const o = askOpts();
  const client = new Xorv({ gateway, account: needAccount() });
  const t0 = Date.now();
  const el = () => t.dim(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s`);
  const json = has('json');
  if (!json) console.log(`${t.b('xorv chat')} ${modelInfo(o.model ?? 'groq:openai/gpt-oss-20b').name} · verify ${o.verify ? 'on' : 'off'} · ${host}`);
  const posted = await client.submit(prompt, {
    ...o,
    onSigned: (from, req) => {
      if (json) return;
      console.log(`${el()} HTTP 402 Payment Required: at most ${usd(req.maxAmountRequired, 6)} tUSD to the x402 router on Fuji`);
      console.log(`${el()} ${tick()} signed one EIP-3009 authorization from ${short(from)} ${t.dim('(no gas, no account)')}`);
    },
  });
  if (!json) console.log(`${el()} ${tick()} paid on Fuji: job ${t.b(`#${posted.job}`)}, ${usd(posted.value, 6)} in escrow  ${t.dim(posted.explorer)}`);
  let shownBids = 0;
  const onStep = (s: Step) => {
    if (json) return;
    if (s.kind === 'bids' && s.committed > shownBids) {
      for (let i = shownBids + 1; i <= s.committed; i++) console.log(`${el()}   sealed bid ${i} committed ${t.dim('(price hidden until the reveal)')}`);
      shownBids = s.committed;
    } else if (s.kind === 'revealed') {
      const sorted = [...s.rates].sort((a, b) => Number(a.rate - b.rate));
      console.log(`${el()}   revealed ${sorted.map((r) => `${r.label} ${per1m(r.rate)}`).join(' · ')}`);
    } else if (s.kind === 'won') console.log(`${el()} ${tick()} ${t.b(s.label)} won at ${t.b(per1m(s.rate))} per 1M tokens`);
    else if (s.kind === 'delivered') {
      console.log(`${el()} ${tick()} answer delivered on-chain by ${s.label} (${s.tokens} tokens)`);
      console.log(t.acc(wrapText(s.text, 96, '       ')));
    } else if (s.kind === 'draw') console.log(`${el()}   ${s.checked ? `spot check drawn: ${s.label} ${reviewedCheck(o.model ?? '') ? 'has its own Claude review the answer' : 're-runs the prompt'}` : 'not drawn for a spot check this time'}`);
    else if (s.kind === 'check') {
      const pass = s.similarityBps >= d.config.toleranceBps;
      const role = s.round === 0 ? 'spot check' : 'tiebreak';
      console.log(`${el()} ${pass ? tick() : cross()} ${role} by ${s.label}: ${t.b(`${s.similarityBps / 100}% match`)}${s.round === 1 ? `, ${s.againstFirstBps / 100}% with the first check` : ''} ${t.dim('(computed on-chain)')}`);
    }
  };
  const j = await followJob(reader, posted.job, onStep);
  const closed = (await reader.recentLogs({ address: d.contracts.market, abi: xorvMarketAbi, eventName: 'JobClosed', args: { id: BigInt(posted.job) } }, 300n).catch(() => []))[0] as any;
  let fees = 0n, refund = 0n, slashed = 0n;
  if (closed) {
    const rcpt = await reader.client.getTransactionReceipt({ hash: closed.transactionHash });
    for (const l of parseEventLogs({ abi: xorvMarketAbi, logs: rcpt.logs, eventName: 'Payout' }) as any[]) {
      if (BigInt(l.args.id) !== BigInt(posted.job)) continue;
      if ([2, 3].includes(Number(l.args.kind))) fees += BigInt(l.args.amount);
      if (Number(l.args.kind) === 4) refund += BigInt(l.args.amount);
    }
    for (const l of parseEventLogs({ abi: xorvRegistryAbi, logs: rcpt.logs, eventName: 'Slashed' }) as any[]) if (BigInt(l.args.jobId) === BigInt(posted.job)) slashed += BigInt(l.args.amount);
  }
  if (json) return console.log(JSON.stringify({ job: posted.job, status: j.status, outcome: j.outcome, charge: j.charge.toString(), fees: fees.toString(), refund: refund.toString(), payTx: posted.tx, closeTx: closed?.transactionHash ?? null }));
  if (j.status === 'Faulted') console.log(`${el()} ${t.bad('✗ slashed')}: the winner's answer failed the check; ${slashed ? `${usd(slashed, 2)} of its stake went to you, ` : ''}refunded ${usd(refund, 6)}`);
  else console.log(`${el()} ${tick()} settled: ${usd(j.charge, 6)} for ${j.tokens} tokens${fees ? ` + ${usd(fees, 6)} check fee` : ''}, refunded ${usd(refund, 6)}`);
  if (closed) console.log(`       ${t.dim(txUrl(closed.transactionHash))}`);
  console.log(`       ${OUTCOME_TEXT[j.outcome]}  check it yourself: ${t.b(`xorv verify ${posted.job}`)}`);
}

async function jobs() {
  const limit = Number(opt('limit') ?? 10);
  const me = has('mine') ? needAccount().address.toLowerCase() : null;
  const js = (await reader.jobs(me ? 60 : limit)).filter((j) => !me || j.buyer.toLowerCase() === me).slice(0, limit);
  if (!js.length) return console.log(me ? 'No jobs from this wallet in the last 60.' : 'No jobs yet.');
  console.log(t.dim(`${'job'.padEnd(5)} ${'model'.padEnd(13)} ${'bids'.padStart(4)} ${'$/1M'.padStart(7)} ${'tokens'.padStart(6)} ${'charged'.padStart(10)}  outcome`));
  for (const j of js) {
    const out = OUTCOME_TEXT[j.outcome] || j.status;
    const paint = j.status === 'Faulted' ? t.bad : (s: string) => s;
    console.log(`${`#${j.id}`.padEnd(5)} ${modelInfo(j.model).name.padEnd(13)} ${String(j.bidCount).padStart(4)} ${(j.clearedRate ? perMillion(j.clearedRate, 3) : '—').padStart(7)} ${String(j.tokens).padStart(6)} ${usd(j.charge, 6).padStart(10)}  ${paint(out.split('.')[0])}`);
  }
}

async function verify() {
  const id = Number(positional()[0]);
  if (!Number.isInteger(id) || id < 0) throw new XorvError('usage: xorv verify <job id>');
  console.log(`${t.b(`xorv verify #${id}`)} ${t.dim(`from Avalanche Fuji (contract state + event logs), not from the Xorv gateway`)}`);
  const v = await verifyJob(reader, id);
  const name: Record<string, string> = { prompt: 'prompt', auction: 'auction', answer: 'answer', check: 'check', verdict: 'verdict', money: 'money', slash: 'slash' };
  for (const l of v.lines) console.log(`${l.ok ? tick() : cross()} ${t.b(name[l.key].padEnd(8))} ${l.text}`);
  console.log(v.ok ? t.ok(`all ${v.lines.length} checks pass`) : t.bad('some checks FAILED'));
  for (const x of v.txs.slice(-1)) console.log(t.dim(`  settlement ${x.url}`));
}

async function index() {
  const ms = await reader.indexModels();
  if (!ms.length) return console.log('No paid, checked clearing yet.');
  console.log(`${t.b('Xorv Compute Index')} ${t.dim(`${d.contracts.index} · any contract can read latest / twap / vwap`)}`);
  for (const m of ms) console.log(`  ${modelInfo(m.name).name.padEnd(13)} ${perMillion(m.rate, 3)} per 1M tokens · TWAP 1h ${m.twap1h !== null ? perMillion(m.twap1h, 3) : '—'} · ${m.observations} clearings`);
}

const CMDS: Record<string, () => Promise<void>> = { wallet, fund, models, quote, chat, ask: chat, jobs, verify, index };

(async () => {
  if (!cmd || !CMDS[cmd]) {
    console.log('usage: xorv wallet [new] | fund | models | quote "…" | chat "…" [--verify] | jobs [--mine] | verify <job> | index');
    process.exit(cmd ? 1 : 0);
  }
  await CMDS[cmd]();
})().catch((e) => {
  console.error(`${cross()} ${String(e.shortMessage ?? e.message)}`);
  process.exit(1);
});
