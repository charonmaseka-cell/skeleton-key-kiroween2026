# Bounded concurrency: design and measurement plan

**Status: built and tested offline only. It has not been run against the model.** No live call was made for it, the 3 remaining attempts of the earlier authorisation are untouched, and production `DAILY_ADMISSION_CEILING` is 0. Concurrency is OFF by default everywhere (one request at a time). Any live measurement needs a NEW authorisation (attempts, neurons, concurrency level); none exists.

## What it is
Up to 2 or 3 requests in flight for one document (hard ceiling 3). Benchmark: `--concurrency N` (1 to 3) and `--max-repairs 0|1`. Browser client: `ClientConfig.concurrency` (1 to 3, default 1; the app does not set it).

## Safety properties (each has a test in `tools/benchmark/test/concurrency.test.ts` or `packages/ui/src/extraction-client.test.ts`)
1. **In-flight bound.** Never more than the requested number (capped at 3) in flight.
2. **Atomic budget claims.** Just before a request is dispatched, in the same synchronous step as the check, its first-attempt worst case is CLAIMED (`NeuronBudget.claim`). Claims count against the run cap and the daily cap exactly like charges, so requests dispatched together cannot all be admitted on headroom that fits only some of them. The request's own reservation replaces its claim; an unused claim is released. A repair has no claim and is checked on its own against everything charged or claimed. If a cap cannot cover a request the pool waits for an in-flight request to finish (its measured charge replaces its reservation) and only records the chunk as not sent when nothing is in flight.
3. **Bounded attempts and repairs.** A request is dispatched only if attempts used + the worst case of every request in flight (1 + repairs each) + its own first attempt fit the allowance. So even if every in-flight request repairs, the allowance is not passed. Attempts are counted per request (each admission it was granted), not as differences of a shared counter that overlapping requests would corrupt.
4. **Safe stop.** After a stopping service error (daily allowance, quota, rate limit, service unavailable, access) nothing new is dispatched; requests already in flight finish and are recorded and charged (a request cannot be cancelled inside the Worker). Remaining chunks are recorded `stopped_after_<code>` and the document is processing-incomplete. A neuron cap reached by an overrun stops dispatch the same way.
5. **Calls that outlive the timeout.** A model call can still finish after the Worker has given up. It stays in the ledger as outstanding with its reservation standing; when it settles, its reported usage is charged. The CLI waits (at most 35 s) before writing the ledger and warns if any call is still outstanding.
6. **Deterministic result.** Outcomes are written in chunk order whatever order requests finish in; the output equals the sequential run (tested with reversed finishing order). Each request records its start and end, and the summary records the peak actually in flight and the wall-clock elapsed time, so overlap is measured, not assumed.
7. **Browser client:** the session call limit is taken in the same synchronous step as the stop check, so concurrent chunks cannot pass it; a failed chunk is still never covered.

## Known limits
- A repair consumes the next unused claim of another in-flight request; that request is then checked on its own, which is safe (caps are never passed) but can refuse a request that would have fit. Concurrency does not remove the 25 s timeout: if the service slows under concurrent load, more requests may time out. That is exactly what a live measurement would need to show.
- Concurrency is per document; documents run one after another.
- It cannot lower the cost in attempts or neurons; it can only shorten elapsed time. The earlier baseline took 322 s of request time sequentially; whether 2 or 3 in flight shortens that, without more timeouts or rate limits, is NOT known.

## Proposed measurement (needs your authorisation; not started)
Re-run the unchanged ScopeCheck baseline (RFQ, quotation A, quotation B; 21 requests, same frozen plan) at concurrency 1 (reference, if a same-day reference is wanted), 2 and 3, with `--max-repairs 1`. Cost per full run: about 21 attempts and about 2,900 estimated neurons (measured 2,906 for the sequential baseline). Report per level: elapsed wall-clock time against the sum of request latencies, peak in flight, timeouts, rate-limit or quota errors, repairs, tokens (measured) and neurons (estimated), and whether findings and extraction scores are unchanged. Stop at the first rate-limit or quota error. A cheaper first step: one document (RFQ, 6 requests) at concurrency 2 and 3.

## Cost
No paid-plan change is made or implied. Concurrency does not require one in principle, but a higher request rate may meet the free plan's limits; if it does, that is a result to report, and any paid plan needs your approval first.
