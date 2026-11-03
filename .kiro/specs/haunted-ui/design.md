# Haunted interface: design

Introduced 2026-11-01; **revision 2 (2026-11-02)** follows requirements revision 2 (HU-1 to HU-16, approved with four decisions). Numbers in the palette table are enforced by `packages/ui/src/theme-tokens.test.ts`. This design adds no new dependency and no paid service.

## 1. Principles

1. **The theme is a skin and a second name, never a source of facts.** Everything the theme adds is derived from data the plain interface already shows (finding code, state, counts). Removing the theme loses atmosphere only (HU-1, "Governing rule").
2. **Domain words live in adapters, presentation lives in `packages/ui`.** `packages/ui` knows modes, tokens, motifs and components; each adapter supplies theme names (HU-14). The engine knows neither.
3. **Lights on is the reference.** It is built and checked first, it is what print and export use, and it is what the page shows with no stored choice under reduced motion.
4. **One source for colour.** `theme-tokens.ts` is the only place a colour is written; CSS variables are generated from it, and a test fails if they drift.

## 2. Palettes (contrast measured, WCAG 2.x)

| Token | Lights off | Lights on | Use |
|---|---|---|---|
| bg | `#0f1117` | `#ffffff` | page |
| surface | `#181b24` | `#f5f5f7` | cards, panels |
| text | `#e8e6e3` (15.2:1) | `#14171f` (17.9:1) | body |
| muted | `#b8b4ad` (9.1:1) | `#3d4352` (9.9:1) | secondary text |
| accent | `#ffb454` (10.7:1) | `#8a4b00` (6.8:1) | Needs review, emphasis |
| danger | `#ff9b94` (9.3:1) | `#a30000` (8.2:1) | confirmed difference |
| ok | `#7bd88f` (10.8:1) | `#0b5d1e` (8.1:1) | validated, agrees |
| info / link | `#8ab4ff` / `#9cc2ff` (9.0 to 10.4:1) | `#0b3d91` (10.0:1) | links, info |
| border | `#7c8396` (5.0:1, non-text) | `#5b6275` (6.1:1) | control and card boundaries |
| **ecto** (brand) | `#38e8c6` (12.15:1 on bg, 11.08:1 on surface) | `#00695c` (6.61:1 on bg, 6.07:1 on surface) | brand mark, mode toggle, decoration, focus ring |
| focus ring | = ecto | = ecto | keyboard focus (was `#ffd166` / `#1d4ed8`) |
| mark | `#ffe08a` on `#1a1300` (14.3:1) | `#fff1a8` on `#1a1300` (16.2:1) | cited evidence, plus a 1 px outline |

Ratios are against `bg`; every text pair is also at least 4.5:1 on `surface`. **Ecto rules (HU-16):** it passes as text and as a ring in both modes; its hue is 35 degrees (Lights off) and 39 degrees (Lights on) away from the validated green, and further from every other state colour (test). It is not used for any state, so the two greens are never compared by colour. The focus ring sits on a 2 px offset in the page colour so it stays 3:1 against whatever it surrounds (a filled button, a card).

Tinted or translucent states (the ghost row, HU-11; the possessed boundary, HU-12) are measured on the **rendered** colour: the test composites the translucent fill over `bg` and over `surface` and checks the text on it at 4.5:1 (see section 7).

## 3. Mode resolution and persistence (HU-8)

`resolveMode(stored, system)` is a pure function:

```
stored = 'on' | 'off'  -> that (a choice made with the toggle always wins and is remembered)
else system.reducedMotion || system.moreContrast -> 'on'
else -> 'off'
```

- `system` comes from `matchMedia('(prefers-reduced-motion: reduce)')` and `matchMedia('(prefers-contrast: more)')`, read once on load and on `change`; the automatic result is **not stored**, so it follows the system if the setting changes.
- Storage: `localStorage['skeleton-key-lights']` holds `'on'` or `'off'` and nothing else. Storage that throws (private mode) falls back to the automatic mode for the session. Nothing from a document is ever stored.
- `ThemeProvider` (in `packages/ui`) holds the resolved mode, sets `<html data-lights="on|off">`, writes the CSS variables once (below), and exposes `useLights()` returning `{ mode, toggle }`. It does not move focus.
- Print: `@media print` forces the Lights-on variables and hides motifs, theme names and the toggle (HU-8). Exports are generated from the export model with no theme names (HU-10), so print and export agree.

