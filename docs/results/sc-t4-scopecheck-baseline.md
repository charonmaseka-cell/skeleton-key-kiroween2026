# ScopeCheck full-length baseline (SC-T4), 1 November 2026

Unchanged configuration: model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, profiles `scopecheck.rfq.v1` and `scopecheck.quote.v1`, output cap 1,500 tokens, timeout 25 s, frozen chunk plan `samples/scopecheck-realistic/chunk-plan.json` (committed before any call), pre-registered labels and 18 expected findings unchanged (`11bb39e`). Production admission 0.

Result files (kept as written, never edited): `samples/benchmark-results/live-sc-t4-rfq-fulllength-*.json`, `live-sc-t4-quote-a-fulllength-*.json`, `live-sc-t4-quote-a-resume-*.json`, `live-sc-t4-quote-b-*.json` (the strict comparison; it reuses the saved RFQ and quotation A responses and sent only quotation B), and `replay-sc-t4-rfq-fulllength-rescored-*.json` (RFQ re-scored under audit version 2).

## Audit version
`auditFact` version 1 flagged four RFQ specifications as not visible in their evidence (it removed punctuation inside words). Version 2 accepts a value written in its evidence. The original RFQ file keeps the version 1 verdict (4 "suspect", exit 3); the re-scored replay file shows 72 of 72 consistent; outcomes against labels did not change. The quotation A files were written before the fix and contain no such flag. The quotation B file was scored with version 2, so its RFQ and quotation A fact audits are version 2 as well. Files written from now on carry `auditVersion`.

## Attempts, tokens, charges
| Step | Attempts | Prompt tokens | Completion tokens | Estimated neurons |
|---|---|---|---|---|
| RFQ (6 chunks) | 6 | 4,286 | 3,022 | 806.4 |
| Quotation A (8 chunks; chunk 1 timed out) | 8 | 4,756 | 3,850 | 1,006.8 |
| Quotation A chunk 1 resumed | 1 | 866 | 505 | 139.1 |
| Quotation B (7 chunks) | 7 | 4,327 | 3,670 | 953.6 |
| **Total** | **22 of 25** (0 repairs) | **14,235** | **11,047** | **2,905.97 of 6,000** |

Tokens are MEASURED (reported by the model; the timed-out attempt reported 866 / 536). Neurons are ESTIMATES from published rates with a 1.1 margin, not dashboard-confirmed. Day total in the ledger: 4,290.71 of 8,000. No overrun. Remaining: 3 attempts, 3,094 neurons in the authorisation.

## Time
Per request (ms): RFQ 13,021 / 13,360 / 14,424 / 12,564 / 13,059 / 16,309. Quotation A 25,017 (timeout) / 13,033 / 16,478 / 12,750 / 14,279 / 15,489 / 15,500 / 5,410; resumed chunk 13,607. Quotation B 19,004 / 11,365 / 20,714 / 15,040 / 14,260 / 14,730 / 12,909.
Requests run one after another, so elapsed request time is the sum: RFQ 82.7 s, quotation A 118.0 s (first pass) + 13.6 s (resume), quotation B 108.0 s. **Total 322.3 s (5 min 22 s)**, of which the timeout and its retry were 38.6 s. Without the failure (retry counted as the chunk) 297.3 s (4 min 57 s). These figures exclude PDF reading and the pauses between my commands; a whole-process wall clock was not recorded until the quotation B run. They are measurements of one run, not a promised processing time.

## Findings: expected 18, produced 24
Strict comparison (before the identity step, for reference: 9 of 18 exact, 9 missed, 5 false critical, 22 other Needs-review). After the identity step:
- **Matched exactly (code, subject, severity and state): 16 of 18.** The 16 are the expected findings not listed as missed below; the per-finding list is in the result file (`samples[0].findings.score`).
- **Missed: 2.** `quantity.differs PN-130 (quote-a)` and `item.absent TK-120 (quote-b)`. Both trace to the same cause: the model returned the RFQ item as `Pipe DN50 PN16 | HDPE, 6 m lengths` and `Dosing tank 500 l | HDPE, with bund` (next column appended, code omitted), the identity step could not locate that description, and the system raised `item.identity_uncertain` (Needs review) on RFQ rows p2-l14 to p2-l17 instead of a finding. Conservative misses, not silent ones.
- **False critical: 4.** `spec.differs` for MT-310, SN-401, SN-402 and SN-403 on quotation B. Quotation B writes `... with DOL, IP55 enclosure`; the model returned the specification including the leading word "with", and the comparison reported `DOL, IP55 enclosure <-> with DOL, IP55 enclosure` as a confirmed critical difference. The text is the same. The comparison rule is unchanged in this baseline; a normalisation fix is follow-up work and must be measured as such, not folded into the baseline.
- **Over-confident: 0. Must-not-flag violations: 0. Wrongly validated values: 0.**
- **Unexpected Needs-review: 4** (the RFQ identities above).

## Extraction (exact values)
| Document | Claims | Correct | Differs from label (visible in evidence) | Missed | Wrongly validated |
|---|---|---|---|---|---|
| RFQ | 72 | 60 | 12 (item description without code, or with next column) | 0 | 0 |
| Quotation A | 88 | 78 | 10 | 1 (specification, PN-140, line 38) | 0 |
| Quotation B | 79 | 75 | 1 | 9 (specification of CP-101 to CP-103, VL-201 to VL-203, TK-110, PN-130, PN-140) | 0 |
All 239 claims had located evidence and supported values; none dropped by the server.

## Identities (separate from values)
- **Code returned by the model:** 45 item values.
- **Recovered from evidence by the identity step:** 17. RFQ 8 (CP-101, CP-102, CP-103, VL-201, CB-503, FL-701, FL-702, GK-801), quotation A 9 (CP-101, CP-102, CP-103, VL-201, VL-202, VL-203, TK-110, TK-120, PN-130).
- **Unresolved (Needs review):** 5. RFQ p2-l14 to p2-l17 (`description_not_located`) and quotation A p1-l30 (`multiple_codes`, expected: the pre-registered `item.identity_uncertain`).

## Needs review and Not evaluated
16 of 80 planned comparisons are Not evaluated, each with its reason:
- quotation A: quantity and specification of SN-403 (`match_unresolved`), PG-612 and CB-503 (`coverage_unverified`: the item is not found, and coverage was never confirmed, so absence is Needs review).
- quotation B: specification for CP-101, CP-102, CP-103, VL-201, VL-202, VL-203 (no specification fact extracted); quantity and specification for FL-701 and GK-801 (`coverage_unverified`).
- **PN-140 specification (quotation A)** was not extracted, and because the RFQ's PN-140 identity is unresolved no PN-140 comparison was planned at all. The same holds for the other three unresolved RFQ rows (TK-110, TK-120, PN-130): none of the 80 planned comparisons mentions them, and they appear only as RFQ identity Needs-review items. Checked in the result file. This is a gap in the ledger to fix: an unresolved requirement should still list its aspects as Not evaluated against each quotation.
- Absent items (CB-503, PG-612, SN-403 in quotation A; FL-701, GK-801 in quotation B) are Needs review, never confirmed absent, because coverage is unverified.

## Limits of this baseline
One run per document on one model; the timeout was a single event and the same chunk succeeded on retry (13.6 s). No prompt, profile, comparison rule or label was changed. Production limits (task 5.5) remain open.
