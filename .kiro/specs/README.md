# Specs index

When each spec was actually introduced, from git history. A spec is a plan, not evidence of completed work; `docs/build-log.md` records what was done.

| Spec | Purpose | Introduced | Where |
|---|---|---|---|
| `skeleton-key-foundation` | Shared requirements R1 to R13, design, and the original task plan (tasks 1 to 19) | 2026-11-01 (requirements first), revised 2026-11-01 | `a7d75f0` (requirements), `b705d05` (revision, design, tasks), `134d91c` (clarified decisions). **Plan corrections added 2026-11-01** in PR #5; history above them is unchanged |
| `scopecheck-real-documents` | ScopeCheck upload, multi-chunk extraction, realistic fixtures, deployment by 2026-11-22, later scope (2 to 5 quotations, DOCX, clarification email drafts) | 2026-11-01 | PR #5, commit `268b8b0` |
| `packcheck-real-documents` | PackCheck upload, attachment mapping, realistic pack, working upload by 2026-11-29 | 2026-11-01 | PR #5, commit `268b8b0` |
| `haunted-ui` | Shared haunted interface: Lights off and Lights on, visual system, accessibility, schedule | 2026-11-01 | PR #5, commit `268b8b0`; requirements revision 2 approved 2026-11-02 (from the brief's haunted design layer); design and tasks revised the same day |

The focused specs reference foundation requirements by ID (R2, R4.9, R5, R7.6, R8, R10 and so on) and do not copy them.

Steering: `.kiro/steering/brief.md` is reference material (manual inclusion): it points to the imported original brief (`docs/reference/scopecheck-build-brief.md`, historical) and holds the approved amendments, which take precedence.
