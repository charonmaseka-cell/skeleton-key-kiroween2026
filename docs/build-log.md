# Build log

Factual record of Kiro tasks, tests and decisions. Only completed work is recorded.

## Task 1: Monorepo scaffold (1 Nov 2026)
- Created npm workspaces, shared TypeScript/ESLint/Vitest config, minimal engine and UI packages, two app shells, placeholder Worker and benchmark packages, CI workflow.
- Engine boundary test and ESLint restriction added (R1.3).
- Check results are in the pull request description.

## Task 2: Engine core (1 Nov 2026)
- Added in `packages/engine`: evidence validation with original-text offsets, value-support checks (amount, date, quantity, name, text), fact corrections with provenance, processing-vs-coverage tracking, matcher, finding identity/fingerprints, review reopening, export model, adapter interface.
- 50 Vitest tests passing locally (incl. property tests). Mutation check: disabling the coverage gate made the "extraction succeeds but misses a line" test fail.
- Not done: Worker, PDF parsing, samples, benchmark, app rules (later tasks).

## Task 3: Extraction Worker (1 Nov 2026)
- `services/extraction-api`: server-controlled profiles, strict request validation on actual bytes, origin allowlist and preflight, SQLite Durable Object admission counter (every attempt admitted first, no refund, fail closed), distinct error codes, content-free logs. Model is mocked; nothing was deployed and no live model call was made.
- Durable Object tested in the local Workers runtime (workerd via Miniflare): concurrency (60 parallel requests, ceiling 10 -> exactly 10 admitted, 10 model calls), restart persistence, 00:00 UTC rollover, error/timeout non-refund, no document text on disk. Handler: 38 tests. Total repository tests: 94 passing.
- Mutation check: changing the ceiling comparison made 4 tests fail.
- Decision: `DAILY_ADMISSION_CEILING` is `0` (closed) until the benchmark measures neurons per call. The Rate Limiting binding stays optional/unverified.
- Dependency audit: `miniflare` (test tooling) pinned `undici@7.28.0` and `sharp@0.35.2` (3 high). Root `overrides` now use patched same-major releases `undici@7.30.1` and `sharp@0.35.5`; 0 high remain; DO tests still pass (`npm ci` verified). `npm audit fix` offered only downgrades, so it was not used.
- Remaining (11 moderate, development tooling only, not deployed): `minimatch <11.0.1` GHSA-g3hv-75wg-m249 (glob DoS) reached through `eslint@10.14.0` (latest) and `typescript-eslint@8.72.1`, which require `minimatch ^10`; the fix is a major version they do not support. All other moderate entries (`@eslint/*`, `@typescript-eslint/*`, `eslint`, `typescript-eslint`) are the same chain. Revisit when ESLint releases a patched dependency.

## Task 4: Samples and benchmark harness (1 Nov 2026)
- Dependency audit before merging PR #3: overrides patched `undici`/`sharp` (0 high); 11 moderate remain in the ESLint chain (see Task 3 entry).
- Added fictional labelled samples (ScopeCheck: RFQ + 2 quotes; PackCheck: 4-document grant pack), `packages/ingest` (PDF.js text blocks with page and coordinates; scans rejected), engine `chunkBlocks` and extraction issues, Worker `droppedReasons`, and `tools/benchmark` (harness, scoring, benchmark-local checks, CLI).
- **MOCK results only so far** (oracle model built from the labels; says nothing about model quality): 7 documents, recall 100%, 0 false critical findings, absences stay Needs review with coverage unverified. 119 repository tests pass; two mutation checks (auto-coverage, silent server drops) each made tests fail.
- Live results (one model, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, REST API from the sandbox; 11 inference attempts on 2026-11-01, 0 repairs observed live, `DAILY_ADMISSION_CEILING` stays `0`):
  - Extraction (fictional documents, hand-written labels): every request schema-valid; evidence located 100%; no unsupported value accepted as validated. Measured, not claimed: item codes dropped by the model on the RFQ and `quote-b` (stable on repeat); "R1.6 million" returned as 1.6 with `packcheck.grant.v1` (held by validation) and as 1600000 ZAR with the new `packcheck.grant.v2`; one specification missed and one exclusion shortened on the free-text `quote-c`.
  - Findings (strict scoring, coverage `unverified`): ScopeCheck 4/4 expected after the shared item-identity resolver (1/4 before); PackCheck 3/3 with the funding comparison actually evaluated and no funding finding; `scopecheck-layout` (no pipe delimiters, pre-registered) 4/5, the miss being an extraction miss recorded Not evaluated.
  - Usage: dashboard-confirmed aggregate 462.81 neurons after 5 attempts (estimate 462.76). Later usage is an estimate from measured tokens (~869 neurons after 11 attempts) pending the next dashboard reading. No request count has been seen on the dashboard.
  - Item identity: one resolver, `apps/scopecheck/src/adapter/identity.ts`, used by the benchmark and by the future ScopeCheck adapter.
  - Requirement added: rejected critical fields enter the Needs-review queue; dependent comparisons are **Not evaluated** (R4.9, R7.6; review interface and exports in task 6.5).
- **Second candidate and decision (tasks 5.3, 5.4; full record in `docs/model-comparison.md`).** Criteria were committed before the run (`c0d5c90`). `@cf/meta/llama-3.1-8b-instruct` was run once on each of the eight documents (plus one repeat of `quote-a`, identical), same profiles, chunks, limits, labels, validators and identity resolver; model choice lives only in `tools/benchmark/src/candidates.ts` and is applied below the Worker handler (clients still cannot send a model). 9 attempts, 0 repairs, all schema-valid, 0 unsupported values accepted, 0 false critical findings. But: 21 missed labelled facts vs 1 for the 70B (14 claims dropped by the Worker as `invalid_value`), strict findings ScopeCheck 3/4 (70B 4/4), layout 2/5 (70B 4/5), PackCheck 3/3 (equal). Cost/speed: ~321 vs ~596 estimated neurons (8B rates unverified) and 14.8 s vs 74.1 s total request time. **Decision: retain `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.** Known limitation kept visible: the 70B missed the `quote-c` CP-100 specification, a missed finding that safe containment does not turn into a detection.
- **Supported scope:** text PDFs, one chunk per document, small documents (about 0.4k characters measured), the three ScopeCheck documents and the four-document PackCheck pack, the profiles in `docs/handoff-task-6.md`. Larger, multi-chunk, scanned, DOCX, other-currency and real documents are not validated.
- **Production admission stays at 0.** Eight tiny documents do not establish a public request ceiling, `MAX_CHARS`, `MAX_BLOCKS` or token caps; they are set only after a deployment-time test at realistic sizes.
- Cumulative today (this sandbox's ledger): 20 inference attempts; ~1,250 neurons ESTIMATED (about 462.8 of that confirmed by the dashboard at checkpoint 1; the 8B share uses unverified rates). Dashboard checkpoint 2 (per model) pending.
- Still pending (deployment checks): Workers AI binding path and deployed Durable Object admission validation; live repair remains unobserved (controlled offline tests only).
