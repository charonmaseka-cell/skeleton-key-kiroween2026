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
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const SHOTS = join(ROOT, 'docs', 'screenshots', 'haunted');
const KEY = 'skeleton-key-lights';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const APPS = [
  { name: 'scopecheck', port: 4391, ghostButton: /confirm coverage of Offer DF\/0098/i, ghostDoc: 'quote-b' },
  { name: 'packcheck', port: 4392, ghostButton: /confirm coverage of Application form/i, ghostDoc: 'application-form' },
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
    let status = 200;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Like Cloudflare Pages: a path with no file is answered with 404 and the top-level 404.html (a missing asset gets a bare 404).
      if (extname(path)) {
        res.writeHead(404).end();
        return;
      }
      if (path === '/' || path === '') file = join(dir, 'index.html');
      else {
        file = join(dir, '404.html');
        status = 404;
      }
    }
    res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
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

/**
 * Decoration must not COVER text or a control. Decoration drawn behind them (the fog, the mist, the "boo" ghosts: negative z-index) is
 * fine; decoration painted above them is not. Paint order is read from the browser: the decoration is made hit-testable for a moment,
 * and for every place where it overlaps visible text or a control the stack of elements under that point says which is on top.
 */
async function motifOverlaps(page: Page, rest = true): Promise<string[]> {
  if (rest) await atRest(page);
  return page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '[data-motif], [data-motif] * { pointer-events: auto !important; }';
    document.head.appendChild(style);
    try {
      // decoration that is not visible (faded out, or finished its animation at opacity 0) covers nothing
      const visible = (e: Element) => { for (let n: Element | null = e; n; n = n.parentElement) if (parseFloat(getComputedStyle(n).opacity) < 0.05 || getComputedStyle(n).visibility === 'hidden') return false; return true; };
      const motifs = [...document.querySelectorAll('[data-motif]')].filter(visible).map((m) => ({ kind: m.getAttribute('data-motif'), r: m.getBoundingClientRect() })).filter((m) => m.r.width > 0 && m.r.height > 0);
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const out: string[] = [];
      const centre = (a: DOMRect, b: DOMRect) => [(Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2, (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2] as const;
      const covers = (x: number, y: number, owner: Element | null) => {
        if (!owner) return false;
        const stack = document.elementsFromPoint(x, y);
        const iM = stack.findIndex((e) => e.closest('[data-motif]'));
        const iT = stack.findIndex((e) => e === owner || owner.contains(e));
        return iM >= 0 && iT >= 0 && iM < iT; // the decoration is above it
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || (n.parentElement && n.parentElement.closest('[data-motif], script, style, .sr-only'))) continue;
        range.selectNodeContents(n);
        for (const tr of range.getClientRects())
          for (const m of motifs) {
            if (tr.width < 4 || !hit(tr, m.r)) continue;
            const [x, y] = centre(tr, m.r);
            if (covers(x, y, n.parentElement)) out.push(`${m.kind} over text "${n.textContent.trim().slice(0, 30)}"`);
          }
      }
      for (const c of document.querySelectorAll('button, a[href], input, select, summary')) {
        const cr = c.getBoundingClientRect();
        for (const m of motifs) {
          if (cr.width <= 0 || !hit(cr, m.r)) continue;
          const [x, y] = centre(cr, m.r);
          if (covers(x, y, c)) out.push(`${m.kind} over control ${c.tagName.toLowerCase()}`);
        }
      }
      return out.slice(0, 10);
    } finally {
      style.remove();
    }
  });
}

async function noSideways(page: Page): Promise<string[]> {
  return page.evaluate(() => (document.documentElement.scrollWidth <= document.documentElement.clientWidth ? [] : [`scrollWidth ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`]));
}

/**
 * "Next finding" from the top of the page: the target must end up inside the viewport (below the sticky banner), focused, and the page
 * must have scrolled to get there. Waits for a smooth scroll to finish (up to 4 s) before judging, so it checks the outcome, not the timing.
 */
