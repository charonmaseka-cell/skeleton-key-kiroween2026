# SC-T12 fresh-document validation: live results (1 November 2026, UTC)

Batch `sc-t12-fresh`: a separate allowance of **16 attempts and 3,000 estimated neurons**, daily ceiling 8,000, concurrency 1, at most one JSON repair per request, model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, 1,500-token cap, 25 s timeout, production admission 0. The earlier 3 unused attempts were not touched. Rules, labels, documents, profiles and the chunk plan were not changed at any point (freeze chain checked: `freeze.json` (implementation) -> `freeze-2.json` (runner stop conditions, before the batch) -> `freeze-3.json` (runner recovery, during the batch, see failure 1)). Coverage stays **unverified** for all three documents.

Files: `samples/benchmark-results/live-sc-t12-fresh-resume2-*.json` (result: all 12 chunks, the first reused from the recovered response), `recovered-sc-t12-fresh-invocation1.json`, the three raw response logs `raw-sc-t12-fresh*.jsonl`, and the batch record `batch-sc-t12-fresh.json`.

## Failures first

**1. Two invocations were interrupted by me; 2 attempts and their reservations were spent with no response.** I started the live process in the background from a tool call. The sandbox ends every process when the tool call that started it returns, so the run died after 2 model calls (call 1, RFQ chunk 1: answered and logged; call 2, RFQ chunk 2: dispatched, never returned). The first resume, also started in the background (with `setsid`), died the same way after dispatching RFQ chunk 2 again. The third invocation ran in the foreground and completed. Consequences, all within the authorised allowance:
- 2 of the 14 attempts used produced no response. Their worst-case reservations (363.6 estimated neurons each, 727.1 in total) **stand** in the batch and the daily ledger, because whether and how much they consumed is unknown.
- One runner-only change was made mid-batch, before the resume and before looking at any claims (only the logged usage of call 1 had been seen): the batch now records each attempt's reservation at dispatch, and a recovery step rebuilds an answered chunk from the raw log (by the SHA-256 of the exact request) so it is not resent. Recorded as `freeze-3.json`; tests in `recover.test.ts`. The answered RFQ chunk 1 was reused and **not resent**; RFQ chunk 2 was sent a third time and answered.
- The batch allowance was never reset or raised: invocations started with 16, 14 and 13 attempts available.

