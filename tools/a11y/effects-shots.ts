// Screenshots (and one short recording) of each signature effect, at 1280 px, caught at the moment it is most visible.
//
//   npm run build && npx tsx tools/a11y/effects-shots.ts      (CHROME_PATH=... for an installed Chromium; PLAYWRIGHT_BROWSERS_PATH
//                                                                for the recording, which needs Playwright's ffmpeg)
//
// Output: docs/screenshots/haunted/effects/NN-name.png and haunted-pass.webm. Not part of CI: it is for reading and for the demo.
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'docs', 'screenshots', 'haunted', 'effects');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const APPS = { scopecheck: 4393, packcheck: 4394 } as const;

function serve(dir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const made: string[] = [];
async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
  made.push(name);
  console.log('saved', name);
}
const box = async (page: Page, selector: string, pad = 16) => {
  await page.locator(selector).first().scrollIntoViewIfNeeded(); // the clip is in viewport coordinates
  const b = (await page.locator(selector).first().boundingBox())!;
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(1280 - Math.max(0, b.x - pad), b.width + 2 * pad), height: b.height + 2 * pad };
};
const open = async (ctx: BrowserContext, app: keyof typeof APPS, clock = false) => {
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  await page.goto(`http://127.0.0.1:${APPS[app]}/`);
  await page.waitForSelector('main h2');
  return page;
};
const pause = (page: Page, animationName: string, t: number) =>
  page.evaluate(([n, ms]) => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === n).forEach((a) => { a.pause(); a.currentTime = Number(ms); }), [animationName, t] as const);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const servers = await Promise.all(Object.entries(APPS).map(([a, port]) => serve(join(ROOT, 'apps', a, 'dist'), port)));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const newCtx = async (mode: 'off' | 'on', video = false) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference', ...(video ? { recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } } : {}) });
    await ctx.addInitScript('window.__name = (f) => f;');
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k!, v!), ['skeleton-key-lights', mode]);
    return ctx;
  };
  try {
    const ctx = await newCtx('off');
    // 01 candles, 12 fog (after its four-second fade-in)
    let page = await open(ctx, 'scopecheck');
    await page.waitForTimeout(4300);
    await shot(page, '01-candles-and-fog-header', { x: 0, y: 0, width: 1280, height: 330 });
    // 02 candle snuffed (the flame is out, smoke rising)
    await page.locator('#doc-sum-quote-b').scrollIntoViewIfNeeded();
    await page.locator('#doc-sum-quote-b').click();
    await page.getByRole('button', { name: /confirm coverage of Offer DF\/0098/i }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(500);
    await shot(page, '02-candle-snuffed-smoke-wisp', { x: 0, y: 0, width: 1280, height: 330 });
    // 11 ink drip (the same action confirmed a critical finding): let the drop run
    await page.waitForTimeout(700);
    await shot(page, '11-ink-drip-right-margin', { x: 880, y: 0, width: 400, height: 330 });
    // 08 ghost drift
    const ghost = page.locator('td[data-ghost]').first();
    await ghost.scrollIntoViewIfNeeded();
    await ghost.hover();
    await page.waitForTimeout(650);
    await shot(page, '08-ghost-drift-through-missing-item-cell', await box(page, 'td[data-ghost]', 24));
    await page.mouse.move(5, 5);
    // 03 planchette: mid-glide, then arrived
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole('button', { name: 'Next finding' }).click();
    await page.waitForSelector('[data-planchette]'); // placed once the page has stopped scrolling
    await page.waitForTimeout(300);
    await shot(page, '03a-planchette-mid-glide');
    await page.waitForTimeout(600);
    await shot(page, '03b-planchette-arrived-focus-on-the-finding');
    // 06 and 07 possessed: glitch (frozen at 120 ms) and both evidence lines glowing
    const cell = page.locator('td[data-possessed="spec"]').first();
    await cell.scrollIntoViewIfNeeded();
    await cell.hover();
    await pause(page, 'glitch-border', 120);
    await shot(page, '06-possessed-border-glitch', await box(page, 'td[data-possessed="spec"]:hover', 14));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    const link = cell.locator('a[href^="#finding-"]').first();
    const id = (await link.getAttribute('href'))!.slice(1);
    await link.focus(); // focus also makes the evidence glow
    await page.waitForTimeout(350);
    await shot(page, '07-evidence-lines-glow-while-cell-is-focused', await box(page, `#${id} [data-evidence]`, 20));
    // 09 seal, 10 ghostly fade
    await page.getByRole('button', { name: 'Next finding' }).click();
    await page.locator('article:focus').getByRole('button', { name: /^Accept:/ }).click();
    await page.waitForTimeout(450);
    await shot(page, '09-wax-seal-stamped-on-accept', await box(page, 'article:has([data-seal])', 12));
    await page.getByRole('button', { name: 'Next finding' }).click();
    await page.locator('article:focus').getByRole('button', { name: /^Dismiss:/ }).click();
    await page.waitForTimeout(260);
    await pause(page, 'ghost-fade', 380);
    await shot(page, '10-ghostly-fade-on-dismiss-card-stays-and-can-reopen', await box(page, 'article[data-dismissed]', 30));
    // 13 mist
    await page.evaluate(() => scrollTo(0, 0));
    for (let i = 0; i < 14; i++) {
      await page.mouse.move(160 + i * 60, 90 + Math.sin(i / 2) * 40);
      await page.waitForTimeout(50);
    }
    await shot(page, '13-cursor-mist-trail', { x: 0, y: 0, width: 1280, height: 330 });
    // 15 boo
    await page.mouse.move(5, 700);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.type('boo');
    await page.waitForTimeout(900);
    await shot(page, '15-easter-egg-boo-ghosts-behind-the-page');
    await page.waitForTimeout(2200);
    // 14 lights flicker: the peak of the first flash, then Lights on
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole('button', { name: 'Lights on' }).click();
    await page.waitForTimeout(85);
    await shot(page, '14-lights-flicker-first-flash');
    await page.waitForTimeout(1200);
    await shot(page, '14b-lights-on-no-effects', { x: 0, y: 0, width: 1280, height: 330 });
    await page.close();

    // 05 whisper (ScopeCheck) and PackCheck's own wording
    page = await open(ctx, 'scopecheck', true);
    // the context stored Lights on by now? no: each context has its own storage; this one was switched, so force Lights off again
    await page.evaluate(() => localStorage.setItem('skeleton-key-lights', 'off'));
    await page.reload();
    await page.waitForSelector('main h2');
    await page.clock.fastForward(46_000);
    await page.waitForSelector('[data-whisper] button');
    await shot(page, '05a-idle-whisper-scopecheck', { x: 0, y: 0, width: 1280, height: 330 });
    await page.close();
    page = await open(ctx, 'packcheck', true);
    await page.evaluate(() => localStorage.setItem('skeleton-key-lights', 'off'));
    await page.reload();
    await page.waitForSelector('main h2');
    await page.clock.fastForward(46_000);
    await page.waitForSelector('[data-whisper] button');
    await page.waitForTimeout(300);
    await shot(page, '05b-idle-whisper-packcheck-own-words', { x: 0, y: 0, width: 1280, height: 330 });
    await page.close();
    await ctx.close();

    // The same page with effects off (Lights on) and under reduced motion: same information, no decoration
    const on = await newCtx('on');
    page = await open(on, 'scopecheck');
    await shot(page, '16-same-page-lights-on-no-effects', { x: 0, y: 0, width: 1280, height: 330 });
    await on.close();
    const rm = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    await rm.addInitScript(([k, v]) => localStorage.setItem(k!, v!), ['skeleton-key-lights', 'off']);
    page = await open(rm, 'scopecheck');
    await shot(page, '17-same-page-reduced-motion-no-effects', { x: 0, y: 0, width: 1280, height: 330 });
    await rm.close();

    // A short recording of the whole sequence (needs ffmpeg: PLAYWRIGHT_BROWSERS_PATH=/inner_container/opt/playwright)
    if (process.env.RECORD) {
      const vctx = await newCtx('off', true);
      const v = await open(vctx, 'scopecheck');
      await v.waitForTimeout(1500);
      await v.locator('#doc-sum-quote-b').click();
      await v.getByRole('button', { name: /confirm coverage of Offer DF\/0098/i }).click();
      await v.waitForTimeout(2500);
      await v.locator('td[data-ghost]').first().scrollIntoViewIfNeeded();
      await v.locator('td[data-ghost]').first().hover();
      await v.waitForTimeout(2800);
      await v.evaluate(() => scrollTo(0, 0));
      for (let i = 0; i < 3; i++) {
        await v.getByRole('button', { name: 'Next finding' }).click();
        await v.waitForTimeout(1500);
      }
      await v.locator('td[data-possessed="spec"]').first().scrollIntoViewIfNeeded();
      await v.locator('td[data-possessed="spec"]').first().hover();
      await v.waitForTimeout(1800);
      await v.getByRole('button', { name: 'Next finding' }).click();
      await v.locator('article:focus').getByRole('button', { name: /^Accept:/ }).click();
      await v.waitForTimeout(1500);
      await v.getByRole('button', { name: 'Next finding' }).click();
      await v.locator('article:focus').getByRole('button', { name: /^Dismiss:/ }).click();
      await v.waitForTimeout(1800);
      await v.evaluate(() => scrollTo(0, 0));
      for (let i = 0; i < 30; i++) {
        await v.mouse.move(100 + i * 36, 120 + Math.sin(i / 3) * 60);
        await v.waitForTimeout(40);
      }
      await v.mouse.move(5, 700);
      await v.keyboard.type('boo');
      await v.waitForTimeout(3000);
      await v.getByRole('button', { name: 'Lights on' }).click();
      await v.waitForTimeout(2000);
      await vctx.close();
    }
  } finally {
    await browser.close();
    for (const s of servers) s.close();
  }
  console.log(`${made.length} screenshots in docs/screenshots/haunted/effects/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
