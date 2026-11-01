# Model comparison and decision (spec tasks 5.3 and 5.4)

Status: **criteria written and committed BEFORE any run of the second candidate.** Results and the decision are appended below the line at the end of the file after the run.

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

The supported scope is limited to what was measured: text PDFs, one chunk per document, small documents (the largest sample is about 0.4k characters and 9 blocks), the four profiles above. Anything beyond that is unvalidated. These samples do not establish a public request ceiling; production admission stays at 0.

---
# Results and decision

(To be completed after the run.)