async function nextFindingInView(page: Page): Promise<string[]> {
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Next finding' }).click();
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const y = await page.evaluate(() => scrollY);
    if (y === last && y > 0) break;
    last = y;
  }
  const r = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const b = a.getBoundingClientRect();
    return { tag: a.tagName, id: a.id, top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), vh: innerHeight, y: Math.round(scrollY) };
  });
  const bad: string[] = [];
  if (r.tag !== 'ARTICLE' || !r.id.startsWith('finding-')) bad.push(`focus is on ${r.tag} ${r.id}, not a finding`);
  if (r.y <= 0) bad.push(`the page did not scroll (scrollY ${r.y})`);
  if (!(r.top >= 40 && r.top < r.vh * 0.75)) bad.push(`the finding starts at ${r.top}px in a ${r.vh}px viewport: not in view`);
  if (!(r.bottom <= r.vh || r.height > r.vh * 0.8)) bad.push(`the finding ends at ${r.bottom}px, below the ${r.vh}px viewport`);
  return bad;
}

/** Judge where the focused finding is now, without clicking. */
async function nextFindingInViewNow(page: Page): Promise<string[]> {
  const r = await page.evaluate(() => {
    const b = (document.activeElement as HTMLElement).getBoundingClientRect();
    return { top: Math.round(b.top), vh: innerHeight };
  });
  return r.top >= 40 && r.top < r.vh * 0.75 ? [] : [`the focused finding starts at ${r.top}px in a ${r.vh}px viewport`];
}

const urlOf = (app: (typeof APPS)[number]) => `http://127.0.0.1:${app.port}/`;

/**
 * The signature effects (HU-17 to HU-27), each in the state that triggers it, with the checks that matter: axe, no decoration above
 * text or a control, no sideways scroll. Lights off with motion allowed only (that is when the effects exist).
 */
