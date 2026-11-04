# Haunted interface (shared, both apps)

**Introduced:** 2026-11-01, in PR #5 (`task-6-app-shells`); exact commit recorded in `.kiro/specs/README.md`. Not part of the foundation spec.
**Revision 2 (2026-11-02):** requirements extended from the Build Brief's "Haunted design layer" (`docs/reference/scopecheck-build-brief.md`), reconciled with the approved amendments in `.kiro/steering/brief.md`. HU-1 to HU-9 keep their IDs; HU-8 changes (default and automatic mode, below); HU-10 to HU-16 are new. **Status: approved by the owner on 2026-11-02 with the four decisions recorded under "Decisions"; `design.md` and `tasks.md` are revised to match.**

**Reads with:** foundation R13 (accessibility), R9 (honest sample labelling), R4.7 (extracted lines are not original lines), R7 (review states), R10 (accuracy and no false critical findings); amendments 3 to 7. The visual system and the Lights-on behaviour are in `design.md`.

**Status:** a committed task, not optional polish. The visual system is defined; implementation proceeds alongside the working upload flow and the theme is **complete before the final submission week** (deadline 5 December 2026, 00:00 SAST).

## Governing rule

The theme makes findings easier to notice. **It never changes what a finding says, how certain it is, or what is shown.** Every themed element is decoration or a second name next to the plain one; removing the theme (Lights on) loses nothing but atmosphere.

## Requirements

