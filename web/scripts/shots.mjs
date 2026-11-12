/**
 * Screenshots of every route at 1440 and 375 from the production build (vite preview, which also
 * proxies /api and /v1 to the gateway), reading live Fuji, in headless Chrome under the shared lock.
 * Reports routes that scroll sideways or log console errors.
 *
 *   pnpm --filter @xorv/web preview   (in another terminal, port 5390)
 *   node web/scripts/shots.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../package.json'));
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
const OUT = process.env.SHOTS_DIR ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-xorv';
const BASE = process.env.XORV_WEB ?? 'http://127.0.0.1:5390';
const d = JSON.parse(readFileSync(join(here, '../../deployments/fuji.json'), 'utf8'));
const only = process.argv[2];

const jobs = await fetch(`${BASE}/api/index`).then((r) => r.json()).catch(() => null);
const lastJob = jobs?.models?.[0]?.observations_list?.at(-1)?.jobId ?? 0;
const routes = [
  ['/', 'landing'],
  ['/chat', 'chat'],
  ['/index', 'index'],
  ['/models', 'models'],
  [`/models/${encodeURIComponent('groq:openai/gpt-oss-20b')}`, 'model'],
  ['/providers', 'providers'],
  ['/providers/atlas', 'provider'],
  ['/providers/join', 'join'],
  ['/rankings', 'rankings'],
  [`/jobs/${lastJob}`, 'job'],
  ...((d.evidence?.slash ?? []).slice(-1).map((s) => [`/jobs/${s.job}`, 'job-slashed'])),
  ['/private', 'private'],
  ['/account', 'account'],
  ['/nope', 'not-found'],
].filter(([, n]) => !only || n === only);

await mkdir(OUT, { recursive: true });
const report = [];
await withChromeLock(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [w, h, tag] of [[1440, 900, 'desktop'], [375, 812, 'mobile']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'mobile' ? 2 : 1, colorScheme: 'dark' });
      for (const [path, name] of routes) {
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
        await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(name === 'job' || name === 'job-slashed' || name === 'private' ? 6000 : 3500);
        // walk down the page so lazy art loads, then back to the top
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const file = join(OUT, `${name}-${tag}.png`);
        await page.screenshot({ path: file, fullPage: name !== 'chat' });
        report.push({ route: path, name, viewport: tag, overflowPx: overflow, consoleErrors: errors });
        console.log(`${tag.padEnd(7)} ${name.padEnd(12)} overflow=${overflow} errors=${errors.length}${errors.length ? ' ' + errors[0] : ''}`);
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
