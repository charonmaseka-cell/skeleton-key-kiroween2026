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
- A Not-evaluated comparison is "unseen", never given a finding's name.
- Never write "clean", "all clear", "no problems" or "nothing found" while anything is Needs review, Not evaluated or has unverified coverage.
- Ectoplasm green (`ecto`) is brand, decoration and the focus ring only. State colours (accent, danger, ok) carry findings. Never use `ecto` for a status.
- No sound, no third-party fonts, images or scripts.

## Vocabulary (adapter data; confirmed name / Needs-review name)
| Finding | ScopeCheck / PackCheck | Name | If Needs review |
|---|---|---|---|
| Missing item | ScopeCheck `item.absent` | Ghost | Possible ghost |
| Specification differs | ScopeCheck `spec.differs` | Possessed | Possibly possessed |
| Quantity differs | ScopeCheck `quantity.differs` | Wrong count | Possible wrong count |
| Exclusion stated | ScopeCheck `exclusion.stated` | Curse | (always confirmed) |
| Missing attachment | PackCheck `attachment.missing` | Lost page | Possibly lost page |
| Organisation name differs | PackCheck `org.name_differs` | Doppelgänger | Possible doppelgänger |
| Another value differs | PackCheck `funding.differs`, `date.differs` | Changeling | Possible changeling |
| Funding exceeds budget | PackCheck `funding.exceeds_budget` | Bottomless purse | (always confirmed) |
| Not evaluated | both | Unseen | |

Reserved for rules not built yet: Shapeshifter, Late arrival, Blood price, Short life, Phantom maths, Stowaway, Fading.
