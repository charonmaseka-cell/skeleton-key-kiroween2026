# SC-T15 second-model comparison on the fresh set: `llama-3.1-8b-instruct` vs the accepted 70B (2 November 2026, UTC)

One batch, run once, in the foreground, 00:00:15 to 00:01:09 UTC. Separate allowance: 16 attempts, 3,000 estimated neurons, daily ceiling 8,000, concurrency 1, one repair per request. Not combined with any other allowance; not repeated. No PackCheck or concurrency call. Production admission 0.

**Fairness.** Run from a separate git worktree at the accepted commit `e35df62` (the SC-T12 freeze chain), with its own `npm ci`, so that this branch's later change (cell boundaries sent to the model) could not reach the requests. The worktree's freeze, stop-condition, batch and recovery tests passed (41), and all 12 of its request bodies had the SHA-256 the live 70B batch logged: **the model-facing requests were byte-identical; only the model differed** (`--model @cf/meta/llama-3.1-8b-instruct`). Both runs report the same prompt total, 6,217 tokens. The worktree shared the real ledger and admission counter.

Files: `samples/benchmark-results/live-sc-t12-fresh-8b-*.json`, `raw-sc-t12-fresh-8b-*.jsonl`, `batch-sc-t12-fresh-8b.json`.

## Failures and defects first
1. **The 8B misses most of what the product exists to find:** 9 of the 12 pre-registered findings, including all 5 confirmed quantity and specification differences.
2. **Raw log names the wrong model.** The frozen runner's recorder sat inside the model override, so each start line says `llama-3.3-70b-instruct-fp8-fast`. The run did use the 8B: the result file and the run log name it, mean latency was 4.4 s against 13.9 s, and the provider reported 266.8 neurons for the 12 calls against 1,256.6 for the same requests on the 70B. Fixed for later runs (`14af64a`, with a test); the frozen worktree was not changed.
3. **Misleading completeness line.** The run printed "INCOMPLETE (a comparison is missing)", but it planned 52 comparisons against 48 labelled: the 8B read the wrapped line "draught shield" as an item of its own, and lines whose item was held are listed by fact id. Nothing was hidden. Wording fixed for later runs.

## Against the committed criteria (`docs/model-comparison.md`, written before any 8B run)
| Criterion | 70B (accepted) | 8B | |
|---|---|---|---|
| G1 no unsupported value validated | pass (audit suspect 0) | pass (audit suspect 0, wrongly validated 0) | |
| G2 no false critical, no over-confident, no confirmed omission while unverified | pass | pass | |
| G3 schema-valid within one repair | pass (12 of 12, 0 repairs) | pass (12 of 12, 0 repairs) | |
| G4 held and rejected values surface as Needs review | pass | pass (23 unexpected Needs-review items) | |
| **Q1** strict findings no worse; no miss the baseline detected | 12 of 12 | **3 of 12; misses 9 the 70B detected** | **fail** |
| **Q2** missed facts + rejected/unsupported claims no higher | 5 + 2 = **7** | 43 + 16 = **59** | **fail** |

**Decision (rule step 1 and 3): the 8B is not acceptable; retain `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.** It fails Q1 and Q2. It is faster and cheaper, but the committed rule does not trade quality for cost. Same outcome as the first comparison (tasks 5.3, 5.4), now on documents neither rule nor model was tuned on.

## Findings (12 expected)
- **Detected exactly: 3.** Quotation A exclusion; quotation A `CL-6401` absent (Needs review); quotation B carriage exclusion.
- **Missed: 9.** A `LB-3110` quantity, `LB-3115` specification, `FD-4202` specification, `FD-4215` absent, `CL-6401` identity uncertain; B `LB-3101` quantity, `LB-3102` specification, `SP-5302` absent, VAT exclusion.
- **False critical 0, over-confident 0.** Every unconcluded comparison stayed Needs review or Not evaluated: the conservative design held under a weak model.
- **Unexpected: 23 Needs-review items** (8 tender items and 6 quotation A items not supported by their excerpts, 7 quantities not validated, "draught shield" as an absent item twice).

## Comparisons: 52 planned (48 labelled)
1 agree, 0 flagged, **51 Not evaluated**, by blocked input: 32 `item/value_not_in_excerpt` (a tender item held), 7 `quantity/ambiguous_candidates`, 6 `specification/no_fact`, 4 `item/coverage_unverified` and 2 `item/match_unresolved` (these 6 include the spurious "draught shield" row and `CL-6401` against A). Each with its reason and blocked input.

## Extraction (per value, against the labels)
| Document | Labels | Correct | Differ, visible in evidence | Held | Missed | Wrongly validated |
|---|---|---|---|---|---|---|
| Tender | 36 | 12 | 3 | 15 | 6 | 0 |
| Quotation A | 45 | 12 | 0 | 19 | 14 | 0 |
| Quotation B | 46 | 11 | 1 | 11 | 23 | 0 |
| **Total (70B)** | 127 | 35 **(98)** | 4 **(22)** | 45 **(2)** | 43 **(5)** | 0 **(0)** |
85 claims; 20 dropped by the Worker as invalid; rejected 16 (`value_not_in_excerpt` 14, `currency_mismatch` 2); held as ambiguous 29 (`ambiguous_candidates`). Recall 28% (70B 77%).

## Time, attempts and charges
| | 8B | 70B (accepted, answered calls) |
|---|---|---|
| Requests answered | 12 of 12 | 12 of 12 |
| Request time | **52.4 s** (mean 4.4 s, max 10.1 s) | 163.0 s (mean 13.6 s, max 19.7 s) |
| Attempts | **12 of 16** (0 repairs; 4 unused, not carried anywhere) | 14 of 16 (2 lost to my interruption) |
| Tokens (measured) | prompt 6,217, completion 6,917 | prompt 6,217, completion 5,326 |
| Estimated neurons | **746.9** (8B rates UNVERIFIED, 1.1 margin) | 1,382.1 |
| Provider-reported neurons | 266.8 | 1,256.6 |
Daily ledger for 2 November: 746.9 of 8,000. The 1 November record (6,399.9) is kept as `live-usage.2026-11-01.json`. Charges are against a budget, not dashboard-confirmed.
