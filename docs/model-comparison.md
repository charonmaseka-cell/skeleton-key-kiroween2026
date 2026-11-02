# Model comparison and decision (spec tasks 5.3 and 5.4)

Status: **decided: retain `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.** The criteria below were written and committed (`c0d5c90`) BEFORE any run of the second candidate; results and the decision follow them.

## Question

Is `@cf/meta/llama-3.1-8b-instruct` (cheaper) good enough to replace the baseline `@cf/meta/llama-3.3-70b-instruct-fp8-fast`? R10.2: the benchmark decides the model and whether to simplify document scope.

## Design: only the model changes

- Same eight fictional documents: ScopeCheck `rfq`, `quote-a`, `quote-b`; layout sample `quote-c`; PackCheck `requirements`, `application-form`, `budget`, `registration`.
- Each document is run with the profile version its baseline run used: `scopecheck.rfq.v1` (rfq), `scopecheck.quote.v1` (quote-a, quote-b, quote-c), `packcheck.grant.v2` (application-form), `packcheck.grant.v1` (requirements, budget, registration). Same chunking, output limits, labels, client validators and identity resolver. Profile versions are recorded in each result.
- Baseline = the latest 70B live run per document: `repeat-rfq`, `repeat-quote-a`, `quote-b`, `layout-quote-c`, `packcheck-requirements`, `packcheck-application-form-v2`, `packcheck-budget`, `packcheck-registration`.
- The model is chosen in `tools/benchmark/src/candidates.ts` and applied below the Worker handler. Public clients get no model override (request schema rejects it; test exists).
- Budget: at most 2 inference attempts per document (initial + the single counted repair), 16 in total, inside the existing daily budget guard. Production `DAILY_ADMISSION_CEILING` stays 0.
- One run per document per model (n = 1). Differences of a single fact are within run-to-run noise; the rule below is nevertheless applied mechanically, and the limitation is stated with the decision.

## Stop conditions (unchanged)

Stop the batch and inspect on: an unrecovered schema error (after the one repair), an authentication or quota error, an exhausted attempt budget, or an unsupported value accepted as validated (independent audit "suspect", or an ambiguous value validated). Documents not run because of a stop are reported as not run; the decision then uses the evidence gathered and says so.

## Criteria (from the existing requirements)

**Gates. Any failure rejects a candidate regardless of cost.**

| ID | Gate | Source |
|---|---|---|
| G1 | Zero unsupported values accepted as validated (audit suspect = 0; ambiguous-but-validated = 0). | R4.3, R4.4 |
| G2 | Zero false critical findings, zero over-confident findings, zero must-not-flag violations; no confirmed omission while coverage is unverified. | R10.5, R2.7, R3.6 |
| G3 | Every request schema-valid within at most one counted repair (no unrecovered schema error). | R5.4, R8.8 |
| G4 | Rejected claims, held values and uncertain identities surface as Needs review / extraction issues; a successful request never establishes coverage. | R10.10, R4.9 |

**Quality bar. Measured on the same inputs as the baseline.**

| ID | Requirement |
|---|---|
| Q1 | Strict finding score no worse than the baseline on each sample: exact matches (ScopeCheck 4 of 4, PackCheck 3 of 3, layout 4 of 5 for the baseline) and no missed finding that the baseline detected. The fixture outcomes of R10.3 (quantity, specification, exclusion, absence; missing attachment, name inconsistency, ambiguity, funding pair not flagged) must still appear. |
| Q2 | Extraction: total missed facts plus total rejected/unsupported claims across the eight documents no higher than the baseline's. |

**Reported, not gated** (R10.1, R10.6): repairs, request latency, measured tokens, **estimated** neurons (labelled; the 8B rates are unverified), schema-valid rate, evidence-valid and value-supported rates, recall and validated precision, safe holds (held for review), and **unlabelled claims listed separately** (counted neither correct nor incorrect). Raw extraction scores are kept separate from recovered identifiers and downstream findings. Known misses stay visible: the `quote-c` CP-100 specification miss is a missed extraction and a missed finding for the baseline; safe containment does not turn it into a detection.

## Decision rule

1. Candidates failing any gate or Q1 or Q2 are not acceptable.
2. Among acceptable candidates choose the one with the lowest estimated neurons over the eight documents (tie: lower total latency).
3. If the 8B model is not acceptable, retain the 70B model and say which criterion it failed. The baseline itself must pass G1 to G4; where it falls short of the fixtures' expected outputs (Q1 reference), that is recorded as a known limitation, not hidden.
4. No third-model search at this stage.

## Supported scope (to be decided with the model)

The supported scope is limited to what was measured: text PDFs, one chunk per document, documents of up to about 400 characters (largest measured request: 357 characters, 8 blocks), the measured benchmark envelope, the four profiles above. Anything beyond that is unvalidated. These samples do not establish a public request ceiling; production admission stays at 0.

---
# Results and decision

Run on 2026-11-01. Everything below is recomputed from saved responses by `tools/benchmark/src/compare-models.ts` (no model call); data in `samples/benchmark-results/model-comparison.json` and the `live-m8b-*` result files. The 70B column is the baseline run per document listed above; the 8B column is the second candidate, one run per document with the same profile version, chunking, limits, labels, validators and identity resolver. `*` = profile version inferred from the sample manifest (those runs predate profile recording; v2 did not exist then).

## Per-document comparison

Columns: attempts / repair used; latency (ms, measured); claims returned (and how many the Worker dropped as invalid); correct labelled facts; missed labelled facts; rejected or unsupported claims; facts held for review; validated values that differ from the label (visible in their evidence); unlabelled claims; measured tokens in/out; **estimated** neurons.

| Doc | Model | Profile | Att./repair | ms | Claims (dropped) | Correct | Missed | Rejected | Held | Differs | Unlab. | Tokens | Est. neurons |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rfq | 70B | scopecheck.rfq.v1* | 1/no | 9,668 | 9 (0) | 6 | 0 | 0 | 0 | 3 | 0 | 405/339 | 80 |
| rfq | 8B | scopecheck.rfq.v1 | 1/no | 2,421 | 9 (0) | 9 | 0 | 0 | 0 | 0 | 0 | 405/534 | 50 |
| quote-a | 70B | scopecheck.quote.v1* | 1/no | 18,129 | 13 (0) | 13 | 0 | 0 | 0 | 0 | 0 | 478/528 | 121 |
| quote-a | 8B | scopecheck.quote.v1 | 1/no | 2,959 | 7 (3) | 6 | 6 | 0 | 0 | 1 | 0 | 478/663 | 62 |
| quote-b | 70B | scopecheck.quote.v1* | 1/no | 8,370 | 8 (0) | 6 | 0 | 0 | 0 | 2 | 0 | 419/317 | 76 |
| quote-b | 8B | scopecheck.quote.v1 | 1/no | 2,117 | 4 (2) | 4 | 4 | 0 | 0 | 0 | 0 | 419/410 | 42 |
| quote-c | 70B | scopecheck.quote.v1 | 1/no | 14,343 | 13 (0) | 11 | 1 | 0 | 0 | 1 | 1 | 481/522 | 120 |
| quote-c | 8B | scopecheck.quote.v1 | 1/no | 2,232 | 4 (7) | 3 | 9 | 0 | 0 | 1 | 0 | 481/511 | 51 |
| requirements | 70B | packcheck.grant.v1* | 1/no | 4,143 | 4 (0) | 4 | 0 | 0 | 0 | 0 | 0 | 429/143 | 41 |
| requirements | 8B | packcheck.grant.v1 | 1/no | 1,017 | 4 (0) | 4 | 0 | 0 | 0 | 0 | 0 | 429/180 | 25 |
| application-form | 70B | packcheck.grant.v2 | 1/no | 11,285 | 7 (0) | 7 | 0 | 0 | 0 | 0 | 0 | 618/285 | 75 |
| application-form | 8B | packcheck.grant.v2 | 1/no | 1,992 | 7 (0) | 7 | 0 | 0 | 0 | 0 | 0 | 618/345 | 42 |
| budget | 70B | packcheck.grant.v1* | 1/no | 6,748 | 5 (0) | 4 | 0 | 0 | 1 | 0 | 0 | 453/256 | 64 |
| budget | 8B | packcheck.grant.v1 | 1/no | 1,482 | 3 (2) | 2 | 2 | 0 | 1 | 0 | 0 | 453/307 | 35 |
| registration | 70B | packcheck.grant.v1* | 1/no | 1,418 | 1 (0) | 1 | 0 | 0 | 0 | 0 | 0 | 380/43 | 19 |
| registration | 8B | packcheck.grant.v1 | 1/no | 575 | 1 (0) | 1 | 0 | 0 | 0 | 0 | 0 | 380/56 | 14 |

## Totals over the eight documents

| | 70B baseline | 8B candidate |
|---|---|---|
| Inference attempts / repairs | 8 / 0 | 8 / 0 |
| Schema-valid requests | 8 of 8 | 8 of 8 |
| Latency, sum of requests (measured) | 74,104 ms | 14,795 ms |
| Tokens in / out (measured) | 3,663 / 2,433 | 3,663 / 3,006 |
| **Estimated** neurons | 596 (from published per-token rates) | 321 (from **unverified** rates) |
| Claims returned / dropped by the Worker as `invalid_value` | 60 / 0 | 39 / 14 |
| Correct labelled facts | 52 | 36 |
| **Missed labelled facts** | **1** | **21** |
| Rejected / unsupported claims | 0 | 0 |
| Facts held for review (safe holds) | 1 | 1 |
| Validated, supported, but differing from the label | 6 (dropped item codes; recovered by the identity step) | 2 |
| Unsupported value accepted as validated (independent audit) | 0 | 0 |
| Unlabelled claims (listed below, not scored) | 1 | 0 |

Where the 8B was clearly better: it kept the item codes on the RFQ (9 of 9 labelled facts correct without any recovery) and it is about five times faster. Where it failed: on the quotations it returned 4 to 7 claims out of 8 to 13 expected, and the Worker dropped 14 claims in total as `invalid_value` (a value that did not fit the profile's value shape; the Worker discards dropped claims, so which fields they were cannot be read back from the saved data). The labelled facts it missed are 8 `specification`, 8 `unit_price`, 3 `item` (all on `quote-c`), and the budget document's `total_project_budget` and `funding_requested`; the 70B missed only the `quote-c` CP-100 `specification`. The 8B repeat on `quote-a` returned **byte-identical claims** (same 6 misses, same 3 drops), so this is systematic, not run-to-run noise. The 70B baseline is also stable (its `quote-a` and RFQ repeats were identical in outcome).

## Strict finding scores (recomputed through the same replay path for both models; coverage `unverified` everywhere)

| Sample | Model | Exact | Missed | False critical | Over-confident | Must-not-flag | Extra (Needs review) | Raw extraction misses | Not evaluated |
|---|---|---|---|---|---|---|---|---|---|
| scopecheck | 70B | 4/4 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| scopecheck | 8B | 3/4 | 1 | 0 | 0 | 0 | 0 | 10 | 7 |
| packcheck | 70B | 3/3 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| packcheck | 8B | 3/3 | 0 | 0 | 0 | 0 | 0 | 2 | 1 |
| scopecheck-layout | 70B | 4/5 | 1 | 0 | 0 | 0 | 0 | 1 | 3 |
| scopecheck-layout | 8B | 2/5 | 3 | 0 | 0 | 0 | 2 | 9 | 6 |

Raw extraction scores (the `Raw extraction misses` column and the per-document table) are separate from recovered identifiers and from downstream findings. For the 70B, five RFQ and quote-b item codes were recovered by the identity step; the raw scores still count those values as differing from their labels.

## Criteria verdict (criteria as committed in `c0d5c90`, before the 8B was run)

| Criterion | 70B baseline | 8B candidate |
|---|---|---|
| G1 no unsupported value accepted as validated | pass | pass |
| G2 zero false critical / over-confident / must-not-flag; no confirmed omission while unverified | pass | pass |
| G3 every request schema-valid within one repair | pass | pass (no repair needed) |
| G4 holds, drops and uncertain identity surface as Needs review / issues; coverage unverified | pass | pass (14 drops surfaced as issues; misses surfaced as Not evaluated) |
| Q1 strict findings no worse than the baseline on each sample | reference (4/4, 3/3, 4/5) | **FAIL**: ScopeCheck 3/4 (missed the CP-100 specification difference on `quote-b`), layout 2/5 (missed the MS-20 quantity difference, the CP-100 specification difference and the uncertain-identity finding); PackCheck equal at 3/3 |
| Q2 missed + rejected/unsupported facts no higher than the baseline's (1) | reference | **FAIL**: 21 missed |

The 8B's failures were **contained**, not silent: 0 false critical findings, the dropped claims appear as extraction issues, and the comparisons that could not run are recorded as Not evaluated. But safe containment is not detection: a difference the model never extracted is a missed finding, and the report counts it as one.

## Decision (R10.2)

**Model: retain `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.** Rule step 1 excludes the 8B (fails Q1 and Q2); step 2 therefore has a single acceptable candidate. The 8B is about 46% cheaper by estimate (321 vs 596 neurons for the eight documents, with unverified 8B rates) and about five times faster, but it would hide the very differences the product exists to find. A cost saving does not offset missing the expected quantity and specification differences. No third model is evaluated at this stage.

