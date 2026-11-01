# Handoff to Task 6 (minimal app shells on labelled fixtures)

Everything here is measured or committed; nothing is a promise. Benchmark record: `docs/model-comparison.md`, `docs/build-log.md`, `samples/benchmark-results/`.

## 1. Selected configuration

| Item | Value |
|---|---|
| Model | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (retained; the 8B candidate failed the quality bar). Set only by `MODEL` in `services/extraction-api/src/profiles.ts`. |
| Model override | None for clients (request schema rejects `model`; test exists). The benchmark alone can substitute a model, below the handler, in `tools/benchmark/src/candidates.ts`. |
| ScopeCheck profiles | `scopecheck.rfq.v1` (RFQ), `scopecheck.quote.v1` (each quotation) |
| PackCheck profiles | `packcheck.grant.v2` for the **application form** (fixes "R1.6 million" read as 1.6). `packcheck.grant.v1` was measured for requirements, budget and registration; v2 is **unmeasured** on those three. Pick the profile by document role until a v2 check says otherwise. |
| Profile policy | Published versions are frozen (hash test in `services/extraction-api/test/profiles.test.ts`); a behaviour change is a new ID. Record the profile version with every result. |
| Repairs | At most one counted repair per chunk (`MAX_REPAIR_ATTEMPTS=1`). Only verified offline; unobserved live. |
| Timeout | Worker config `INFERENCE_TIMEOUT_MS=25000`. The benchmark ran with 45000. The slowest 70B request was 18,129 ms (`quote-a`), so there is little margin: re-measure on the deployed Worker, and show the `timeout` error recoverably. |
| Production admission | `DAILY_ADMISSION_CEILING = "0"`. Not derived: eight tiny documents do not support a ceiling, `MAX_CHARS`, `MAX_BLOCKS` or token caps. |
| Coverage | Always `unverified` after extraction; absences stay Needs review until a person confirms coverage. |

## 2. Supported scope for the first app shells

Text PDFs, one chunk per document, small documents (largest sample about 0.4k characters, 9 blocks), item codes shaped `AB-123`, South African rand. ScopeCheck: one RFQ and up to two quotations, pipe-column or free-text lines. PackCheck: requirements, application form, budget, registration. Unsupported and unvalidated: long or multi-chunk documents, scans (rejected), DOCX, other currencies or languages, hyphen-less item codes (treated as description-only), more than two quotations, any real document.

## 3. Fixtures to build on

| Fixture | Location | Expected outcome (selected configuration, strict scoring) |
|---|---|---|
| ScopeCheck: RFQ, `quote-a`, `quote-b` | `samples/scopecheck/` (PDFs, `sample.json`) | 4 of 4: quantity difference (CP-100, quote-a), specification difference (CP-100, quote-b), exclusion (quote-a), PG-6 absence in quote-b as **Needs review** |
| PackCheck: 4-document pack | `samples/packcheck/` | 3 of 3: organisation name differs (confirmed), tax clearance certificate missing (Needs review), ambiguous start date (Needs review); **no** funding finding (R1.6m vs R2m). 10 comparisons: 7 agree, 2 flagged, 1 Not evaluated (start date) |
| Layout variant: RFQ + `quote-c` | `samples/scopecheck-layout/` (pre-registered, `aa6adca`) | 4 of 5: MS-20 quantity difference, exclusion, PG-6 identity uncertain (Needs review), PG-6 absence Needs review. **Known miss:** CP-100 specification difference (the model never extracted the specification); the ledger shows it as Not evaluated. A golden test should assert this known limitation, not hide it. |

Saved selected-configuration responses (deterministic inputs for fixtures, no model call): the eight 70B files `live-repeat-rfq`, `live-repeat-quote-a`, `live-quote-b`, `live-layout-quote-c`, `live-packcheck-requirements`, `live-packcheck-application-form-v2`, `live-packcheck-budget`, `live-packcheck-registration` in `samples/benchmark-results/`. Each stores `claimsReturned` (raw claims), the profile used, and per-claim validation outcomes. Replay: `npx tsx tools/benchmark/src/cli.ts --mode replay --sample <id> --from <files>`; model-comparison script: `tools/benchmark/src/compare-models.ts`. Label every fixture page "Sample (fictional)".

## 4. What to promote into the apps (do not copy, move)

1. **Item identity (already shared):** `apps/scopecheck/src/adapter/identity.ts`, `resolveItemIdentities`, `descriptionOverlap`, tests beside it. The ScopeCheck adapter imports it; the benchmark already does.
2. **ScopeCheck rules and matching:** `scopeMatches`, `evaluateScope`, `itemIdentityKey` in `tools/benchmark/src/checks.ts` become the ScopeCheck adapter (`apps/scopecheck`). Keep the rule that description-only or uncertain items can only be a lexical **suggestion**, never a verified match.
3. **PackCheck rules and matching:** `packMatches`, `evaluatePack` become the PackCheck adapter (`apps/packcheck`). The `HINTS` map in `tools/benchmark/src/samples.ts` is adapter data (field labels).
4. **Comparison ledger:** the `Comparison` type (`agree` / `flagged` / `not_evaluated` with reason) is domain-neutral; it belongs in the engine export model so both apps and the exports share it (R4.9, R7.6, task 6.5).
5. **Stays in `tools/benchmark`:** replay transport, comparison script, candidates configuration, scoring.

## 5. Task 6 acceptance (derived from the spec and this benchmark)

- 6.2/6.3: both adapters reproduce the table in section 3 from the saved responses with zero false critical findings (R10.5) and absences Needs review while coverage is unverified.
- 6.4: golden fixture tests include the known `quote-c` miss, the ambiguous date as Not evaluated, and the funding pair not flagged with the comparison shown as having run.
- 6.5 (R4.9, R7.6): a rejected or held critical field appears as a Needs-review item; dependent comparisons show **Not evaluated** with reason and blocked input in their own section of the review panel and every export; never rendered as "agrees".
- The UI never claims complete coverage after a successful request (R10.10), and states that extracted text leaves the device for AI processing (R8.3).

## 6. Open items carried into Task 6

- Confirm `packcheck.grant.v2` on requirements, budget and registration (at most 3 attempts) before collapsing PackCheck to one profile.
- Measure realistic-size documents and the deployed Worker (binding path, Durable Object admission, 25 s timeout) before any ceiling or caps are set. These are deployment checks.
- Dashboard checkpoint 2 and a per-model reading for the 8B (verifies its unverified neuron rates).
- Live repair is unobserved.
- Remaining dependency audit items: 11 moderate, development tooling only.
