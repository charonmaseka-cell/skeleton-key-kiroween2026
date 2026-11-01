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
- Dev-only note: `miniflare` (test tooling) brings 3 high `npm audit` findings (sharp, undici). Not shipped in the Worker.