**2. Extraction faults (the model's output; not changed or corrected):**
- **Item values without their code, some as whole rows.** In the tender 11 of 12 item values omit the reference code, and 8 of those are the whole row (description, quantity and specification joined by spaces, for example `Analytical balance with 2 each 220 g, 0.1 mg readability`). In quotation A 7 of 11 omit the code (none is a whole row). Quotation B kept every code. All are visible in their evidence, so they validate (`wrong_value` against the labels). The identity step still tied each to its code (10 by the reference cell, 8 from the single code in the line).
- **A wrong quantity:** quotation A `SP-5302` "Sample bottle 1 l ... 200 each": the model took `1 l` from the description as the quantity. The quantity comparison was **incomparable** (units differ), so it is a **Needs-review** `quantity.differs`, not a confirmed one: an unexpected finding, but not a false critical.
- **A second quantity on one tender line:** `CL-6401` "15 sets ... 250 ml": both were extracted as quantities, so the quotation B quantity comparison is Not evaluated (`multiple_candidates`); the tender's `CL-6401` specification was not extracted, so its specification comparison is Not evaluated too.
- **Misses:** quotation B `SP-5310` specification; quotation A unit prices for `SP-5302`, `SP-5310`, `CL-6401` (3 claims dropped by the Worker as invalid values); two quotation A unit prices held for review (`value_not_in_excerpt`). Prices are not compared, so no finding depends on them.
- **The connector rule was NOT exercised.** For quotation A `LB-3101` (`c/w 0.01 pH resolution`) the model chose the excerpt `0.01 pH resolution` without `c/w`, so the comparison agreed without the rule playing any part. This run is no evidence for or against it.

## Findings: 12 expected, 13 produced (reported separately)
| | Count | Which |
|---|---|---|
| **Expected detections** (exact code, subject, severity, state) | **12 of 12** | the 5 confirmed differences (A `LB-3110` qty, `LB-3115` spec, `FD-4202` spec; B `LB-3101` qty, `LB-3102` spec); 3 absences Needs review (A `FD-4215`, `CL-6401`; B `SP-5302`); A `CL-6401` identity uncertain (`ISO-17034` and `CL-6401` in one cell); 3 exclusions (A installation and training; B VAT; B carriage) |
| **Missed** | **0** | |
| **False criticals** | **0** | |
| **Over-confident** | **0** | |
| Unexpected (not labelled) | 1 | A `SP-5302:quantity` Needs review (incomparable), from the wrong quantity above |
| Before the identity step (reference only) | 4 of 12, 1 false critical | the item codes are what make the matching work here |

Caveats on the 12 of 12: (a) one fresh set, one run, one model; (b) I wrote both the documents and the rules, and the reference-cell identity rule was added while preparing this set (before the freeze and before any inference), so the set is not independent of that fix; (c) 4 of the 12 are Needs-review items whose correct state is "not concluded"; (d) one exclusion value differs from its label (`Carriage to site and installation`); it counts because its evidence is the labelled line, by the scoring rule fixed before the run.

## Unresolved items (Needs review)
Identity: 1 uncertain (quotation A `p1-l16`, `multiple_codes`: `ISO-17034`, `CL-6401`), as pre-registered. Findings in Needs review: the 3 absences, the uncertain identity, and the incomparable `SP-5302` quantity. Held values: 2 unit prices (`value_not_in_excerpt`).

## Extraction outcomes (per value, against the pre-registered labels)
| Document | Labels | Correct | Differ from label, visible in evidence | Held | Missed | Wrongly validated |
|---|---|---|---|---|---|---|
| Tender (rfq) | 36 | 24 | 11 | 0 | 1 | 0 |
| Quotation A | 45 | 30 | 10 | 2 | 3 | 0 |
| Quotation B | 46 | 44 | 1 | 0 | 1 | 0 |
123 claims (9 of them from the recovered chunk), every one with located evidence; audit: every validated value consistent with its evidence, so the unsupported-value stop never fired; 3 claims dropped by the Worker.

## All 48 planned comparisons
33 agree, 6 flagged (5 genuine differences and the incomparable `SP-5302` quantity), **9 Not evaluated**: 6 by design (the absent or unmatched items), 3 caused by extraction (`SP-5310` spec in B, `CL-6401` quantity and specification against B).

| Comparison | Status | Detail, or the blocked input (document/field/reason) |
|---|---|---|
| quantity:LB-3101 vs quote-a | agree | 6 each <-> 6 each |
| specification:LB-3101 vs quote-a | agree | 0.01 pH resolution <-> 0.01 pH resolution |
| quantity:LB-3102 vs quote-a | agree | 4 each <-> 4 each |
| specification:LB-3102 vs quote-a | agree | 0-1000 NTU, battery powered <-> 0-1000 NTU, battery powered |
| quantity:LB-3110 vs quote-a | **flagged** | 8 each <-> 6 each |
| specification:LB-3110 vs quote-a | agree | hotplate, up to 300 C <-> hotplate, up to 300 C |
| quantity:LB-3115 vs quote-a | agree | 2 each <-> 2 each |
| specification:LB-3115 vs quote-a | **flagged** | 220 g, 0.1 mg readability <-> 220 g, 1 mg readability |
| quantity:FD-4201 vs quote-a | agree | 20 each <-> 20 each |
| specification:FD-4201 vs quote-a | agree | 10 m range, vented cable <-> 10 m range, vented cable |
| quantity:FD-4202 vs quote-a | agree | 5 each <-> 5 each |
| specification:FD-4202 vs quote-a | **flagged** | 0.1-5 m/s, IP68 <-> 0.1-5 m/s, IP65 |
| quantity:FD-4210 vs quote-a | agree | 12 each <-> 12 each |
| specification:FD-4210 vs quote-a | agree | tipping bucket, 0.2 mm <-> tipping bucket, 0.2 mm |
| quantity:FD-4215 vs quote-a | **Not evaluated** | quote-a/item/coverage_unverified |
| specification:FD-4215 vs quote-a | **Not evaluated** | quote-a/item/coverage_unverified |
| quantity:SP-5301 vs quote-a | agree | 400 each <-> 400 each |
| specification:SP-5301 vs quote-a | agree | HDPE, wide neck <-> HDPE, wide neck |
| quantity:SP-5302 vs quote-a | **flagged** | 200 each <-> 1 l |
| specification:SP-5302 vs quote-a | agree | amber glass <-> amber glass |
| quantity:SP-5310 vs quote-a | agree | 10 each <-> 10 each |
| specification:SP-5310 vs quote-a | agree | insulated, 48 hour hold <-> insulated, 48 hour hold |
| quantity:CL-6401 vs quote-a | **Not evaluated** | quote-a/item/coverage_unverified |
| specification:CL-6401 vs quote-a | **Not evaluated** | quote-a/item/coverage_unverified |
| quantity:LB-3101 vs quote-b | **flagged** | 6 each <-> 5 each |
| specification:LB-3101 vs quote-b | agree | 0.01 pH resolution <-> 0.01 pH resolution |
| quantity:LB-3102 vs quote-b | agree | 4 each <-> 4 each |
| specification:LB-3102 vs quote-b | **flagged** | 0-1000 NTU, battery powered <-> 0-100 NTU, battery powered |
| quantity:LB-3110 vs quote-b | agree | 8 each <-> 8 each |
| specification:LB-3110 vs quote-b | agree | hotplate, up to 300 C <-> hotplate, up to 300 C |
| quantity:LB-3115 vs quote-b | agree | 2 each <-> 2 each |
| specification:LB-3115 vs quote-b | agree | 220 g, 0.1 mg readability <-> 220 g, 0.1 mg readability |
| quantity:FD-4201 vs quote-b | agree | 20 each <-> 20 each |
| specification:FD-4201 vs quote-b | agree | 10 m range, vented cable <-> 10 m range, vented cable |
| quantity:FD-4202 vs quote-b | agree | 5 each <-> 5 each |
| specification:FD-4202 vs quote-b | agree | 0.1-5 m/s, IP68 <-> 0.1-5 m/s, IP68 |
| quantity:FD-4210 vs quote-b | agree | 12 each <-> 12 each |
| specification:FD-4210 vs quote-b | agree | tipping bucket, 0.2 mm <-> tipping bucket, 0.2 mm |
| quantity:FD-4215 vs quote-b | agree | 30 each <-> 30 each |
| specification:FD-4215 vs quote-b | agree | capacitance type, 3 m cable <-> capacitance type, 3 m cable |
| quantity:SP-5301 vs quote-b | agree | 400 each <-> 400 each |
| specification:SP-5301 vs quote-b | agree | HDPE, wide neck <-> HDPE, wide neck |
| quantity:SP-5302 vs quote-b | **Not evaluated** | quote-b/item/coverage_unverified |
| specification:SP-5302 vs quote-b | **Not evaluated** | quote-b/item/coverage_unverified |
| quantity:SP-5310 vs quote-b | agree | 10 each <-> 10 each |
| specification:SP-5310 vs quote-b | **Not evaluated** | quote-b/specification/no_fact |
| quantity:CL-6401 vs quote-b | **Not evaluated** | rfq/quantity/multiple_candidates |
| specification:CL-6401 vs quote-b | **Not evaluated** | rfq/specification/no_fact |

## Timing, attempts and charges
- **Per request (ms):** RFQ 10,254 (invocation 1), 17,049, 16,588, 4,665; quotation A 8,438, 14,332, 18,135, 14,100; quotation B 14,004, 19,652, 15,719, 10,018. No timeouts, no repairs.
- **Processing time for the 12 answered requests: 163.0 s** (sequential). The completing invocation took 153.3 s wall-clock for 11 requests. The batch's own wall clock (22:55:52 to 23:11:43 UTC) is not a processing time: it includes the two interruptions and my recovery work.
- **Attempts: 14 of 16** (12 answered, 2 dispatched and never answered; 0 repairs). 2 unused. The earlier 3 unused attempts are still unused.
- **Measured tokens (answered calls):** prompt 6,217, completion 5,326. Unknown for the 2 unanswered calls.
- **Estimated charges** (published rates, 1.1 margin; not dashboard-confirmed): **2,109.2 of 3,000** for the batch = 1,382.1 from the 12 answered calls + 727.1 standing reservations for the 2 unanswered ones. Daily ledger: 6,399.9 of 8,000 (it was 4,290.7 at the start). The model's own usage field reported 1,256.6 neurons for the 12 answered calls; that is the provider's per-call figure, also not dashboard-confirmed.

## Re-run under `scopecheck.quote.v2` (7 November 2026)
The same fresh set, run once more through the production Worker with the tender under `scopecheck.rfq.v1` and both quotations under `scopecheck.quote.v2` (which also asks for each line's total). Recording: `samples/benchmark-results/live-sc-t12-fresh-quote-v2-2026-11-07T18-48-22-626Z.json`, claims unedited; the accepted recording above is unchanged. Same 12 parts, concurrency 1, no retry; hard stop 5,000 neurons, hold 3,558.822, **1,424.194 settled**; about 194 s for the 12 parts.

| | `quote.v1` (1 Nov) | `quote.v2` (7 Nov) |
| --- | --- | --- |
| Expected findings exact | 12 of 12 | 12 of 12 |
| Missed / false critical / over-confident | 0 / 0 / 0 | 0 / 0 / 0 |
| Produced | 13 (1 unexpected Needs review) | 12 |
| Line totals extracted | not asked | 0 (the documents state none) |
| Price findings | none | none |
| Comparisons (agree / flagged / not evaluated) | 48 (33 / 6 / 9) | 67 (36 / 5 / 26) |

The 19 added comparison rows all read "no line total was extracted for this line"; none says "agrees". Extraction counts (correct / differ from label / held / missed): tender 24 / 12 / 0 / 0, quotation A 30 / 11 / 1 / 3, quotation B 43 / 2 / 0 / 1 (before: 24 / 11 / 0 / 1, 30 / 10 / 2 / 3, 44 / 1 / 0 / 1). The model is not deterministic: 16 of 123 values differ in wording from the first run, and the `SP-5302` quantity was read correctly this time, so the earlier unexpected finding did not recur. No rule or label was changed after the result. Score it with `npx tsx --tsconfig packages/ui/tsconfig.json tools/benchmark/src/score-fresh.ts <recording>`.
