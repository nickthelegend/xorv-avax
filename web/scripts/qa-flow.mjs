/**
 * One real end-to-end flow from the web app on Avalanche Fuji, driven by Playwright:
 * the QA build (VITE_XORV_QA=1, web/dist-qa) gets the repo's Fuji QA test key injected at runtime as
 * window.__XORV_QA_KEY__, opens /chat, sends one message paid with x402 (EIP-3009 signed in the page),
 * waits for the sealed-bid auction, the delivered answer and settlement, and records the job id and the
 * settlement transaction in deployments/fuji.json -> evidence.webQaFlow.
 *
 * The key is read from the gitignored .env by NAME (XORV_QA_KEY) and never printed. The normal build
 * contains no QA code path. Needs the gateway running on 5421 with provider nodes.
 *
 *   pnpm --filter @xorv/web build:qa && node web/scripts/qa-flow.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const root = join(web, '..');
const require = createRequire(join(web, 'package.json'));
const { chromium } = require('playwright-core');
const { privateKeyToAccount } = await import(require.resolve('viem/accounts'));
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
const PORT = 5391;
const SHOTS = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-xorv';
const PROMPT = process.env.QA_PROMPT ?? 'In two sentences: what does a compute price index tell a buyer of AI work?';

function keyByName(name) {
  const line = readFileSync(join(root, '.env'), 'utf8').split('\n').find((l) => l.trim().startsWith(`${name}=`));
  if (!line) throw new Error(`Setup required: ${name} in the repo .env`);
  const v = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  return v.startsWith('0x') ? v : `0x${v}`;
}

if (!existsSync(join(web, 'dist-qa/index.html'))) throw new Error('Build the QA bundle first: pnpm --filter @xorv/web build:qa');
const key = keyByName('XORV_QA_KEY');
const qa = privateKeyToAccount(key).address;

const server = spawn(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', 'dist-qa', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
for (let i = 0; i < 40; i++) {
  const ok = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok).catch(() => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}

let result;
try {
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
      await ctx.addInitScript((k) => { window.__XORV_QA_KEY__ = k; try { localStorage.setItem('xorv.wallet', 'qa'); } catch { /* ignore */ } }, key);
      const page = await ctx.newPage();
      const errors = [];
      const step = (t) => console.log(`  · ${t}`);
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
      try {
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/chat`, { waitUntil: 'domcontentloaded' });
      step('opened /chat');
      await page.getByText('provider nodes online').waitFor({ timeout: 60_000 });
      await page.getByText('QA signer').first().waitFor({ timeout: 30_000 });
      step('QA signer connected, gateway ready');
      const box = page.locator('#chat-in');
      await page.waitForFunction(() => !document.querySelector('#chat-in')?.getAttribute('placeholder')?.startsWith('Chat opens'), null, { timeout: 60_000 });
      await box.fill(PROMPT);
      await page.locator('button.send').click();
      console.log('sent; waiting for the auction, the answer and settlement…');
      await page.locator('.answer').first().waitFor({ timeout: 240_000 });
      step('answer delivered');
      await page.locator('.receipt-bar a', { hasText: 'Job #' }).first().waitFor({ timeout: 240_000 });
      const jobHref = await page.locator('.receipt-bar a', { hasText: 'Job #' }).first().getAttribute('href');
      const settleHref = await page.locator('.receipt-bar a', { hasText: 'x402 settlement' }).first().getAttribute('href');
      const answer = (await page.locator('.answer').first().innerText()).trim();
      await page.locator('details.prompt').first().evaluate((el) => { el.open = true; }).catch(() => {});
      await page.screenshot({ path: join(SHOTS, 'chat-qa-flow-desktop.png'), fullPage: false });
      result = { job: Number(jobHref.split('/').pop()), settleTx: settleHref.split('/').pop(), payer: qa, answerChars: answer.length, pageErrors: errors.length };
      // follow the job page once so the record screenshot shows the settled job
      await page.goto(`http://127.0.0.1:${PORT}/jobs/${result.job}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Transactions').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(8000);
      await page.screenshot({ path: join(SHOTS, 'job-qa-flow-desktop.png'), fullPage: true });
      } catch (e) {
        await page.screenshot({ path: join(SHOTS, 'qa-flow-failure.png') }).catch(() => {});
        console.log('page errors:', errors.slice(0, 5));
        throw e;
      }
    } finally {
      await browser.close();
    }
  });
} finally {
  stop();
}

const file = join(root, 'deployments/fuji.json');
const d = JSON.parse(readFileSync(file, 'utf8'));
d.evidence ??= {};
d.evidence.webQaFlow ??= [];
d.evidence.webQaFlow.push({ at: new Date().toISOString(), flow: 'web /chat, QA signer, x402 exact (EIP-3009) -> X402Router.payAndPost -> sealed-bid auction -> delivery', ...result, snowtrace: `https://testnet.snowtrace.io/tx/${result.settleTx}` });
writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
console.log(`web QA flow: job #${result.job} · settlement ${result.settleTx} · payer ${qa} · answer ${result.answerChars} chars`);