## 4. CSS variables from the tokens

`themeCss()` in `theme-tokens.ts` renders `:root[data-lights="off"] { --sk-bg: ...; }` and the `on` block from `PALETTES`, and each app's stylesheet imports it once (a generated `theme.css` committed with a test that regenerates it and compares bytes, so the file cannot drift from the tokens). Tailwind v4 `@theme` maps semantic utilities (`bg-sk-surface`, `text-sk-text`, `border-sk-border`, `text-sk-accent`) onto the variables.

**Migration (mechanical, Lights on first).** Components today use fixed Tailwind palette classes (`bg-white`, `text-slate-900`, `border-slate-400`, `bg-amber-100` ...). They are replaced by the semantic utilities in one pass per file, with a lint-style test that fails on a raw palette class in `packages/ui/src` and `apps/*/src` (an allowlist for the two banners' colours, which keep their own amber and blue because they are labelling, not theme: HU-7, and are given dark-mode variants measured in the token test).

## 5. Components and where each requirement lands

| Requirement | Component / mechanism | Notes |
|---|---|---|
| HU-3 toggle | `LightsToggle` in `AppShell`, first element in `<header>` after the skip link | A real `<button type="button">`; constant text label and accessible name "Lights on" (revision 3, 2026-11-03: a toggle button keeps one name), `aria-pressed` true while Lights on is active, and a decorative `aria-hidden` icon (lit bulb with rays while on, unlit crossed bulb while off) for the visual state; announces "Lights on" / "Lights off" in the existing polite live region; never moves focus. Brand-coloured (`ecto`). 44 px tall in Lights on. |
| HU-2, HU-5, HU-9 motifs | `Motifs` (inline SVG and CSS only; skeleton-key glyph in the header, cobweb corners on empty states, a slow fog gradient in the page margins) | Rendered **only when the mode is off** (so Lights on has no decorative DOM at all), `aria-hidden`, `pointer-events: none`, never behind a text block (positioned in the margins and corners; a test asserts no motif element overlaps a text, evidence or control rectangle in the Playwright run, section 8). Fog drift is a CSS animation disabled by `prefers-reduced-motion: reduce`. No image over 20 kB, no web fonts, no scripts, no audio element anywhere. |
| HU-6 state language | `StatusBadge` (exists) gets state icons: lantern (Needs review), ghost glyph with dashed outline (Not evaluated, "unseen"), bolt (confirmed), check (validated), pencil (user-supplied) | Text always present; icons `aria-hidden`; each state distinct in grayscale (a test renders the badges, desaturates their colours, and checks the text and icon shape differ). |
| HU-10 theme names | `adapter.labels.theme: Record<code, { confirmed: string; review?: string }>` and a `ThemeName` component | Rendered after the plain message, in Lights off only, `aria-hidden` (screen readers hear the plain wording once), absent from exports, from `aria-label`s and from the document title. `review` is used when the finding is Needs review ("Possible ghost"); a code with no entry shows nothing; Not-evaluated comparisons never get a finding's name. |
| HU-11 ghost rows | `data-ghost` on a confirmed absence row/cell (ScopeCheck `item.absent`, PackCheck `attachment.missing`) | Translucent fill, dashed boundary, text at full contrast. One fade-in (`animation: ghost-in 0.9s 1`), none under reduced motion or in Lights on. A native `<button>` "Show the evidence" (Enter/Space/click) removes `data-ghost` for that item (UI state, not persisted) and moves focus to its finding card (`#finding-...`). A Needs-review absence has no `data-ghost`. |
| HU-12 possessed cells | `data-possessed` on cells for `*.differs` findings | Boundary change on `:hover` and `:focus-within` (never on text), the same in both modes (4 px solid danger boundary). `FindingCard` shows a **side-by-side evidence pair** (two `EvidenceView`s in a grid, stacked below `sm`, each headed by its document name) when the finding's evidence comes from two documents. |
| HU-13 séance | `seanceSentences(view, mode)`, a pure function in `session-core.ts` | See section 6. Shown above the summary bar, always with the plain counts beside it. |
| HU-14 PackCheck | PackCheck's `labels.theme` plus its existing views | No PackCheck-specific code in `packages/ui`. |
| HU-15 steering | `.kiro/steering/theme.md` | Written with this design. |
| HU-16 ecto | The token, the brand mark, the toggle, motif edges, `:focus-visible` | A test scans the generated CSS and the rendered DOM: `ecto` appears only in the allowed rules and elements. |
| HU-7 labelling | `SampleBanner` / `LiveBanner` | Never themed away. On narrow screens the banner is one line, "SAMPLE MODE: fictional documents" (or "LIVE: your documents"), with the rest behind a `<details>` toggle that is always visible, so the label is never hidden, only the explanatory text is folded. |

## 6. Séance summary (HU-13)

Input: the review items and the comparison ledger already in `SessionView` (the same data as the summary bar and the export). For each **response document** (a quotation; the application form and supporting documents for PackCheck) it counts:

- `confirmed` findings by theme category (ghost = `item.absent`/`attachment.missing`, possessed, wrong count, curse, ...), taken from the finding code via the adapter's theme map;
- `review` = findings that are Needs review (counted together, whatever their code), and
- `didNotRun` = Not-evaluated comparisons for that document.

Sentence (Lights off), one per document, then one for the whole review:

> "2 ghosts and 1 curse confirmed in Quotation QB-04. 1 possible ghost needs review. 4 comparisons did not run."

Lights on: the same sentence with plain nouns ("2 missing items and 1 stated exclusion confirmed ..."). Rules, each with a test:

1. Counts come from the same arrays as the summary bar and the export (a property test builds random views and checks the sums agree).
2. Confirmed and Needs review are never merged; a Needs-review finding is never named as a confirmed one.
3. If anything is Needs review, anything did not run, or any document's coverage is unverified or incomplete, the summary says so in its last sentence ("Coverage is not confirmed for {n} document(s): nothing missing is certain until you confirm it.").
4. With zero confirmed findings the sentence is "Nothing confirmed so far." and the words "clean", "all clear", "no problems" and "nothing found" never appear (test over every state).
5. Singular and plural are handled by a small `plural(n, one, many)`; a name with no plural entry falls back to the plain noun.

## 7. Contrast of derived colours

`theme-tokens.test.ts` is extended with a `composite(fg, alpha, over)` helper. For the ghost fill (alpha 0.35 danger over `bg` and over `surface`), the possessed boundary, and the banners in both modes, it checks text on the rendered colour at 4.5:1 and boundaries at 3:1. The ecto glow is decoration and sits only where no text is (margins, corners); it is not part of any text pair.

## 8. Accessibility and visual checks (HU-T4)

- **Playwright script** `tools/a11y/check.ts` (Playwright as a dev dependency; browsers installed in CI by `npx playwright install --with-deps chromium`, which downloads from the official CDN and is the one new CI cost): for each app and each mode (set through `localStorage` and by emulating `prefers-reduced-motion`), at 1280 px and 375 px: runs **axe-core** (injected from the npm package, no third-party host), asserts no violations, asserts `document.documentElement.scrollWidth <= clientWidth`, tabs through the page to check a visible focus ring on every control, checks that no `[data-motif]` rectangle overlaps text, evidence or controls, and writes screenshots to `docs/screenshots/haunted/`.
- **Reduced motion:** emulated; asserts every `animation-name` on page content computes to `none` and that Lights on resolves automatically.
- **jsdom tests** (fast, in `npm test`): mode resolution, storage (including a throwing `localStorage`), toggle semantics (label, `aria-pressed`, live announcement, focus unmoved), theme-name rules (second name, Lights off only, `aria-hidden`, absent from exports), séance rules, ghost/solidify behaviour, grayscale distinctness, ecto usage.
- CI gains one job for the Playwright script; the accessibility hook in `docs/hooks.md` is enabled only after the script exists, and "actually run" is updated only with evidence.

## 9. Order of work

1. Tokens including ecto, with the contrast test (done in this revision).
2. `theme.md` steering (done with this design).
3. `ThemeProvider`, `resolveMode`, `LightsToggle`, generated CSS (HU-T1).
4. Migrate components to the semantic utilities, Lights on first, then Lights off; state icons (HU-T2).
5. Theme names, séance, ghost rows, possessed cells (HU-T3).
6. Motifs and effects behind the reduced-motion guard (HU-T4).
7. Accessibility script, screenshots in both modes, hook (HU-T5).
8. Review and build-log entry (HU-T6).

## 10. Not in scope

Sound (decided: none). Third-party fonts, images over 20 kB, scripts or analytics. Any change to a finding's wording, state, severity or evidence. Theme names for rules that do not exist yet (reserved in the requirements table until foundation task 17 builds them).

## 11. Revision 3: the signature pass (HU-17 to HU-27)

**One switch.** `ThemeProvider` computes `effects = mode is off AND the system does not ask for reduced motion` (it follows both), and sets `<html data-effects="on|off">`. Every animated effect is CSS under `:root[data-effects='on']` or a component that renders nothing when `effects` is false. Without `matchMedia` (tests, old browsers) effects are off. Static theme work from HU-T2 to HU-T6 (palette, theme names, ghost styling, fog strips) is unchanged.

**Behind, not over.** The page background moves from the app frame to `<body>` (the `surface` colour); the frame is transparent. Decoration that must sit on the page (header fog, mist, the "boo" ghosts) is `position: fixed or absolute; z-index: -1; pointer-events: none; aria-hidden`, so it is painted behind every piece of text and every card. Candles, the seal and the planchette sit in gaps or on borders (the planchette on the top border of the target card, where there is padding and no text). A browser check measures overlap with visible text and controls for each effect.

**`HauntProvider`** (`packages/ui/src/Haunt.tsx`, inside `AppShell`): holds the unresolved list from the session view (Needs review items; "open" ones for the planchette and the whisper), the glow link between a cell and its evidence, the planchette position, the whisper state, the ink-drip trigger and the "boo" buffer. `labels.voice` (adapter data) supplies the whisper wording.

| Requirement | Mechanism |
|---|---|
| HU-17 | `Candles`: ordered ids of unresolved items; a removed id is kept for 1.5 s as an unlit candle with a smoke wisp, `aria-hidden`; lit candles equal the Needs review count |
| HU-18 | `NextFinding` button (both modes) calls `goNext()`: focus first (`preventScroll`), then `scrollIntoView`; the pointer is a `position:absolute` element moved by a CSS transition (700 ms), then faded |
| HU-19 | an idle timer (45 s, reset by pointer, key, touch, wheel, scroll); the condition check at fire time; a `<p aria-live="polite">` that exists empty from the start |
| HU-20 | `data-possessed="spec"` on the cell; CSS glitch (outline and box-shadow only, one run of 0.6 s); a context link sets `data-glow` on the finding's evidence figures while the cell is hovered or focused |
| HU-21 | `[data-ghost]` cells: a `::before` figure (inline SVG data URI, under 1 kB) animated once on hover or focus-within, cell content raised above it |
| HU-22 | `WaxSeal` in the decision group while accepted; `data-dismissed` on the card with a one-time fading ghost |
| HU-23 | `InkDrip`: compares the confirmed critical ids with the set seen so far in this set (first render only records them) |
| HU-24 | header fog: layered radial gradients at 14 percent ecto; mist: up to 10 pooled `span`s created by `pointermove` and removed on `animationend` |
| HU-25 | `ThemeProvider.toggle()` shows a dark overlay animated twice (opacity), then applies the mode; nothing if effects are off |
| HU-26 | `keydown` buffer of the last three letters, ignored in fields, editors and dialogs, cool-down 5 s |

**Measured, not assumed.** The composited colour of the fog and of the glow is checked against text at 4.5:1; the browser script (`tools/a11y/check.ts`) runs axe, the focus walk, overlap and the sideways-scroll check with the effects switched on and in each triggered state, at 1280 px and 375 px; `tools/a11y/effects-shots.ts` freezes each effect at its most visible moment and saves a screenshot.