Known limitation of the selected model, kept visible: with the 70B the `quote-c` CP-100 specification ("cast iron casing") was **not extracted**, so the expected specification difference on that quotation is a **missed finding** (layout 4 of 5), recorded as Not evaluated (`no specification fact in quote-c`). The identity step and the Needs-review containment do not turn that into a detection. The 70B also drops item codes on some documents (stable on repeat), which the identity step recovers deterministically.

## Supported scope (R10.2: whether to simplify document scope)

Supported means measured, no more:

- Text PDFs (scanned PDFs are rejected), **one chunk per document**, documents of up to about 400 characters (largest measured request: 357 characters, 8 blocks), the measured benchmark envelope.
- ScopeCheck: one RFQ and up to two quotations, laid out either as pipe-separated columns or as free text lines; item codes of the form `AB-123` (hyphen-less codes are treated as description-only).
- PackCheck: the four-document grant pack, South African rand, with the requirements, application form, budget and registration roles.
- Profiles: `scopecheck.rfq.v1`, `scopecheck.quote.v1`, `packcheck.grant.v2` for the application form, `packcheck.grant.v1` for the other PackCheck documents (v2 is unmeasured on those three).
- Findings stay Needs review wherever coverage, identity or a value is uncertain; absences are never confirmed without coverage.

