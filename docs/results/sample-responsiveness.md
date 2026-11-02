# Sample responsiveness (separate from live processing)

Sample mode keeps the extraction **cached** (source blocks and recorded claims in `samples/fixtures`) and **executes the checks afresh** on every evaluation: claim validation, item identity, matching, rules, comparison ledger, review state, export model. Tests: the fixtures hold no findings; two evaluations give distinct results; changing one cached claim changes the findings (`apps/scopecheck/src/sample-default.test.ts`, `tools/benchmark/test/fixtures.test.ts`).

Measured with `npx tsx tools/benchmark/src/sample-responsiveness.ts --write docs/results/sample-responsiveness.json` in Node on this sandbox (100 warm runs after one cold run; computation only, no rendering, not a browser):

| Case | Docs | Blocks | Claims | Findings | First run | Warm median | Warm p95 |
|---|---|---|---|---|---|---|---|
| ScopeCheck standard sample | 3 | 12 | 30 | 4 | 20.7 ms | 1.1 ms | 2.4 ms |
| ScopeCheck free-text sample | 2 | 9 | 22 | 4 | 2.0 ms | 0.7 ms | 1.4 ms |
| PackCheck sample pack | 4 | 20 | 17 | 3 | 3.3 ms | 0.5 ms | 0.9 ms |
| Full-length ScopeCheck, saved responses (same code path) | 3 | 232 | 239 | 20 | 12.6 ms | 7.0 ms | 10.4 ms |

Reading: re-running every check on a cached extraction takes milliseconds, even for the full-length documents. Browser parse time, rendering and device speed are NOT included and were not measured.

**Live processing is a different thing**: it is dominated by model requests. The only measured live run (three 3-page documents, sequential requests) took 322 s of request time (5 min 22 s with one timeout and its retry). Do not read the sample figures as a statement about live uploads, and do not read the live figure as a promise.

The bundled fictional samples remain the labelled default. The upload panel states the live limits in numbers.
