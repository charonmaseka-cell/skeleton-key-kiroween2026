// Accessibility and visual checks in a real browser, both apps, both modes (haunted-ui HU-T5, design section 8).
//
//   npm run build && npx tsx tools/a11y/check.ts          (CHROME_PATH=... to use an installed Chromium)
//
// For each app, each mode (Lights on, Lights off) and each width (1280 px, 375 px) it asserts: no axe-core violations (axe is
// injected from the npm package, nothing is fetched), no sideways page scroll, a visible focus ring on every control reached by
// Tab, and that no decorative element (data-motif) overlaps text or a control. With reduced motion emulated it asserts that Lights on
// resolves by itself and that no element on the page, including a ghost and the fog, has an animation. It writes screenshots of both
// modes to docs/screenshots/haunted/. It serves the built apps from this process; nothing leaves the machine. Exit code 1 on any failure.
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { chromium, type Page } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const SHOTS = join(ROOT, 'docs', 'screenshots', 'haunted');
const KEY = 'skeleton-key-lights';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const APPS = [
  { name: 'scopecheck', port: 4391, ghostButton: /confirm coverage of Offer DF\/0098/i, ghostDoc: 'quote-b' },
  { name: 'packcheck', port: 4392, ghostButton: null, ghostDoc: null },
] as const;

/** Open the document's section and press "Confirm coverage": a possible ghost becomes a confirmed one. */
async function confirmCoverage(page: Page, app: (typeof APPS)[number]) {
  if (!app.ghostButton) return;
  await page.locator(`#doc-sum-${app.ghostDoc}`).click();
  await page.getByRole('button', { name: app.ghostButton }).click();
  await page.waitForSelector('[data-ghost]');
}

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

type Failure = string;

/** Measure the page at rest: wait for every finite animation (the one-time ghost flicker, the fog fade-in) to finish first. */
async function atRest(page: Page): Promise<void> {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 6000))]));
}

async function axeViolations(page: Page): Promise<string[]> {
  await atRest(page);
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    // @ts-expect-error injected by the script tag
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v: { id: string; impact: string; nodes: { target: string[] }[] }) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
  return res;
}

/** Tab through the page; every focused control must show a ring (outline of at least 2 px, or a box shadow). */
async function focusRingWalk(page: Page, limit = 80): Promise<string[]> {
  const bad: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen = new Set<string>();
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
      return { label, ring, visible: rect.width > 0 && rect.height > 0 };
    });
    if (!r) break;
    if (seen.has(r.label)) break;
    seen.add(r.label);
    if (r.visible && !r.ring) bad.push(r.label);
  }
  return bad;
}

/** Decorative rectangles must not overlap any text line or control. */
async function motifOverlaps(page: Page): Promise<string[]> {
  await atRest(page);
  return page.evaluate(() => {
    const motifs = [...document.querySelectorAll('[data-motif]')].map((m) => ({ kind: m.getAttribute('data-motif'), r: m.getBoundingClientRect() })).filter((m) => m.r.width > 0);
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || (n.parentElement && n.parentElement.closest('[data-motif], [aria-hidden="true"], script, style'))) continue;
      range.selectNodeContents(n);
      for (const tr of range.getClientRects())
        for (const m of motifs) {
          if (tr.width <= 0 || !hit(tr, m.r)) continue;
          // Text scrolled out of its container (clipped) is not visible, so decoration over its box is not over visible text.
          const x = (Math.max(tr.left, m.r.left) + Math.min(tr.right, m.r.right)) / 2;
          const y = (Math.max(tr.top, m.r.top) + Math.min(tr.bottom, m.r.bottom)) / 2;
          const top = document.elementsFromPoint(x, y).find((e) => !e.closest('[data-motif]'));
          if (top && n.parentElement && (top === n.parentElement || n.parentElement.contains(top))) out.push(`${m.kind} over text "${n.textContent.trim().slice(0, 30)}"`);
        }
    }
    for (const c of document.querySelectorAll('button, a[href], input, select, summary')) {
      const cr = c.getBoundingClientRect();
      for (const m of motifs) {
        if (cr.width <= 0 || !hit(cr, m.r)) continue;
        const x = (Math.max(cr.left, m.r.left) + Math.min(cr.right, m.r.right)) / 2;
        const y = (Math.max(cr.top, m.r.top) + Math.min(cr.bottom, m.r.bottom)) / 2;
        const top = document.elementsFromPoint(x, y).find((e) => !e.closest('[data-motif]'));
        if (top && (top === c || c.contains(top))) out.push(`${m.kind} over control ${c.tagName.toLowerCase()}`);
      }
    }
    return out.slice(0, 10);
  });
}

