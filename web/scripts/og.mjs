/**
 * Renders the social card (public/brand/xorv-og-v2.jpg, 1200x630) from the ChatGPT scene
 * public/art/3d/xorv-og-bg.webp plus real type, so the image never carries generated text.
 * One headless Chrome under the shared lock.  node web/scripts/og.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '../public/');
const require = createRequire(join(here, '../package.json'));
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
const bg = readFileSync(pub + 'art/3d/xorv-og-bg.webp').toString('base64');
const mark = readFileSync(pub + 'brand/xorv-mark-white.png').toString('base64');
const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;background:#080808;font-family:'Golos Text',sans-serif;color:#efefef}
  .bg{position:absolute;inset:0;background:url(data:image/webp;base64,${bg}) right center/auto 100% no-repeat}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,#080808 0%,rgba(8,8,8,.9) 40%,rgba(8,8,8,0) 64%)}
  .t{position:absolute;left:72px;top:96px;width:640px}
  .brand{display:flex;align-items:center;gap:12px;font-weight:600;font-size:30px;letter-spacing:-.02em}
  .brand img{width:36px;height:36px}
  h1{margin:52px 0 0;font-weight:600;font-size:68px;line-height:1.02;letter-spacing:-.035em}
  p{margin:26px 0 0;font-size:24px;line-height:1.45;color:#a3a3a3;max-width:540px}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="t"><div class="brand"><img src="data:image/png;base64,${mark}">Xorv</div>
<h1>Every AI request goes to the lowest bidder</h1><p>Pay per message. Sealed-bid auctions on Avalanche set the price.</p></div>
</body></html>`;

await withChromeLock(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
    await p.setContent(html, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: pub + 'brand/xorv-og-v2.jpg', type: 'jpeg', quality: 86 });
  } finally {
    await b.close();
  }
});
console.log('wrote public/brand/xorv-og-v2.jpg');
