/**
 * The zero-setup judge path, end to end, in headless Chrome with a fresh profile (no browser wallet, empty storage):
 *   /chat → "Start with a test wallet" (one tap: key in the browser, XorvGasStation sends tUSD and a sip of AVAX)
 *   → a paid x402 chat (sealed-bid auction on Fuji) → the answer and its Snowtrace settlement link.
 * With --private it goes on: a private top-up of the desk proved in the browser (Ava Labs' eERC SDK), the desk's
 * signed receipt checked on Fuji, then a chat paid from private credit.
 *
 *   node web/scripts/judge-flow.mjs [--private]          (XORV_WEB defaults to the hosted app)
 * Records the transactions in deployments/fuji.json → evidence.judgePath. Screenshots go to SHOTS_DIR.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../package.json'));
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
const BASE = process.env.XORV_WEB ?? 'https://xorv-avax.vercel.app';
const OUT = process.env.SHOTS_DIR ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-xorv/9round';
const PRIVATE = process.argv.includes('--private');
const RECORD = !process.argv.includes('--no-record');
const QUESTION = process.env.QUESTION ?? 'In two sentences: why do sealed-bid auctions resist price collusion?';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

await mkdir(OUT, { recursive: true });
const result = { base: BASE, at: new Date().toISOString(), consoleErrors: [] };

async function ask(page, text, tag) {
  const ta = page.locator('#chat-in');
  await ta.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('#chat-in')?.getAttribute('placeholder') === 'Ask anything…', null, { timeout: 120_000 });
  await ta.fill(text);
  await ta.press('Enter');
  log(`${tag}: sent`);
  const settle = page.locator('.receipt-bar a', { hasText: tag === 'x402' ? 'x402 settlement' : 'Desk post' }).last();
  const err = page.locator('.err-box').last();
  await Promise.race([settle.waitFor({ timeout: 200_000 }), err.waitFor({ timeout: 200_000 }).then(async () => { throw new Error(`${tag}: ${await err.innerText()}`); })]);
  const href = await settle.getAttribute('href');
  const job = await page.locator('.receipt-bar a', { hasText: 'record' }).last().innerText();
  const answer = (await page.locator('.answer').last().innerText()).slice(0, 400);
  log(`${tag}: ${job} · ${href}`);
  return { job: Number(job.match(/#(\d+)/)?.[1]), settlement: href, answer };
}

await withChromeLock(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 240)); });
    page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${e.message.slice(0, 240)}`));
    await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle', timeout: 60_000 });
    const start = page.getByRole('button', { name: 'Start with a test wallet' });
    await start.waitFor({ timeout: 60_000 });
    await page.screenshot({ path: join(OUT, 'judge-1-empty-1440.png') });
    await start.click();
    log('tapped Start with a test wallet');
    await page.waitForFunction(() => document.querySelector('#chat-in')?.getAttribute('placeholder') === 'Ask anything…', null, { timeout: 120_000 });
    result.wallet = await page.evaluate(() => document.querySelector('.chat-side-f b')?.textContent ?? null);
    const addr = await page.evaluate(async () => {
      const k = localStorage.getItem('xorv.testwallet.v1');
      return k ? null : 'no key';
    });
    if (addr) throw new Error('no test wallet key in storage');
    await page.screenshot({ path: join(OUT, 'judge-2-funded-1440.png') });
    result.x402 = await ask(page, QUESTION, 'x402');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(OUT, 'judge-3-answer-1440.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, 'judge-3-answer-375.png') });
    await page.setViewportSize({ width: 1440, height: 900 });

    // the wallet address and its funding transaction, from the Account page
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    result.address = (await page.locator('.mono-c').first().innerText()).trim();
    log('test wallet', result.address);

    if (PRIVATE) {
      await page.goto(`${BASE}/account/private`, { waitUntil: 'networkidle' });
      await page.locator('#topup').fill('0.5');
      await page.getByRole('button', { name: 'Top up privately' }).click();
      log('private top-up: proving in the browser');
      const done = page.locator('p.note', { hasText: 'Done. The desk credits it' });
      const bad = page.locator('section p.note.bad-c').first();
      await Promise.race([done.waitFor({ timeout: 300_000 }), bad.waitFor({ timeout: 300_000 }).then(async () => { throw new Error(`top-up: ${await bad.innerText()}`); })]);
      result.topup = await page.locator('ol.steps li a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      log('top-up txs', result.topup);
      await page.screenshot({ path: join(OUT, 'judge-4-topup-1440.png'), fullPage: true });
      // the desk attributes top-ups every 30 s; asking for the credit also syncs
      let checks = [];
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(10_000);
        await page.getByRole('button', { name: /Sign to see and check my credit|Checking/ }).click();
        await page.locator('p.note', { hasText: /Every line checks out|Some lines do not/ }).waitFor({ timeout: 120_000 });
        checks = await page.locator('ol.steps').last().locator('li').evaluateAll((ls) => ls.map((l) => `${l.className}: ${l.textContent}`));
        if (checks.some((c) => /Top-up of/.test(c))) break;
      }
      result.receipt = checks;
      log('receipt checks', checks);
      await page.screenshot({ path: join(OUT, 'judge-5-receipt-1440.png'), fullPage: true });
      await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Private credit' }).click();
      result.private = await ask(page, 'Name two uses of encrypted balances for a business, in one sentence each.', 'private');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(OUT, 'judge-6-private-answer-1440.png') });
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});

console.log(JSON.stringify(result, null, 2));
if (RECORD && result.x402?.settlement) {
  const f = join(here, '../../deployments/fuji.json');
  const d = JSON.parse(await readFile(f, 'utf8'));
  d.evidence ??= {};
  d.evidence.judgePath ??= [];
  d.evidence.judgePath.push({ at: result.at, base: BASE, address: result.address, x402: result.x402, topup: result.topup ?? null, receipt: result.receipt ?? null, private: result.private ?? null, consoleErrors: result.consoleErrors.length });
  await writeFile(f, `${JSON.stringify(d, null, 2)}\n`);
  console.log('recorded deployments/fuji.json evidence.judgePath');
}
