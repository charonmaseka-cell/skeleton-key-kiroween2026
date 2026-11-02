# Offline: cell boundaries to the model, adapter regressions, reconciliation (1 November 2026)

No model was called for anything here. Historical results are not changed; the replays below are new files.

## Audit before adding anything
| Item | Existed | Added |
|---|---|---|
| Coordinate-based cells (`ingest/2-cells`) | detection, wrap links, uncertain layouts, use in chunker and identity | **cell boundaries in the model-facing request** (they were never sent: every path sent only `{id, text}`) |
| Connector handling | unit tests of `stripLeadingConnectors` and `sameSpec` | adapter tests where `c/w`, `with`, `complete with`, `incl.` stay **inside the cited excerpt**, with real evidence, plus genuine differences that must still be confirmed |
| Unresolved requirements listed as Not evaluated | rules for held items, several items in one line, uncertain identity, missing item; covered only through replays | adapter regression test for all four, each with its reason and blocked input; removing any one rule branch fails 3 to 4 of its 5 tests |
| Build Brief | `docs/reference/ScopeCheck_Build_Brief.md`, `.kiro/steering/brief.md` (manual inclusion) | renamed to the canonical `docs/reference/scopecheck-build-brief.md` (content unchanged), links updated; steering file kept |
| Tasks | haunted UI HU-T0 to T5, clarification drafts SC-T10, hooks 7.2, deployment 7.1 / SC-T6 / SC-T7 / PC-T6 | only status notes on foundation 8, 12, 13 and 7.1; SC-T14 (cells to model) and SC-T15 (second-model comparison). Fixed a duplicate id I had introduced (concurrency is SC-T13) and a wrong date (SC-T4a) |

## Cell boundaries in the request
A line the parser validated as positioned in two or more cells is sent as `{id, text, cells}`, each cell an exact substring of the unchanged `text`, in order (`toRequestBlock`, one function for the browser client, both transports, budget claims, preflight and recovery). The Worker accepts `cells` only if they are in the text in order (2 to 16, non-empty) and counts them toward the input bound. A short prompt rule is added only when a block carries cells.
- **Every request without cells is byte-identical** to the accepted SC-T12 implementation: 17 pinned request hashes (13 chunks of the earlier realistic set, 4 of the prose quotation) are unchanged; the 8 chunks of the two positioned tables change, as intended.
- Evidence offsets are unchanged (the excerpt is still validated against `text`).
- Uncertain lines, single-item lines and wrapped continuations send no cells.
- **The effect on extraction is not measured.** A replay of saved responses cannot show it; it needs a live run with this change, which is not part of this step.

## Replays with this branch (offline, new files)
| Recorded responses | Compared with | Result |
|---|---|---|
| ScopeCheck baseline (`live-sc-t4-quote-b-*`, 239 claims) | rules-v4 replay | identical: findings, all 96 comparisons, extraction outcomes, identity counts |
| SC-T12 accepted 70B result (`live-sc-t12-fresh-resume2-*`) | the accepted live result | identical: 12 of 12, all 48 comparisons, extraction outcomes, identity counts |
Golden fixture tests for both apps pass unchanged. Files: `replay-sc-t4-replay-cells-branch-*.json`, `replay-sc-t12-replay-cells-branch-*.json`.

## Freeze check after acceptance
The SC-T12 freeze test now verifies the accepted implementation from git history at the commit the last manifest was frozen at (CI checks out full history), and checks that the evaluation set (documents, labels, chunk plan, generator) is still byte-identical in the working tree. Later work can change the implementation without rewriting any freeze.

## Found on the way
The Worker is bundled on its own and cannot import the engine package: the first version of the cells check broke the Durable Object test suite. The check is now kept in the Worker, with a test that it agrees with the engine's.
