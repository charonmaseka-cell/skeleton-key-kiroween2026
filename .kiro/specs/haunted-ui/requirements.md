# Haunted interface (shared, both apps)

**Introduced:** 2026-11-01, in PR #5 (`task-6-app-shells`); exact commit recorded in `.kiro/specs/README.md`. Not part of the foundation spec.
**Revision 2 (2026-11-02):** requirements extended from the Build Brief's "Haunted design layer" (`docs/reference/scopecheck-build-brief.md`), reconciled with the approved amendments in `.kiro/steering/brief.md`. HU-1 to HU-9 keep their IDs and meaning; HU-10 to HU-15 are new. **Status: requirements for review.** `design.md` and `tasks.md` are revised only after these are accepted (workflow: requirements, then design, then tasks).

**Reads with:** foundation R13 (accessibility), R9 (honest sample labelling), R4.7 (extracted lines are not original lines), R7 (review states), R10 (accuracy and no false critical findings); amendments 3 to 7. The visual system and the Lights-on behaviour are in `design.md`.

**Status:** a committed task, not optional polish. The visual system is defined; implementation proceeds alongside the working upload flow and the theme is **complete before the final submission week** (deadline 5 December 2026, 00:00 SAST).

## Governing rule

The theme makes findings easier to notice. **It never changes what a finding says, how certain it is, or what is shown.** Every themed element is decoration or a second name next to the plain one; removing the theme (Lights on) loses nothing but atmosphere.

## Requirements

- **HU-1 Two modes, one product.** *Lights off* is the haunted presentation. *Lights on* is a plain, light presentation with no decorative effects. Every review state, evidence view, control and export is identical in function and wording in both. Theme names (HU-10) are the only extra words, and they appear only in Lights off.
- **HU-2 Readable evidence always.** Cited evidence, the highlighted span, its document name, line and source reference, and every status badge stay readable in both modes. No decoration overlaps text, evidence, controls or a status. Highlighting uses an outline as well as colour. No effect distorts, blurs, fades or moves text.
- **HU-3 Keyboard.** Everything operable by keyboard in both modes, with a visible focus ring that meets contrast in both. The mode toggle is a real button, first in the header after the skip link, with `aria-pressed` and a text label ("Lights on" / "Lights off"). Every effect triggered by hover is also triggered by keyboard focus, and nothing is reachable by pointer only.
- **HU-4 AA contrast, enforced.** Text at least 4.5:1 and control boundaries and focus rings at least 3:1, in both modes, for the tokens in `packages/ui/src/theme-tokens.ts`. A test enforces it for the tokens; automated accessibility checks cover the rendered apps in both modes. Translucent or tinted states (HU-11) are measured on the colour actually rendered, not on the token.
- **HU-5 Reduced motion and safe effects.** With `prefers-reduced-motion: reduce`, all effects are static. Otherwise no flashing above 3 per second, no effect longer than five seconds without a stop, no repeating animation on content, and no parallax. Nothing moves in Lights on.
- **HU-6 Not colour alone.** Status is text plus icon. Not evaluated, Needs review, confirmed, validated and user-supplied stay distinguishable in grayscale and without the theme names.
- **HU-7 Honest labelling survives the theme.** The sample banner, the "recorded model output" note, the live-mode banner, the "edited sample" note and the coverage state are never hidden, restyled into invisibility, or replaced by decoration.
- **HU-8 Preference and privacy.** The mode preference is stored as a single value (`on` or `off`) in the browser and never contains document content. The default is Lights off, except Lights on when the system requests more contrast. Print and export always use the Lights-on palette and the plain wording (no theme names).
- **HU-9 Cost containment.** Effects are CSS only, no images over 20 kB each, no third-party fonts or scripts. **No sound.** (The brief allows optional sound, off by default; it is not built. See "Open decisions".)
- **HU-10 Theme vocabulary is a second name, never a verdict.** Each finding code may carry a theme name from its adapter (table below). It is shown in Lights off only, after the plain message and never instead of it, and it never appears in exports or accessible names (screen readers get the plain wording once). The theme name follows the finding's state: a Needs-review finding is named as uncertain ("Possible ghost"), never as a fact. Not evaluated is never given a finding's theme name. A code without a theme name shows none. Theme names are adapter data, like labels; the shared UI holds no domain words.
- **HU-11 Ghost rows (absences).** A confirmed absence (ScopeCheck `item.absent` confirmed; PackCheck `attachment.missing` confirmed) is drawn as a ghost: translucent background and dashed boundary, text at full contrast. It may appear once with a single fade lasting at most 1 s (no flicker loop), and is static under reduced motion and in Lights on. Activating it (click, Enter or Space) "solidifies" it (the ghost styling is removed for that item) and moves focus to its finding with the evidence. An absence that is only **Needs review** (coverage unverified, held candidate) is never a ghost: it keeps the Needs-review lantern styling and the theme name "Possible ghost". A Not-evaluated cell is never a ghost.
- **HU-12 Possessed cells (differences).** A specification or value difference (`spec.differs`, `quantity.differs`, `org.name_differs`, `date.differs`, `funding.differs`) gets a marked boundary on hover **and** focus, with no text distortion. Its evidence view shows both cited phrases together, each highlighted with its document name, so the two conflicting values are compared side by side.
- **HU-13 Séance summary.** The results header carries one sentence per response document in the theme's voice, for example "2 ghosts and 1 curse confirmed in Quotation QB-04; 1 possible ghost needs review." The plain counts are always beside it. It is built from the same counts as the summary bar and the export, never from separate logic. Confirmed and Needs review are counted separately; Not evaluated is stated ("4 comparisons did not run"); it never says "clean", "nothing found" or similar when anything is Needs review or Not evaluated, or when coverage is unverified. In Lights on it is the plain sentence without theme names.
- **HU-14 PackCheck inherits the layer with its own vocabulary.** All components, modes, effects and rules above are in `packages/ui`; PackCheck supplies only its theme names (table below) and reuses ghost rows for missing attachments and possessed styling for cross-document differences.
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
| PackCheck | `attachment.missing` | "Required attachment not listed in ..." | Lost page | Possibly lost page | yes |
| PackCheck | `org.name_differs` | "Organisation name differs between ..." | Doppelgänger | Possible doppelgänger | yes |
| PackCheck | `funding.differs`, `date.differs` | "... differs between ..." | Changeling | Possible changeling | yes |
| PackCheck | `funding.exceeds_budget` | "Funding requested exceeds the total project budget" | Bottomless purse | (always confirmed when raised) | yes |
| both | Not evaluated (a comparison, not a finding) | "Not evaluated" | Unseen (design.md) | | yes |
| both | Needs review (state) | "Needs review" | lantern icon only, no name | | yes |
| both | identity uncertain, unverified, multiple items, contaminated, value held | (their plain messages) | none | none | yes |