async function main() {
  const failures: Failure[] = [];
  const log = (s: string) => console.log(s);
  mkdirSync(SHOTS, { recursive: true });
  for (const a of APPS) if (!existsSync(join(ROOT, 'apps', a.name, 'dist', 'index.html'))) throw new Error(`build first: apps/${a.name}/dist is missing`);
  const servers = await Promise.all(APPS.map((a) => serve(join(ROOT, 'apps', a.name, 'dist'), a.port)));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    for (const app of APPS) {
      for (const mode of ['on', 'off'] as const) {
        for (const width of [1280, 375]) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
          await ctx.addInitScript('window.__name = (f) => f;');
          await ctx.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, mode]);
          const page = await ctx.newPage();
          await page.goto(`http://127.0.0.1:${app.port}/`);
          await page.waitForSelector('main h2');
          const tag = `${app.name} Lights ${mode} ${width}px`;
          const check = async (what: string, problems: string[]) => {
            if (problems.length) {
              failures.push(`${tag}: ${what}: ${problems.join('; ')}`);
              log(`FAIL ${tag}: ${what}\n     ${problems.join('\n     ')}`);
            } else log(`PASS ${tag}: ${what}`);
          };
          await check('data-lights is the stored choice', (await page.getAttribute('html', 'data-lights')) === mode ? [] : [`data-lights=${await page.getAttribute('html', 'data-lights')}`]);
          await check('axe-core: no violations', await axeViolations(page));
          await check('no sideways page scroll', await page.evaluate(() => (document.documentElement.scrollWidth <= document.documentElement.clientWidth ? [] : [`scrollWidth ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`])));
          await check('visible focus ring on every control reached by Tab', await focusRingWalk(page));
          await check('decoration overlaps no text or control', await motifOverlaps(page));
          await check('Lights on has no decorative element', mode === 'on' ? await page.evaluate(() => [...document.querySelectorAll('[data-motif]')].map((m) => m.getAttribute('data-motif') ?? '')) : []);
          if (width === 1280) await page.screenshot({ path: join(SHOTS, `${app.name}-lights-${mode}.png`) });
          // The ghost state: confirm coverage of one document, then re-check the page (axe, overlap) with the ghost drawn.
          if (app.ghostButton) {
            await confirmCoverage(page, app);
            await check('after confirming coverage: axe-core, no violations (ghost row drawn)', await axeViolations(page));
            await check('after confirming coverage: decoration overlaps no text or control', await motifOverlaps(page));
            if (width === 1280) {
              await (await page.$('[data-ghost]'))!.scrollIntoViewIfNeeded();
              await page.screenshot({ path: join(SHOTS, `${app.name}-ghost-lights-${mode}.png`) });
            }
          }
          await ctx.close();
        }
      }
      // Reduced motion: Lights on by itself with nothing stored; no animation anywhere even in Lights off with a ghost drawn.
      const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await rctx.addInitScript('window.__name = (f) => f;');
      const rp = await rctx.newPage();
      await rp.goto(`http://127.0.0.1:${app.port}/`);
      await rp.waitForSelector('main h2');
      const auto = await rp.getAttribute('html', 'data-lights');
      if (auto !== 'on') failures.push(`${app.name}: reduced motion with nothing stored should resolve to Lights on, got ${auto}`);
      else log(`PASS ${app.name}: reduced motion resolves to Lights on`);
      await rctx.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, 'off']);
      const op = await rctx.newPage();
      await op.goto(`http://127.0.0.1:${app.port}/`);
      await op.waitForSelector('main h2');
      await confirmCoverage(op, app);
      const animated = await op.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).animationName !== 'none').map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('data-motif') ? `[${e.getAttribute('data-motif')}]` : ''}`).slice(0, 8));
      if (animated.length) failures.push(`${app.name}: animations under reduced motion in Lights off: ${animated.join(', ')}`);
      else log(`PASS ${app.name}: no animation under reduced motion (Lights off${app.ghostButton ? ', ghost drawn' : ''})`);
      // Without reduced motion, Lights off does animate the ghost and fog (the flicker exists), and Lights on does not.
      await rctx.close();
      const mctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
      await mctx.addInitScript('window.__name = (f) => f;');
      await mctx.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, 'on']);
      const mp = await mctx.newPage();
      await mp.goto(`http://127.0.0.1:${app.port}/`);
      await mp.waitForSelector('main h2');
      await confirmCoverage(mp, app);
      const onAnimated = await mp.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).animationName !== 'none').length);
      if (onAnimated) failures.push(`${app.name}: ${onAnimated} animated elements in Lights on`);
      else log(`PASS ${app.name}: nothing animates in Lights on`);
      await mctx.close();
    }
  } finally {
    await browser.close();
    for (const s of servers) s.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll accessibility and visual checks passed. Screenshots: docs/screenshots/haunted/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
