# Haunted interface: visual system and Lights-on behaviour

Introduced 2026-11-01 (see `requirements.md`). **Pending revision** for requirements revision 2 (HU-10 to HU-15: theme names, ghost rows, possessed cells, séance summary, PackCheck vocabulary, `theme.md`); unchanged until those requirements are accepted. The numbers below are enforced by `packages/ui/src/theme-tokens.test.ts`.

## Palettes (contrast measured, WCAG 2.x)

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
| focus ring | `#ffd166` (13.1:1, non-text) | `#1d4ed8` (6.7:1) | keyboard focus |
| mark | `#ffe08a` on `#1a1300` text (14.3:1) | `#fff1a8` on `#1a1300` (16.2:1) | cited evidence, plus a 1 px outline |

Ratios are against `bg`; every text pair is also at least 4.5:1 on `surface`.

## Motifs (Lights off only; all decorative, `aria-hidden`, `pointer-events: none`)

- A skeleton-key glyph in the header; cobweb corners on empty states; a slow fog gradient in the page margins (never behind text blocks).
- State language: **Needs review** uses the amber accent and a lantern icon; **Not evaluated** keeps the dashed outline and a ghost glyph ("unseen": it did not run); **confirmed** uses danger with a bolt icon; **validated** uses the green with a check. Icons accompany text, never replace it.
- Typography: system serif for headings, system sans for body and evidence, monospace for source text. Body 16 px minimum, line height 1.5. No web fonts.

## Lights on

- Light palette, no motifs, no animation, no gradients, larger spacing (line height 1.6, controls 44 px tall). It is the reference presentation for accessibility and for print and export.
- Toggle: first control after the skip link; label "Lights on" when currently off and "Lights off" when currently on; `aria-pressed` reflects the current state of the toggle; changing it announces "Lights on" or "Lights off" in the polite live region and never moves focus.
- Defaults: Lights off, unless `prefers-contrast: more`, which selects Lights on. The choice persists as one value in `localStorage` (`on`/`off`), nothing else.
- Effects and `prefers-reduced-motion: reduce`: motifs render static (no fog drift); Lights on is always static.

## Implementation order

1. Tokens and the contrast test (done in PR #5).
2. A theme provider in `packages/ui` setting CSS variables from the tokens, and the toggle (HU-T1).
3. Apply the tokens to the shared components and both apps; Lights on first (it is the plain reference), then Lights off (HU-T2).
4. Motifs and effects, last, behind the reduced-motion guard (HU-T3).
5. Accessibility checks in both modes with the Task 11 tooling, plus screenshots of both modes (HU-T4).
