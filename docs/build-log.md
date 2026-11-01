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
- Not yet done: live results. Pending Cloudflare credentials in sandbox secrets. `DAILY_ADMISSION_CEILING` stays `0` in `wrangler.toml`.
