// Before/after screenshots at 1280 px of the bolder theme (gutter fog, margin ghost, séance illustration, display font).
//   npm run build && npx tsx tools/a11y/before-after.ts before|after      (CHROME_PATH=... for an installed Chromium)
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const label = process.argv[2] === 'before' ? 'before' : 'after';
const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'docs', 'screenshots', 'haunted', 'before-after');
const T: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
mkdirSync(OUT, { recursive: true });
const server = createServer((q, r) => {
  let f = join(ROOT, 'apps/scopecheck/dist', (q.url || '/').split('?')[0]!);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(ROOT, 'apps/scopecheck/dist/index.html');
  r.writeHead(200, { 'content-type': T[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(r);
}).listen(4421);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
await ctx.addInitScript('window.__name = (f) => f;');
await ctx.addInitScript(([k, v]) => localStorage.setItem(k!, v!), ['skeleton-key-lights', 'off']);
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4421/');
await page.waitForSelector('main h2');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(5200); // the one-time fades have finished
const shot = async (name: string) => {
  await page.screenshot({ path: join(OUT, `${label}-${name}.png`) });
  console.log('saved', `${label}-${name}`);
};
await shot('1-top-title-and-seance');
await page.evaluate(() => document.getElementById('confirmed-h')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(600);
await shot('2-page-gutters');
// A missing item becomes confirmed: Confirm coverage of the Delta offer. The "after" build lets a ghost drift along the margin.
await page.evaluate(() => scrollTo(0, 0));
await page.locator('#doc-sum-quote-b').scrollIntoViewIfNeeded();
await page.locator('#doc-sum-quote-b').click();
await page.getByRole('button', { name: /confirm coverage of Offer DF\/0098/i }).click();
await page.waitForTimeout(1500);
await shot('3-missing-item-confirmed');
await browser.close();
server.close();
