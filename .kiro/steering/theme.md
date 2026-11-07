---
inclusion: fileMatch
fileMatchPattern: "{packages/ui,apps}/**/*.{ts,tsx,css}"
---

# Theme: tone of copy and vocabulary (haunted-ui HU-15)

Source of truth: `.kiro/specs/haunted-ui/requirements.md` (HU-10 to HU-16). The theme is a second name next to the plain wording, never a verdict.

## Tone
- Dry and brief. Never jokey about the reviewer's work, never alarming about uncertainty.
- Theme words appear **only** in headings, badges and the séance sentence, **only in Lights off**. Never in explanations, reasons, evidence, error messages, banners, exports, print or accessible names.
- The plain message is always written first and is complete without the theme name.

## Rules that keep it honest
- A Needs-review finding gets the "Possible ..." name, never the confirmed name.
- A Not-evaluated comparison is shown in plain words only, never given a finding's name.
- Never write "clean", "all clear", "no problems" or "nothing found" while anything is Needs review, Not evaluated or has unverified coverage.
- Ectoplasm green (`ecto`) is brand, decoration and the focus ring only. State colours (accent, danger, ok) carry findings. Never use `ecto` for a status.
- No sound, no third-party fonts, images or scripts.

## Vocabulary (adapter data; confirmed name / Needs-review name)
These are the names the apps show (`labels.theme` in each adapter). A finding with no Needs-review name shows no theme name while it is Needs review.

| Finding | ScopeCheck / PackCheck | Name | If Needs review |
|---|---|---|---|
| Missing item | ScopeCheck `item.absent` | Ghost | Possible ghost |
| Quantity differs | ScopeCheck `quantity.differs` | Miscount | (none) |
| Specification differs | ScopeCheck `spec.differs` | Curse | (none) |
| Exclusion stated | ScopeCheck `exclusion.stated` | Fine-print spectre | (always confirmed) |
| Line total differs from quantity times unit price | ScopeCheck `price.arithmetic` | Phantom maths | (always confirmed; an unclear total is `price.unclear`, plain wording only) |
| Unit unclear | ScopeCheck `unit.ambiguous` | none: plain wording only | |
| Missing attachment | PackCheck `attachment.missing` | Lost page | Possible lost page |
| Organisation name differs | PackCheck `org.name_differs` | Doppelgänger | (none) |
| Another value differs | PackCheck `funding.differs`, `date.differs` | Changeling | (none) |
| Funding exceeds budget | PackCheck `funding.exceeds_budget` | Bottomless purse | (always confirmed) |
| Not evaluated | both | none: plain wording only | |

Reserved for rules not built yet: Shapeshifter, Late arrival, Blood price, Short life, Stowaway, Fading.
