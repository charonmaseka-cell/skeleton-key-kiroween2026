# ScopeCheck baseline: versioned offline replay (correctness fixes), 2 November 2026

**No model was called and no attempt was used** (the 3 remaining attempts are untouched; production admission 0). The saved responses of the baseline (`live-sc-t4-quote-b-*.json`: 239 claims, byte-for-byte as saved) were re-validated and re-scored with the current code. The original baseline files are unchanged and its report (`sc-t4-scopecheck-baseline.md`) stands as the record of the live run.

Replay file: `samples/benchmark-results/replay-sc-t4-replay-rules3-ingest2-*.json`. Its `replay` block records the versions:

| | Version |
|---|---|
| Responses produced with | parser `ingest/1` (text lines only), live run of 2026-11-01 |
| Re-scored with | parser `ingest/2-cells`, ScopeCheck rules version 3, audit version 2, frozen chunk plan |

The historical responses are NOT results of the new parser or the new rules: the model saw `ingest/1` text. `ingest/2-cells` leaves every block's id and text unchanged (it only adds layout metadata), so every saved evidence offset still points at the same characters; the fixtures in `samples/fixtures` are `ingest/1` blocks and their test ignores only the added metadata.

## What changed (each with regression tests)
1. **Leading connectors** `with`, `c/w`, `complete with`, `incl.` are removed from the front of a specification before comparing. Prefix only, whole words, longest first; negation, numbers, units, standards and qualifiers are kept. The comparison detail says when a connector was not counted. Tests: the three saved cases, 12 genuine differences that must still be detected (IE2/IE3, IP65/IP67, 0-20/0-30 l/h, armoured/unarmoured, 316/304, PN16/PN10, negation, spare count, standard, unit, dropped qualifier, moved qualifier).
2. **Identity from validated source cells.** The four RFQ rows were one PDF.js text item with written `|` separators, so x-coordinates cannot split them. Where the model joined two cells with `|` in one value, each part must be found exactly once in the cited span and in a different source cell; the code is then taken from the description cell only. A code in the specification cell is no longer taken as the item's code. The raw claim is not edited; the part spans are recorded and checked intact. Ambiguous cases (part not found, found twice, two parts in one cell, two codes in the description cell) stay in review.
3. **Coordinate-aware cells** (`ingest/2-cells`), for PDFs with genuinely positioned columns: cells from item gaps, checked against a column grid shared by at least 3 lines; wrapped cells linked to the cell above; adjacent columns that merge, off-grid lines, a lone line under the first column and pages with too few aligned lines are `uncertain` and get no cells. **Not exercised by the sample PDFs** (they have no positioned columns): tested on synthetic items only, and no real-world PDF with positioned columns has been checked.
4. **All 96 comparisons are planned** (24 rows x 2 quotations x 2 aspects). An unresolved requirement identity and a requirement line with no item value are each listed as Not evaluated with the blocked input; a quotation line with a quantity, specification or price but no item counts as a possible hiding place for an absent item. The run reports, from the labels as a diagnostic only, expected against planned. A requirement row with no facts at all cannot be listed by the ledger; that shortfall is reported by the diagnostic, not hidden.
5. **Exclusions are separate findings**, each identified by its source line. The scorer counts a produced exclusion as detecting the labelled one only if its evidence is in the labelled line; a test removes the freight claim and shows VAT alone is then a miss.

## Result (offline; compare with the baseline report)
| | Baseline (live, 2 Nov report) | Replay |
|---|---|---|
| Expected findings exact | 16 of 18 | **18 of 18** |
| Missed | 2 (PN-130 quantity, TK-120 absence) | 0 |
| False critical | 4 | **1** |
| Over-confident | 0 | 0 |
| Unexpected other | 4 RFQ identity items | 1 (VAT exclusion, confirmed, info) |
| Comparisons planned | 80 | **96** |
| Agree / flagged / Not evaluated | 52 / 12 / 16 | 64 / 10 / 22 |
| Identities recovered / uncertain | 17 / 5 | 21 / 1 |

Extraction scores are unchanged (the claims are the same): RFQ 60 correct, 12 differ from label; quotation A 78 / 10 / 1 missed; quotation B 75 / 1 / 9 missed. Nothing was relabelled.

## Remaining honest problems
- **One false critical remains:** `spec.differs SN-403:specification` in quotation B. The model returned the specification as `DN50 SN-403 with electromagnetic, IP68` (item name inside the specification), and the "with" is in the middle. This is an extraction fault, not a connector; stripping inside the value would be guessing and was not done.
- **The 18 of 18 is a replay on the same responses the rules were written against.** It shows the five defects are fixed on these documents; it does not show the rules generalise. A fresh live batch with different documents is needed for that.
- **Missed values are unchanged:** quotation A's PN-140 specification, and nine specifications in quotation B. Their comparisons are now listed as Not evaluated (22 in total) with `no_fact` or `coverage_unverified` as the blocked input.
- Three of the expected findings are absences that are Needs review because coverage is unverified; "exact" for them means exactly Needs review, as pre-registered.
- Item values with an appended column are still produced by the model; they are now identified from the source but remain `wrong_value` in the extraction score.

---

# Rules v4: contaminated specification fields (SN-403), offline

Same saved responses; **no model call; the 3 remaining attempts and admission 0 are untouched**. The rules-v3 replay file above is kept as saved (a test reads it); the next replay is `samples/benchmark-results/replay-sc-t4-replay-rules4-ingest2-*.json` (rules v4, `ingest/2-cells`, audit 2).

**The check.** A specification is *contaminated* when it contains the item code of the same row (resolved for that source line), because then the extraction put part of the row's identity into the specification and what is left is not a clean specification. Nothing is removed from the value, no item is named in the code, and only a code that is the row's own counts: a standard (`SANS-1200`), another item's code or a longer number that merely starts like it does not. A value the user typed is trusted. When it applies: a Needs-review finding `specification.contaminated` and the comparison is Not evaluated with `contaminated_value` as the blocked input.
Honest limits: the check was designed after seeing this case, so this replay cannot show it generalises; it is a narrow, general signal (own code in the specification), not a detector of all contamination. It would also turn a genuine difference into Needs review when the specification carries the row's own code, which is the intended conservative direction. The item-description overlap signal was rejected: several correct quotation B specifications are repeated inside the model's item text.

| Reported separately | Rules v3 | Rules v4 |
|---|---|---|
| **Expected detections** (exact of 18) | 18 | **18** (none given up; missed 0, over-confident 0) |
| **False criticals** | 1 (SN-403 specification) | **0** |
| **Not evaluated** (of 96 planned) | 22 | **23** (+ SN-403 specification, `contaminated_value`) |
| Agree / flagged | 64 / 10 | 64 / 9 |
| Unexpected extra findings | 1 (VAT exclusion, confirmed, info) | 2: `specification.contaminated` SN-403 (Needs review) and the unlabelled VAT exclusion (confirmed, info) |

Not evaluated, by blocked input: 10 `specification/no_fact`, 10 `item/coverage_unverified`, 2 `item/match_unresolved`, 1 `specification/contaminated_value`. Remaining misses are unchanged: the PN-140 specification (quotation A) and nine specifications (quotation B) were never extracted. Regression tests: `contamination.test.ts` (own code, case, standard, other item, longer number, no resolved code, user-typed), and `baseline-replay.test.ts` (genuine differences MT-301, CB-501, CP-103, SN-401 still confirmed; the old replay file unchanged).
