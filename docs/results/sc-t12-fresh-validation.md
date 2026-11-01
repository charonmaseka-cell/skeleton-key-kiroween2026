# Fresh-document validation (SC-T12): pre-registration, freeze, plan and proposed live batch

**Status: prepared offline. No inference has been run on these documents.** No live call was made in this step; the 3 remaining attempts of the earlier authorisation are untouched; production admission is 0. The live batch below is a **proposal**, not started.

## What is being tested
Whether the ScopeCheck rules, identity step, parser and chunker (fixed on the earlier `scopecheck-realistic` set) still work on documents they were not written against: a new fictional tender and two quotations with different wording and layout. Files: `samples/scopecheck-fresh/`, generator `tools/benchmark/src/fresh-scopecheck.ts`.

| Document | Layout | Lines | Pre-registered values |
|---|---|---|---|
| `rfq` (Tender TN-7731) | **genuinely positioned table**: Ref, Description, Qty, Requirement as separate text items; two descriptions wrap onto a second line | 42 (2 pages) | 36 |
| `quote-a` (Hydro-Lab) | **positioned table** with Unit price and Notes columns; one wrapped description; one row naming a standard (ISO-17034); prose exclusion | 24 | 45 |
| `quote-b` (Delta Field) | **prose**, one sentence per item in two templates; two exclusions on separate lines | 22 | 46 |

Parsed with `ingest/2-cells`: the tender has 15 positioned lines, quotation A 13, quotation B none; wrapped lines are linked to the description cell above; cells are checked against a page column grid. 12 requirement rows x 2 quotations x 2 aspects = 48 comparisons are expected in the ledger.

## Pre-registered expected findings (12; committed before inference)
Quotation A: `LB-3110` quantity 8 -> 6; `LB-3115` specification `1 mg` for `0.1 mg`; `FD-4202` specification `IP65` for `IP68` (all Confirmed, critical); `FD-4215` absent (Needs review; Confirmed if coverage is confirmed); `CL-6401` identity uncertain (warning, Needs review) and its requirement unmatched (`item.absent`, Needs review either way); one exclusion (Confirmed, info).
Quotation B: `LB-3101` quantity 6 -> 5 and `LB-3102` specification `0-100 NTU` for `0-1000 NTU` (Confirmed); `SP-5302` absent (Needs review; Confirmed if coverage is confirmed); two exclusions (VAT, carriage), each its own finding.
**No finding expected:** quotation A `LB-3101` specification is `c/w 0.01 pH resolution` (a leading connector, not a difference); every other row agrees.
Wrapped descriptions: evidence cannot span two lines, so their labelled item value is the first line. This is a known partial, not a seeded difference.

## Offline checks run (no model)
`tools/benchmark/test/fresh-scopecheck.test.ts` (13 tests): files reproduce exactly; parsed lines equal the labelled lines; cells and wrap links on the real PDFs; each of the 127 labelled excerpts validates as a claim with intact evidence; **ideal extraction gives the 12 expected findings exactly, and so does extraction with every item code dropped** (codes come back from the reference cell for 22 rows; the standard-bearing row stays uncertain); the chunk plan regenerates identically, does not move when labels are removed or scrambled, accounts for every block, and keeps wrapped lines with their row. These show the expectations follow from the rules and that the parser and evidence layer work on positioned PDFs. They say nothing about model quality.

## Implementation added for this set (before the freeze, because the set exposed gaps)
1. The chunker counts one value per validated cell (a lone-identifier reference cell counts none) and keeps a wrapped continuation with its row. Without this a positioned table, which has no `|`, would be sized as prose.
2. Identity: a code held alone in a cell of a positioned row is that row's reference (`row_reference_cell`); it is weighed together with codes in the description cell, and a second distinct code leaves the row uncertain. Also applied when the model's own value carries a code.

## Freeze
`samples/scopecheck-fresh/freeze.json` hashes the engine, parser, ScopeCheck adapter, profiles, handler, benchmark runner, scorer, chunker, budget, preflight, generator, documents, labels and chunk plan; rules v4, parser `ingest/2-cells`, audit 2, model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, 1,500-token cap, 25 s timeout, concurrency 1, 1 repair per request. `freeze.test.ts` fails if any of it changes. Labels stay out of extraction, chunking and matching (tested).

## Frozen plan, attempts and reservations (from the preflight)
12 requests (4 per document), none over the 14-value budget by the chunker's own estimate. Estimated values per chunk: tender 14/12/12/3, quotation A 13/12/12/13, quotation B 12/12/12/8. The label diagnostic (offline only, never used) counts 9/12/12/3, 8/12/12/13 and 13/12/12/9: the estimator runs high on table header rows and one chunk low by one, and none is near the timeout forecast.
- **First attempts: 12.** Repair allowance: the Worker may repair each request once (up to 24 attempts in theory). Baseline experience: 0 repairs in 22 attempts, 1 timeout.
- Per-attempt worst-case reservation 364 to 383 neurons (a repair is similar). Expected actual charge about **1,450** estimated neurons (12 requests, 44 to 153 each); peak reservation 1,726 (charged so far + one worst case). The sum of all worst cases (4,420) is not the spend.
- Forecast per request 5 to 19 s at the typical rate (33 tokens/s), under the 25 s timeout; the baseline's slowest request was 25.0 s (a timeout) and typical 13 to 16 s, so a timeout is possible and is budgeted for.

## Proposed bounded live batch (NOT executed; needs your authorisation)
- **Attempts: 16 in total, repairs and retries included** (12 first attempts + 4 for repairs or failed-chunk retries). Concurrency 1, 1 repair per request. Stop at the first rate-limit, quota or daily error, an unrecovered schema error, an unsupported validated value, or a cap.
- **Neurons: run cap 3,000 estimated** (expected about 1,450; room for 4 extra attempts of about 370 each) **and the cumulative UTC daily ceiling stays 8,000.** The ledger on this sandbox shows 4,290.7 for 1 Nov (UTC); if the batch ran on 1 Nov the daily headroom would be 3,709.3, which covers the run cap. From 2 Nov 00:00 UTC the sandbox ledger starts at 0. These are charges against a budget, not dashboard-confirmed consumption.
- Command shape (frozen plan; the CLI preflight runs first and refuses a plan that cannot work):
  `npx tsx tools/benchmark/src/cli.ts --mode live --sample scopecheck-fresh --doc rfq,quote-a,quote-b --frozen-plan samples/scopecheck-fresh/chunk-plan.json --max-attempts 16 --run-neuron-cap 3000 --daily-neuron-cap 8000 --concurrency 1 --max-repairs 1 --label sc-t12-fresh`
- What it would report: extraction (per value, separately), identities (recovered by method, uncertain), findings against the 12 (expected, missed, false critical, over-confident, unexpected), the 48 comparisons with Not-evaluated reasons, per-request and total elapsed time, measured tokens and estimated neurons. No rule, label or plan is to change afterwards; a change is a new freeze.
- The earlier remaining 3 attempts stay unused. Concurrency measurement comes after this batch, not before.