- **HU-1 Two modes, one product.** *Lights off* is the haunted presentation. *Lights on* is a plain, light presentation with no decorative effects. Every review state, evidence view, control and export is identical in function and wording in both. Theme names (HU-10) are the only extra words, and they appear only in Lights off.
- **HU-2 Readable evidence always.** Cited evidence, the highlighted span, its document name, line and source reference, and every status badge stay readable in both modes. No decoration overlaps text, evidence, controls or a status. Highlighting uses an outline as well as colour. No effect distorts, blurs, fades or moves text.
- **HU-3 Keyboard.** Everything operable by keyboard in both modes, with a visible focus ring that meets contrast in both. The mode toggle is a real button, first in the header after the skip link, with `aria-pressed` and a constant text label ("Lights on"); the icon changes with the state (decorative), the announcement says "Lights on" / "Lights off". Every effect triggered by hover is also triggered by keyboard focus, and nothing is reachable by pointer only.
- **HU-4 AA contrast, enforced.** Text at least 4.5:1 and control boundaries and focus rings at least 3:1, in both modes, for the tokens in `packages/ui/src/theme-tokens.ts`. A test enforces it for the tokens; automated accessibility checks cover the rendered apps in both modes. Translucent or tinted states (HU-11) are measured on the colour actually rendered, not on the token.
- **HU-5 Reduced motion and safe effects.** With `prefers-reduced-motion: reduce`, all effects are static. Otherwise no flashing above 3 per second, no effect longer than five seconds without a stop, no repeating animation on content, and no parallax. Nothing moves in Lights on.
- **HU-6 Not colour alone.** Status is text plus icon. Not evaluated, Needs review, confirmed, validated and user-supplied stay distinguishable in grayscale and without the theme names.
- **HU-7 Honest labelling survives the theme.** The sample banner, the "recorded model output" note, the live-mode banner, the "edited sample" note and the coverage state are never hidden, restyled into invisibility, or replaced by decoration.
- **HU-8 Preference and privacy.** The mode preference is stored as a single value (`on` or `off`) in the browser and never contains document content. **A stored choice always wins and is remembered**, including Lights on. With no stored choice: **Lights off by default, and Lights on automatically when the system asks for reduced motion (`prefers-reduced-motion: reduce`) or more contrast (`prefers-contrast: more`).** The automatic choice is not stored (only a choice made with the toggle is), so it follows the system if the setting changes. Print and export always use the Lights-on palette and the plain wording (no theme names).
- **HU-9 Cost containment.** Effects are CSS only, no images over 20 kB each, no third-party fonts or scripts. **No sound**: decided, not deferred (the brief's optional sound is not built, and no audio element, API or file exists in the app).
- **HU-10 Theme vocabulary is a second name, never a verdict.** Each finding code may carry a theme name from its adapter (table below). It is shown in Lights off only, after the plain message and never instead of it, and it never appears in exports or accessible names (screen readers get the plain wording once). The theme name follows the finding's state: a Needs-review finding is named as uncertain ("Possible ghost"), never as a fact. Not evaluated is never given a finding's theme name. A code without a theme name shows none. Theme names are adapter data, like labels; the shared UI holds no domain words.
- **HU-11 Ghost rows (absences).** A confirmed absence (ScopeCheck `item.absent` confirmed; PackCheck `attachment.missing` confirmed) is drawn as a ghost: translucent background and dashed boundary, text at full contrast. It may flicker ONCE when it appears (revision 3, 2026-11-03, at the owner's request: one run of 0.9 s with two short dips, under 3 flashes per second, never a loop), and is static under reduced motion and in Lights on. Activating it (click, Enter or Space) "solidifies" it (the ghost styling is removed for that item) and moves focus to its finding with the evidence. An absence that is only **Needs review** (coverage unverified, held candidate) is never a ghost: it keeps the Needs-review lantern styling and the theme name "Possible ghost". A Not-evaluated cell is never a ghost.
- **HU-12 Possessed cells (differences).** A specification or value difference (`spec.differs`, `quantity.differs`, `org.name_differs`, `date.differs`, `funding.differs`) gets a marked boundary on hover **and** focus, with no text distortion. Its evidence view shows both cited phrases together, each highlighted with its document name, so the two conflicting values are compared side by side.
- **HU-13 Séance summary.** The results header carries one sentence per response document in the theme's voice, for example "2 ghosts and 1 curse confirmed in Quotation QB-04; 1 possible ghost needs review." The plain counts are always beside it. It is built from the same counts as the summary bar and the export, never from separate logic. Confirmed and Needs review are counted separately; Not evaluated is stated ("4 comparisons did not run"); it never says "clean", "nothing found" or similar when anything is Needs review or Not evaluated, or when coverage is unverified. In Lights on it is the plain sentence without theme names.
- **HU-14 PackCheck inherits the layer with its own vocabulary.** All components, modes, effects and rules above are in `packages/ui`; PackCheck supplies only its theme names (table below) and reuses ghost rows for missing attachments and possessed styling for cross-document differences.
- **HU-16 Ectoplasm is brand, decoration and focus only.** The `ecto` token appears only on the brand mark, the mode toggle, decorative motifs and glow, and the keyboard focus ring. It is never used in a status badge, a finding card, a comparison cell, a count or a link, and never as the only difference between two states. Decoration in `ecto` never sits behind or over text, evidence or a control (HU-2), and is absent in Lights on except for the brand mark, the toggle and the focus ring. Measured contrast and the hue separation from the state colours are enforced by `theme-tokens.test.ts`.
- **HU-15 Copy and vocabulary are steered.** `.kiro/steering/theme.md` holds the tone of copy and the theme vocabulary (the tables below), so generated copy follows them. Tone: dry, brief, never jokey about the reviewer's work; theme words only in headings, badges and the séance sentence, never in explanations, reasons, evidence or exports.

## Theme names (proposed, adapter data)

| App | Finding code | Plain message (unchanged) | Theme name (confirmed) | Theme name (Needs review) | Built |
|---|---|---|---|---|---|
| ScopeCheck | `item.absent` | "{item} not found in {quotation}" | Ghost | Possible ghost | yes |
| ScopeCheck | `spec.differs` | "Specification text differs for ..." | Possessed | Possibly possessed | yes |
| ScopeCheck | `quantity.differs` | "Quantity differs for ..." | Wrong count | Possible wrong count | yes |
| ScopeCheck | `exclusion.stated` | "Exclusion stated in ..." | Curse | (always confirmed: it is stated) | yes |
| ScopeCheck | unit ambiguity | (rule not built) | Shapeshifter | Possible shapeshifter | no (foundation task 17) |
| ScopeCheck | delivery, payment, warranty, price arithmetic, unrequested extra, validity | (rules not built) | Late arrival, Blood price, Short life, Phantom maths, Stowaway, Fading | "Possible ..." | no (foundation task 17) |
| PackCheck | `attachment.missing` | "Required attachment not listed in ..." | **Lost page** (a missing attachment) | Possibly lost page | yes |
| PackCheck | `org.name_differs` | "Organisation name differs between ..." | **Doppelgänger** (the organisation name differs) | Possible doppelgänger | yes |
| PackCheck | `funding.differs`, `date.differs`, and any other cross-document value that differs | "... differs between ..." | **Changeling** (another value differs) | Possible changeling | yes |
| PackCheck | `funding.exceeds_budget` | "Funding requested exceeds the total project budget" | **Bottomless purse** (funding exceeds the budget) | (always confirmed when raised) | yes |
| both | Not evaluated (a comparison, not a finding) | "Not evaluated" | Unseen (design.md) | | yes |
| both | Needs review (state) | "Needs review" | lantern icon only, no name | | yes |
| both | identity uncertain, unverified, multiple items, contaminated, value held | (their plain messages) | none | none | yes |

Theme names for rules that are not built are reserved, not shown.

## Reconciliation with the brief's "Haunted design layer"

| Brief | Here |
|---|---|
| Dark, inky "after-hours procurement office" palette; one ectoplasm-green accent for findings | Lights-off palette in `design.md` (dark). **Differs, by decision:** the ectoplasm accent is for brand, decoration and focus only (HU-16); findings use state colours (danger for confirmed, amber for Needs review) so certainty stays readable (amendment 4, HU-6); green stays "validated / agrees". |
| Clean sans-serif for data; restrained serif for headings | As `design.md` (system fonts, no web fonts: HU-9) |
| Ghost rows flicker once, then settle; clicking solidifies and opens the evidence | HU-11, for **confirmed** absences only; one fade of at most 1 s instead of a flicker; static under reduced motion |
| Possessed cells: distortion on hover; evidence highlights both conflicting phrases | HU-12: a marked boundary on hover and focus, **no text distortion** (HU-2); both phrases side by side |
| Séance summary, e.g. "3 ghosts and 2 curses found in Supplier B's quote", with plain counts | HU-13, with confirmed and Needs review counted separately and Not evaluated stated |
| Sound optional, off by default | **Not built, by decision** (HU-9) |
| Lights on removes animation and atmosphere; respects reduced motion automatically | HU-1, HU-5, HU-8 (Lights on is selected automatically under reduced motion unless the user chose otherwise) |
| Theme in the shared UI layer; PackCheck inherits it with its own vocabulary | HU-14 |
| Finding theme names (Ghost, Possessed, Wrong count, Shapeshifter, Curse, ...) | HU-10 table; names only for rules that exist |
| `theme.md` steering: tone of copy and haunted vocabulary | HU-15 |
| "Every screen must work by keyboard, meet WCAG AA contrast" | HU-3, HU-4 |

## Decisions (approved by the owner, 2026-11-02)

1. **Sound: none.** HU-9.
2. **Ectoplasm green** (`ecto`): brand, decoration and the keyboard focus ring only. Findings, comparisons and every status keep their state colours. HU-16. Contrast measured: Lights off `#38e8c6` is 12.15:1 on the page and 11.08:1 on cards; Lights on `#00695c` is 6.61:1 and 6.07:1. Both pass as text (4.5:1) and as a focus ring (3:1). Both differ from the validated green by at least 25 degrees of hue (35 and 39); enforced in `theme-tokens.test.ts`.
3. **PackCheck names approved**, with the explicit mapping in the table above.
4. **Default mode:** Lights off by default; a remembered choice wins; Lights on automatically under `prefers-reduced-motion` (and `prefers-contrast: more`, kept from the earlier HU-8). HU-8.

## Protected scope

If time runs short, ship Lights on (fully accessible) plus the Lights-off palette and typography, then the séance summary and theme names. Cut effects first (ghost fade, possessed boundary animation), then motifs and illustrations. **Never cut HU-2 to HU-7, HU-10's "second name, never a verdict" rule, HU-13's counting rules, or HU-16.**

## Revision 3: the signature pass (2026-11-03, approved by the owner)

Ten effects, built for both apps. PackCheck uses its own wording for the lines that have words. They sit on top of HU-1 to HU-16 and change none of them.

**Rules for all of them (HU-27).** Decoration never covers data: it is drawn behind text and controls, in margins and gaps, or on a border, and a test measures overlap in the browser. Nothing appears at a random time or in a random place: every effect has a defined trigger and a defined position. Every effect is off in Lights on and under `prefers-reduced-motion` (together: "effects off"), and the page then shows exactly the same information and offers exactly the same controls; where an effect has a function (the planchette's jump, the whisper's link), the function stays and only the decoration goes. The existing axe, contrast, focus-ring and no-sideways-scroll checks stay green in both modes at 1280 px and 375 px. No sound. No red decoration. No jump scares: nothing is sudden, large or loud, and no effect flashes more than twice a second.

- **HU-17 Candles.** The header holds one candle per unresolved item, where unresolved means Needs review; the number of lit candles equals the Needs review count in the summary at every moment. When an item stops needing review (a correction, a coverage confirmation) its candle is snuffed out once, with a smoke wisp, and goes. Flames are still.
- **HU-18 Planchette.** A "Next finding" button (a real button, in both modes) goes to the next unresolved item that is still open (not accepted or dismissed), in page order, and moves focus to it. With effects on, a planchette pointer also glides to the top edge of that item, then fades; with effects off focus simply moves.
- **HU-19 Idle whisper.** After 45 seconds with no input, at most once per page session, one `aria-live="polite"` line names the next unresolved item and is a button that jumps to it. Never while a dialog or the correction editor is open, or while a field has focus; if blocked it waits for the next 45 seconds of quiet. Effects on only.
- **HU-20 Possessed hover and focus.** A spec-mismatch cell glitches its border once when hovered or focused, and both evidence lines of its finding glow, in the finding card, for as long as it is hovered or focused. Text never moves, blurs or distorts.
- **HU-21 Ghost drift.** A translucent figure drifts once through a confirmed-missing-item cell when it is hovered or focused, behind its text.
- **HU-22 Seal and fade.** Accept stamps a wax seal beside the decision buttons (once, then it stays while the item is accepted); Dismiss fades a ghost out of the card once. A dismissed item stays in the queue and Reopen restores it. The wax is violet, not red.
- **HU-23 Ink drip.** Once for each critical finding that becomes confirmed during the session (not for those already confirmed when a set opens), a single drop of dark ink or ectoplasm runs down the right margin and stops. Never red.
- **HU-24 Fog and mist.** Fog sits behind the header text. A faint mist trail follows the pointer, behind the page content, a few puffs at a time, only while the pointer moves.
- **HU-25 Lights flicker.** Switching to Lights on first flickers the page twice (0.8 s, two flashes: under 3 a second), then applies. Under reduced motion it applies at once.
- **HU-26 Easter egg.** Typing "boo" while no text field, editor or dialog has focus shows ghosts behind the page for about 2.5 seconds. At most once every 5 seconds; nothing else triggers it.

Words (PackCheck differs from ScopeCheck only in the whisper): ScopeCheck, "A candle still burns: {item}. Go there."; PackCheck, "The pack is not at rest: {item}. Go there." The candle count, the button label and every other control are the same.

## Revision 4: the bolder pass (2026-11-03, approved by the owner)

Effects that move, not brighter ones, and only in space that holds no text and no control (HU-27 still applies in full).

- **HU-28 Margin ghost.** When a missing item BECOMES confirmed during the session (not for those already confirmed when a set opens), a full-strength ghost travels once up the left page gutter, below the banner and the header, swaying a little. It is drawn only if the gutter is at least 60 px wide (that is, at about 1280 px and wider); narrower, nothing is drawn.
- **HU-29 Gutter fog.** At 1280 px and wider the page gutters (beside the content column, below the header) hold thicker fog that drifts in once (4.5 s) and rests. There is no gutter fog narrower than that.
- **HU-30 Séance card.** An illustration with no text (three candles, a planchette, wisps and orbs of ectoplasm on a round table) sits beside the counts from 768 px wide. It settles in once.
- **HU-31 Display face.** The app title and the séance heading use a serif display face, self-hosted (SIL OFL 1.1, an 8.7 kB subset kept with its licence in `packages/ui/src/fonts`), only when the effects are on. No font is ever loaded from another host.
- **HU-18 amended: Next finding scrolls.** The target is scrolled into view FIRST, then focused. A smooth scroll is used only for a short hop with effects on; a long jump, reduced motion and Lights on scroll instantly; the outcome is checked and repeated instantly if the page did not move. A browser test requires the target to be inside the viewport afterwards, including when smooth scrolls are dropped.

## Revision 5: candlelight (2026-11-03, approved by the owner)

Warm jack-o'-lantern candlelight on near-black, beside the ectoplasm teal. Original art only (HU-40). Everything here is under HU-27: decoration never over text or controls, nothing at random, all off under Lights on and reduced motion, axe and contrast green.

- **HU-32 Palette.** The Lights-off page background is near-black. Amber and orange candlelight is allowed ONLY as decoration in the header, the page gutters and the illustrations (pumpkins, lantern, candles). It is never used inside, or next to, a status badge: Needs review is amber, and amber decoration near it would blur a state with an ornament. The effects that touch findings (planchette, glitch, evidence glow) therefore use the text colour and blue, not amber. A test lists the only selectors allowed to use the warm colours; the browser check measures that no warm decoration is within 24 px of a status badge.
- **HU-33 Art.** Original SVG drawn in code: carved pumpkins, a lantern and candles, in the header (from 768 px) and beside the séance card.
- **HU-34 Skeleton key.** When a sample set loads (including the first load) or a live run finishes, a spectral key turns in a lock in the header, then the results fade in. Once per load, under 1.5 s in all (0.8 s turn, results fade from 0.75 s to 1.25 s). The results are only faded, never moved or changed.
- **HU-35 Trick or treat.** A small pumpkin in the header's top-right corner (a real button, "Trick or treat"; free space at every width). Clicks alternate: treat = ghost particles fall for 3 s, behind the page; trick = runes scramble ONLY the app title and the séance heading for 3 s. The runes are drawn (original strokes), the real text stays in place for assistive technology, and no data text is ever touched. Nothing is random: the order alternates and the scramble steps are computed.
- **HU-36 Fonts, self-hosted.** A gothic display face for the app title only (Pirata One, SIL OFL 1.1, as distributed because the licence reserves the name); Special Elite for the séance card and the ritual stage labels (Apache-2.0: not OFL; licence and notice kept; subset to 28 kB). Data stays in the current sans-serif. Supersedes HU-31's serif.
- **HU-37 Ritual stage labels.** In Lights off each stage has a themed name with the plain stage beneath it ("Summoning spirits" over "2. Extracting"). ScopeCheck and PackCheck have their own names. The plain stage is what assistive technology reads.
- **HU-38 Themed 404.** A static page, "Lost in the catacombs", with a link back to the app; no script, no request to another host; static under reduced motion.
- **HU-39 Title glow.** A slow ectoplasm glow builds around the app title only (4.5 s) and then stays steady: HU-5 forbids a loop on content, so it does not pulse.
- **HU-40 Originality, no sound.** No stock photo and no third-party image in the repository: the art is code (`docs/art.md` lists each piece), and a test finds no raster image under `apps` or `packages`. No sound in the app.