async function effectStates(ctx: BrowserContext, app: (typeof APPS)[number], tag: string, width: number, check: (page: Page, what: string, problems: string[]) => Promise<void>): Promise<void> {
  const full = async (page: Page, what: string) => {
    await check(page, `${what}: axe-core`, await axeViolations(page));
    await check(page, `${what}: decoration covers no text or control`, await motifOverlaps(page));
    await check(page, `${what}: no sideways page scroll`, await noSideways(page));
  };
  const expectThat = async (page: Page, what: string, ok: boolean, detail = '') => check(page, what, ok ? [] : [detail || 'not as expected']);

  // Next finding when the browser drops every smooth scroll (an interrupted smooth scroll leaves the page where it was): the target must
  // still end up in view. This is the failure reported on the live site, which the plain run above does not reproduce in headless Chromium.
  const dropped = await ctx.newPage();
  await dropped.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, a?: boolean | ScrollIntoViewOptions) {
      if (a && typeof a === 'object' && a.behavior === 'smooth') return;
      return original.call(this, a as never);
    };
  });
  await dropped.goto(urlOf(app));
  await dropped.waitForSelector('main h2');
  await check(dropped, 'Next finding still reaches the target when smooth scrolls are dropped', await nextFindingInView(dropped));
  await dropped.close();

  const page = await ctx.newPage();
  await page.goto(urlOf(app));
  await page.waitForSelector('main h2');
  // HU-17 candles: lit candles = the Needs review count in the summary
  const lit = await page.locator('[data-candle][data-lit="true"]').count();
  const needs = Number(await page.locator('dl[aria-label="Summary"] dt:text-is("Needs review") + dd').textContent());
  await expectThat(page, 'candles: one lit candle per item that needs review', lit === needs && lit > 0, `${lit} candles, ${needs} in the summary`);
  await full(page, 'candles');
  // HU-29 to HU-31: gutter fog (wide only), the séance card, the display face
  await expectThat(page, 'gutter fog: drawn at 1280 px and wider, not narrower', (await page.locator('[data-gutter-fog]').evaluateAll((els) => els.map((e) => getComputedStyle(e).display))).every((d) => (width >= 1280 ? d === 'block' : d === 'none')));
  await expectThat(page, 'séance card: drawn beside the counts on wide screens, hidden on narrow ones', (await page.locator('[data-seance-art]').evaluate((e) => getComputedStyle(e).display)) === (width >= 768 ? 'block' : 'none'));
  const face = await page.evaluate(async () => {
    await document.fonts.ready;
    const fam = (sel: string) => getComputedStyle(document.querySelector(sel)!).fontFamily;
    return { title: fam('h1'), seance: fam('h3[data-typewriter]'), data: fam('table td, dl dd'), titleOk: document.fonts.check('400 24px "Skeleton Title"'), typeOk: document.fonts.check('400 16px "Skeleton Typewriter"') };
  });
  await expectThat(page, 'fonts: gothic title, typewriter séance heading, data stays in the sans-serif', /Skeleton Title/.test(face.title) && /Skeleton Typewriter/.test(face.seance) && !/Skeleton/.test(face.data) && face.titleOk && face.typeOk, JSON.stringify(face));
  await expectThat(page, 'séance heading and sentences are typewriter, the counts are not', await page.evaluate(() => [...document.querySelectorAll('[data-seance] [data-typewriter]')].every((e) => /Skeleton Typewriter/.test(getComputedStyle(e).fontFamily)) && !/Skeleton/.test(getComputedStyle(document.querySelector('dl[aria-label="Summary"] dd')!).fontFamily)));
  // Séance numbers are data: sans-serif with tabular figures, never the typewriter face (a 1 would read as an l)
  const figs = await page.evaluate(() => [...document.querySelectorAll('[data-seance] [data-figure]')].map((e) => { const c = getComputedStyle(e); return { t: e.textContent, f: c.fontFamily, n: c.fontVariantNumeric }; }));
  await expectThat(page, 'séance numbers: sans-serif data font with tabular figures', figs.length > 0 && figs.every((x) => !/Skeleton|Elite/.test(x.f) && /tabular/.test(x.n)), JSON.stringify(figs.filter((x) => /Skeleton|Elite/.test(x.f) || !/tabular/.test(x.n)).slice(0, 3)));
  // Accept is not the green of the Agrees / Validated status
  const green = await page.evaluate(() => {
    const a = document.querySelector('button[aria-label^="Accept"]');
    const ok = document.querySelector('[data-badge="validated"], [data-badge="agree"]');
    if (!a || !ok) return [];
    const bg = getComputedStyle(a).backgroundColor;
    return bg === getComputedStyle(ok).borderTopColor ? [`Accept background ${bg} equals the status green`] : [];
  });
  await check(page, 'Accept button: not the status green', green);
  // HU-32 warm decoration never within 24 px of a status badge
  const near = await page.evaluate(() => {
    const warm = [...document.querySelectorAll('[data-warm]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const out: string[] = [];
    for (const b of document.querySelectorAll('[data-badge]')) {
      const r = b.getBoundingClientRect();
      if (r.width === 0) continue;
      for (const w of warm) if (r.left < w.right + 24 && r.right > w.left - 24 && r.top < w.bottom + 24 && r.bottom > w.top - 24) out.push(`${b.textContent} is within 24px of warm art`);
    }
    return out;
  });
  await check(page, 'warm decoration is 24 px or more from every status badge', near);
  // HU-35 the corner pumpkin overlaps no text or control, and is a labelled button
  const pumpkin = await page.evaluate(() => {
    const b = document.querySelector('[data-trick-or-treat]') as HTMLElement | null;
    if (!b) return ['no corner pumpkin'];
    const r = b.getBoundingClientRect();
    const bad: string[] = [];
    if (b.getAttribute('aria-label') !== 'Trick or treat' || r.width < 44 || r.height < 44) bad.push('not a labelled 44 px button');
    const hit = (q: DOMRect) => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top;
    for (const e of document.querySelectorAll('header a, header button, header h1, header p, header nav, header [data-header-art]')) if (e !== b && !b.contains(e) && hit(e.getBoundingClientRect())) bad.push(`overlaps ${e.tagName.toLowerCase()} ${e.textContent?.slice(0, 20)}`);
    return bad;
  });
  await check(page, 'corner pumpkin: a labelled button that overlaps nothing in the header', pumpkin);
  // HU-34 the unlock: fade done inside 1.5 s of a set loading
  const unlockMs = await page.evaluate(() => {
    const el = document.querySelector('[data-unlock]')!;
    const a = el.getAnimations().find((x) => (x as CSSAnimation).animationName === 'unlock-fade');
    return a ? Number(a.effect!.getComputedTiming().endTime) : (null as number | null);
  });
  await expectThat(page, 'unlock: the results fade in within 1.5 s, once', unlockMs === null || unlockMs < 1500, String(unlockMs));
  // HU-35 treat, then trick
  await page.locator('[data-trick-or-treat]').click();
  await expectThat(page, 'treat: ghost particles fall, no runes', (await page.locator('[data-treat] svg').count()) === 14 && (await page.locator('[data-runes]').count()) === 0);
  await page.waitForTimeout(3200);
  await expectThat(page, 'treat: gone after 3 s', (await page.locator('[data-treat]').count()) === 0);
  const dataBefore = await page.locator('main').innerText();
  await page.locator('[data-trick-or-treat]').click();
  await page.waitForTimeout(400);
  const runeHosts = await page.evaluate(() => [...document.querySelectorAll('[data-runes-host]')].map((h) => h.closest('h1,h3')?.tagName));
  await expectThat(page, 'trick: runes only on the app title and the séance heading', runeHosts.sort().join() === 'H1,H3', runeHosts.join());
  await expectThat(page, 'trick: no overlap with text or controls', (await motifOverlaps(page, false)).length === 0);
  await page.waitForTimeout(3000);
  await expectThat(page, 'trick: runes gone after 3 s and data text unchanged', (await page.locator('[data-runes]').count()) === 0 && (await page.locator('main').innerText()) === dataBefore);
  // HU-36 the 404 page
  const nf = await page.context().newPage();
  const resp = await nf.goto(`${urlOf(app)}does-not-exist`);
  await expectThat(nf, '404: unknown path answers 404 with the themed page and a way back', resp?.status() === 404 && (await nf.locator('h1').textContent()) === 'Lost in the catacombs' && (await nf.locator('a[href="/"]').count()) === 1);
  await check(nf, '404: axe-core, no violations', await axeViolations(nf));
  await expectThat(nf, '404: no sideways scroll', await nf.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await nf.close();
  // HU-18 planchette
  await page.getByRole('button', { name: 'Next finding' }).click();
  await page.waitForSelector('[data-planchette][data-show]', { timeout: 5000 }); // placed once the page has stopped scrolling
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.tagName + ' ' + (document.activeElement?.id ?? ''));
  await expectThat(page, 'planchette: focus moved to a finding and a pointer is there', /^ARTICLE finding-/.test(focused) && (await page.locator('[data-planchette][data-show]').count()) === 1, focused);
  await check(page, 'planchette: the target is inside the viewport', await nextFindingInViewNow(page));
  await full(page, 'planchette');
  // HU-20 possessed hover and focus
  const cell = page.locator(app.name === 'scopecheck' ? 'td[data-possessed="spec"]' : 'tr[data-possessed="spec"]').first();
  await cell.scrollIntoViewIfNeeded();
  await cell.hover();
  await page.waitForTimeout(200);
  await expectThat(page, 'possessed: hovering the cell makes both evidence lines glow', (await page.locator('[data-evidence][data-glow] figure').count()) >= 2);
  await full(page, 'possessed hover');
  // HU-21 ghost drift (ScopeCheck needs coverage confirmed first; PackCheck shows its confirmed missing attachment from the start)
  await confirmCoverage(page, app);
  // HU-28 the margin ghost, measured WHILE it flies (three moments), not after it has gone: it must cover nothing. It needs a free gutter,
  // so it appears at 1280 px and not at 375 px.
  if (width >= 1280) {
    await page.waitForSelector('[data-margin-ghost]', { timeout: 3000 });
    for (const [i, at] of [300, 1200, 2200].entries()) {
      await page.waitForTimeout(i === 0 ? at : at - [300, 1200, 2200][i - 1]!);
      const live = await page.locator('[data-margin-ghost]').count();
      await check(page, `margin ghost in flight (${at} ms): present and covers no text or control`, live === 1 ? await motifOverlaps(page, false) : ['the ghost is not there']);
    }
    const box = await page.locator('[data-margin-ghost]').boundingBox();
    await expectThat(page, 'margin ghost stays inside the left gutter', !!box && box.x >= 0 && box.x + box.width <= 64 + 1, JSON.stringify(box));
  } else await expectThat(page, 'margin ghost: no free gutter at this width, so none is drawn', (await page.locator('[data-margin-ghost]').count()) === 0);
  const ghost = page.locator(app.name === 'scopecheck' ? 'td[data-ghost]' : 'tr[data-ghost] > td:last-child').first();
  await ghost.scrollIntoViewIfNeeded();
  await ghost.hover();
  await page.waitForTimeout(900);
  await full(page, 'ghost drift');
  // HU-23 ink drip (ScopeCheck: confirming coverage made SP-5302 a confirmed critical finding)
  if (app.name === 'scopecheck') await expectThat(page, 'ink drip: ran once when the critical finding became confirmed', (await page.locator('[data-ink]').count()) <= 1);
  // HU-22 seal and fade
  await page.getByRole('button', { name: 'Next finding' }).click();
  await page.locator('article:focus').getByRole('button', { name: /^Accept:/ }).click();
  await page.waitForTimeout(600);
  await expectThat(page, 'seal: Accept stamps a wax seal', (await page.locator('[data-seal]').count()) >= 1);
  await full(page, 'wax seal');
  // another card to dismiss: the next open one if there is one, else any other card (PackCheck may have only one open item)
  const more = page.getByRole('button', { name: 'Next finding' });
  if (await more.count()) {
    await more.click();
    await page.locator('article:focus').getByRole('button', { name: /^Dismiss:/ }).click();
  } else await page.locator('article').nth(1).getByRole('button', { name: /^Dismiss:/ }).click();
  await page.waitForTimeout(400);
  await expectThat(page, 'fade: Dismiss keeps the card, dashed, and it can be reopened', (await page.locator('article[data-dismissed]').count()) >= 1 && (await page.locator('article[data-dismissed]').first().getByRole('button', { name: /^Reopen:/ }).count()) === 1);
  await full(page, 'ghostly fade');
  // HU-24 mist
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(100 + i * 40, 200 + (i % 3) * 30);
    await page.waitForTimeout(55);
  }
  await expectThat(page, 'mist: a trail follows the pointer, at most ten puffs', (await page.locator('[data-motif="mist"] span').count()) > 0 && (await page.locator('[data-motif="mist"] span').count()) <= 10);
  await full(page, 'mist');
  // HU-26 boo
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type('boo');
  await page.waitForTimeout(700);
  await expectThat(page, 'boo: typing boo shows the ghosts', (await page.locator('[data-boo] svg').count()) >= 3);
  await full(page, 'boo ghosts');
  // HU-25 Lights flicker, then Lights on
  await page.getByRole('button', { name: 'Lights on' }).click();
  await page.waitForTimeout(150);
  const during = { overlay: await page.locator('[data-lights-flicker]').count(), mode: await page.getAttribute('html', 'data-lights') };
  await page.waitForTimeout(1300);
  const after = await page.getAttribute('html', 'data-lights');
  await expectThat(page, 'flicker: the lights flicker first, then Lights on applies', during.overlay === 1 && during.mode === 'off' && after === 'on', JSON.stringify({ during, after }));
  await page.close();

  // HU-19 idle whisper: a fresh page with a clock the script can move
  const quiet = await ctx.newPage();
  await quiet.clock.install();
  await quiet.goto(urlOf(app));
  await quiet.waitForSelector('main h2');
  await quiet.clock.fastForward(46_000);
  await quiet.waitForSelector('[data-whisper] button', { timeout: 5000 });
  const words = (await quiet.textContent('[data-whisper] button')) ?? '';
  await expectThat(quiet, 'whisper: after 45 s idle one line names the next item, in this app\'s words', app.name === 'scopecheck' ? /^A candle still burns: /.test(words) : /^The pack is not at rest: /.test(words), words);
  await full(quiet, 'whisper');
  await quiet.close();
  void tag;
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
          await check('Next finding scrolls the target into view and focuses it', await nextFindingInView(page));
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
          if (mode === 'off') await effectStates(ctx, app, tag, width, async (_p, what, problems) => check(what, problems));
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
      {
        const bad = await nextFindingInView(op);
        if (bad.length) failures.push(`${app.name}: reduced motion: Next finding: ${bad.join('; ')}`);
        else log(`PASS ${app.name}: reduced motion: Next finding scrolls the target into view and focuses it`);
      }
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