Theme names for rules that are not built are reserved, not shown.

## Reconciliation with the brief's "Haunted design layer"

| Brief | Here |
|---|---|
| Dark, inky "after-hours procurement office" palette; one ectoplasm-green accent for findings | Lights-off palette in `design.md` (dark). **Differs:** findings use state colours (danger for confirmed, amber for Needs review) so certainty stays readable (amendment 4, HU-6); green stays "validated / agrees". To review: an ectoplasm-green accent for decoration only. |
| Clean sans-serif for data; restrained serif for headings | As `design.md` (system fonts, no web fonts: HU-9) |
| Ghost rows flicker once, then settle; clicking solidifies and opens the evidence | HU-11, for **confirmed** absences only; one fade of at most 1 s instead of a flicker; static under reduced motion |
| Possessed cells: distortion on hover; evidence highlights both conflicting phrases | HU-12: a marked boundary on hover and focus, **no text distortion** (HU-2); both phrases side by side |
| Séance summary, e.g. "3 ghosts and 2 curses found in Supplier B's quote", with plain counts | HU-13, with confirmed and Needs review counted separately and Not evaluated stated |
| Sound optional, off by default | **Not built** (HU-9); open decision |
| Lights on removes animation and atmosphere; respects reduced motion automatically | HU-1, HU-5, HU-8 |
| Theme in the shared UI layer; PackCheck inherits it with its own vocabulary | HU-14 |
| Finding theme names (Ghost, Possessed, Wrong count, Shapeshifter, Curse, ...) | HU-10 table; names only for rules that exist |
| `theme.md` steering: tone of copy and haunted vocabulary | HU-15 |
| "Every screen must work by keyboard, meet WCAG AA contrast" | HU-3, HU-4 |

## Open decisions (for review)

1. **Sound:** keep "no sound" (proposed), or build optional sound, off by default, as the brief allows.
2. **Ectoplasm green:** decoration-only accent in Lights off (proposed), or none.
3. **PackCheck theme names:** the proposed names above (Lost page, Doppelgänger, Changeling, Bottomless purse), or others.
4. **Default mode:** Lights off by default (current HU-8), or Lights on by default with Lights off one click away.

## Protected scope

If time runs short, ship Lights on (fully accessible) plus the Lights-off palette and typography, then the séance summary and theme names. Cut effects first (ghost fade, possessed boundary animation), then motifs and illustrations. **Never cut HU-2 to HU-7, HU-10's "second name, never a verdict" rule, or HU-13's counting rules.**
