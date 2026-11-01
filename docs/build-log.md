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
