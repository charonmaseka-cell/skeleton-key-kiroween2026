# Task 6 source review: resolution

Review: `docs/reviews/task-6-source-review.md` (verdict NEEDS_CHANGES, 17 findings, 2026-11-01). Each finding is fixed and has a regression test that fails against the reported behaviour, except where noted.

| # | Severity | Finding | Resolution | Test |
|---|---|---|---|---|
| 1 | high | Held RFQ item vanished | `item.unverified` finding on the RFQ; one Not-evaluated entry per quotation and aspect (blocked input = the item); matrix row kept | `scopecheck/review-fixes` #1 |
| 2 | high | Stale identity after correcting an item produced a false confirmed omission | A user-typed item has no resolver identity; a typed value naming several codes is uncertain, never keyed on its first code | #2 (2 tests) |
| 3 | high | Omission confirmed while a held or unidentifiable candidate line exists | ScopeCheck and PackCheck downgrade to Needs review, reason `held_candidate_in_response` | ScopeCheck #3, PackCheck #3 |
| 4 | high | Second fact per field ignored ("agrees" with an unexamined value) | Every fact is kept; two facts for a field in one place make the comparison Not evaluated (`multiple_candidates`) | ScopeCheck #4, PackCheck #4 |
| 5 | high | Money parser changed magnitude (`1,5` to 15) | Plain numbers and space-grouped thousands only; commas refused with a message; currency taken from the original value, never assumed | `ui/session-core.test` |
| 6 | medium | Coverage confirmation absent from the export | Export model, text and CSV list each document's coverage state, marked "asserted by the reviewer" | ScopeCheck #6 |
| 7 | medium | Confirmation irreversible; chunks hard-coded ok | Withdraw action; fixtures can declare chunks; a document with a failed chunk cannot be confirmed (the request is ignored) and reports `processing_incomplete` | "failed or missed chunks" tests |
| 8 | medium | PackCheck planned no comparison when a counterpart fact was missing | Expected-by-role fields and the funding check record Not evaluated (`no_fact`) | PackCheck #8 (2 tests) |
| 9 | medium | Typed values shown unlabelled in views | `PlannedComparison.userSupplied`; matrix and check tables show "uses a value you supplied" | ScopeCheck and PackCheck #9 |
| 10 | medium | Fixture switch leaked editor and note state | Workspace keyed on the fixture | `app.test` #10 |
| 11 | medium | Currency prefilled with ZAR | Prefilled from the original value only | covered by 5 |
| 12 | medium | Specification difference stated as confirmed on token inequality | **Accepted with wording change**: the finding now says "Specification text differs"; it asserts a text difference, not engineering equivalence, and stays reviewable | none (wording) |
| 13 | medium | PackCheck exact-title match only | Lexical suggestion on stemmed token containment; a plural variant never yields a confirmed omission | PackCheck #13 |
| 14 | medium | Focus lost after actions | Focus returns to the control, or to the main region if the item went away | `app.test` #14 |
| 15 | medium | Repeated control names | Names carry field, value, document and context; label contains the visible text | `app.test` #15 |
| 16 | low | Stale note after reopen; repeated announcements | Note follows the store; identical consecutive messages alternate a trailing no-break space | `app.test` #16 |
| 17 | low | Reverted corrections vanished; three value formatters | Reverted corrections kept in the export marked REVERTED; one `formatValue` in the engine, decimals no longer grouped | ScopeCheck #17 |

Deferred (low, no test): two RFQ lines that resolve to the same key share ledger ids in the matrix lookup; the findings themselves are de-duplicated, so no false result is produced. Tracked in the ScopeCheck spec.