Not validated and not supported yet: multi-chunk or long documents, noisy or scanned layouts, DOCX, other currencies or languages, more than two quotations, and any real (non-fictional) document.

## Production admission

`DAILY_ADMISSION_CEILING` stays **0**. These samples (eight tiny fictional documents, one run each) do not establish a suitable public request ceiling or token caps: per-request neuron use depends on input size, and no document above about 400 characters (single chunk) has been measured. The ceiling is set only after a deployment-time test with realistic document sizes against the deployed Worker and Durable Object.

## Unlabelled claims (reported separately, neither correct nor incorrect)

- 70B `quote-c`: specification `certified to SANS-1200` (validated, visible in its evidence).
- 8B: none.

## Limitations of this comparison

- One run per document per model (the 8B and 70B repeats we have were identical), eight small fictional documents, labels written by the same author.
- **Published pricing is not consumption.** Every neuron figure here is an estimate computed from measured tokens and per-token prices. The 70B prices are published; the 8B prices are unverified (secondary sources). Dashboard-confirmed consumption exists only for the checkpoint-1 aggregate (462.81 neurons, 5 attempts, 70B). A per-model dashboard reading for 2026-11-01 will confirm the rest.
- **Timeout:** these runs used the harness's 45 s timeout (not stored in the result files, recorded here). The Worker is configured for 25 s; integration runs from now on use 25 s (`--timeout-ms`, default 25000, stored in new results). The slowest 70B request was 18.1 s, so none of these requests would have hit 25 s, but the margin is thin.
- The 8B used the profiles tuned and fixed for the 70B (same prompts, by design); the `invalid_value` drops suggest a profile or value-shape change might help it, but that would be a new profile version and a new comparison, which this stage does not run.
- Attempts: 9 for the 8B (8 documents plus one repeat of `quote-a`) of the 16 authorised; no repair was needed or observed. Live repair stays unobserved (controlled offline tests only).

## Second comparison on fresh documents (SC-T15, 2 November 2026)
Same committed criteria, applied to the fresh SC-T12 set with the accepted implementation and byte-identical requests (only the model differed). The 8B passes G1 to G4 and **fails Q1 (3 of 12 findings vs 12 of 12) and Q2 (59 vs 7 missed plus rejected)**. Decision unchanged: **retain the 70B.** Details: `docs/results/sc-t15-second-model.md`.
