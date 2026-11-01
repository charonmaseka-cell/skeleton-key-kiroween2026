# Haunted interface (shared, both apps)

**Introduced:** 2026-11-01, in PR #5 (`task-6-app-shells`); exact commit recorded in `.kiro/specs/README.md`. Not part of the foundation spec.

**Reads with:** foundation R13 (accessibility), R9 (honest sample labelling), R4.7 (extracted lines are not original lines), R7 (review states). The visual system and the Lights-on behaviour are in `design.md`.

**Status:** a committed task, not optional polish. The visual system is defined now; implementation proceeds **alongside the working upload flow** and the theme is **complete before the final submission week**.

## Requirements

- **HU-1 Two modes, one product.** *Lights off* is the haunted presentation. *Lights on* is a plain, light presentation with no decorative effects. Every review state, evidence view, control and export is identical in function and wording in both.
- **HU-2 Readable evidence always.** Cited evidence, the highlighted span, its document and block labels, and every status badge stay readable in both modes. No decoration overlaps text, evidence, controls or a status. Highlighting uses an outline as well as colour.
- **HU-3 Keyboard.** Everything operable by keyboard in both modes, with a visible focus ring that meets contrast in both. The mode toggle is a real button, first in the header after the skip link, with `aria-pressed` and a text label ("Lights on" / "Lights off").
- **HU-4 AA contrast, enforced.** Text at least 4.5:1 and control boundaries and focus rings at least 3:1, in both modes, for the tokens in `packages/ui/src/theme-tokens.ts`. A test enforces it for the tokens; automated accessibility checks cover the rendered apps once they exist.
- **HU-5 Reduced motion and safe effects.** With `prefers-reduced-motion: reduce`, all effects are static. Otherwise no flashing above 3 per second, no effect longer than five seconds without a stop, and no parallax. Nothing moves in Lights on.
- **HU-6 Not colour alone.** Status is text plus icon. Not evaluated, Needs review, confirmed, validated and user-supplied stay distinguishable in grayscale.
- **HU-7 Honest labelling survives the theme.** The sample banner, the "recorded model output" note and the live-mode banner are never hidden, restyled into invisibility, or replaced by decoration.
- **HU-8 Preference and privacy.** The mode preference is stored as a single value (`on` or `off`) in the browser and never contains document content. The default is Lights off, except Lights on when the system requests more contrast. Print and export always use the Lights-on palette.
- **HU-9 Cost containment.** Effects are CSS only, no images over 20 kB each, no third-party fonts or scripts, no sound.

## Protected scope

If time runs short, ship Lights on (fully accessible) plus the Lights off palette and typography. Cut decorative effects first, then illustrations. Never cut HU-2 to HU-7.
