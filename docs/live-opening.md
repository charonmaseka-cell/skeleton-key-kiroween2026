# Opening public live analysis (proposal, not applied)

**Status: approved by the owner on 3 November 2026 at 6,000 estimated neurons per UTC day and an attempt ceiling of 80** (changed from the first proposal of 4,000 and 40, after the simulation below). Whole-run admission is deployed together with the opening. The result of opening and of `--verify-open` is recorded in `docs/deployment.md` and `docs/build-log.md`.

## What changes when it is applied
| Setting | Now (production) | Proposed |
|---|---|---|
| `DAILY_NEURON_BUDGET` (estimated neurons per UTC day) | 0 | **6,000** (passed only by `--open-live`) |
| `DAILY_ADMISSION_CEILING` (attempts per UTC day, repairs included; a backstop) | 0 | **80** (passed only by `--open-live`) |
| Per-client limit (`CLIENT_LIMITER`, 6 requests / 60 s per client IP) | **not deployed** (it was commented out) | bound (`[[ratelimits]]` in `wrangler.toml`); it guards opening a run and single requests, not the parts of an admitted run |
| `MAX_BODY_BYTES` / `MAX_CHARS` / `MAX_BLOCKS` / `MAX_BLOCK_CHARS` | 65,536 / 24,000 / 400 / 4,000 (provisional) | 8,192 / 6,000 / 80 / 1,000 (task 5.5, tested on staging) |
| Browser client chunk limits | 24,000 chars / 400 blocks | 4,500 chars / 80 blocks; blocks over 1,000 chars are oversized (a failed part), never sent |
| Pages apps | sample mode, no analysis URL | rebuilt with `VITE_EXTRACTION_API_URL` = the production Worker |
| Access gate, origins, repairs, timeout | public, the two Pages origins, 1, 25 s | unchanged |

`wrangler.toml` stays closed (0 and 0) so a plain `wrangler deploy` can never open analysis; only `deploy.ts --open-live` with `CONFIRM_OPEN_LIVE=6000` does. Running `deploy.ts` without flags closes it again (ceiling 0, budget 0, sample-mode apps).

## Whole-run admission (added; a run is never cut off by the budget)
Before **Analyse** sends any text, the browser sends the run's *plan* to the Worker (`POST /run`): for each part, the schema, the exact size of the request and the number of values expected. No document text. The Worker prices the whole run at its worst case (the exact input bound plus an **enforced output cap**: `max_tokens` = 972 for every part, which covers the chunker's own 14-value design maximum 1.5 times over and the largest recorded answer, 565 tokens, 1.7 times; one attempt per part) and **holds the sum in one transaction**, together with one admission per part. If the day cannot cover it, nothing is held and **nothing is sent**; the person sees, in plain words, how much of today's allowance the run needs and how much is left (for example "about 88% ... about 30% is left ... it was not started and nothing was sent, so it can never stop halfway"). Once held:
- each part's request carries the run reference and draws from its own part of the hold; it can never be refused for budget, only if it is larger than planned or the run has ended (expired after 20 minutes, or closed);
- there is **no automatic repair inside a run** (a repair would need a second, unheld reservation). An unusable answer makes that part "not processed", exactly as a failed part always has; the person's retry is a new run, priced and admitted on its own and covering only the failed parts;
- when the run ends (all parts settled, the browser closes it, or it expires) the hold falls to what was actually charged and the unused attempts return to the day;
- while a run is held, single requests cannot take its budget; at most 3 runs are held at once (a fourth is told to try again in a few minutes);
- a recorded overrun locks the day for *new* runs and single requests, not for a run already held.
Tested: `services/extraction-api/test/run-admission.test.ts` (the planned worst case is a true bound for random real messages including table cells and multi-byte text; a randomised mix of runs and single requests never passes the budget and never refuses an attempt inside a held run; release; expiry; the HTTP routes), `durable-object.test.ts` (the real Durable Object: concurrent runs cannot hold more than the budget; an admitted run survives a restart), `packages/ui/src/whole-run.test.ts` and `apps/scopecheck/src/whole-run.test.tsx` (the plan is first and carries no text; a refusal sends nothing; the progress stages).

**What this costs.** The hold is a worst case, so it is 2.5 to 5 times what the run then uses (the difference is released at the end, and is available to the next run). At 6,000 a day the full-length ScopeCheck set can be admitted **twice** (at 4,000 only once), where the previous scheme admitted it four times and cut a fifth run off after its first request.

## Expected full runs per day (at 6,000 neurons, ceiling 80)
Simulated with the Worker's own ledger code and pricing, the browser client's own chunker on the sample PDFs, and the token usage of real recorded 70B runs (`npx tsx tools/deploy/simulate-runs.ts 6000 --ceiling=80`; method in the header of that file and in `docs/results/run-admission-simulation.md`). Runs one after another; estimates from one recorded run of each kind, not guarantees.

### Daily budget 6,000 estimated neurons

| Run | Parts | Held at admission | Actual per run (est.) | **Full runs per day** | Then | At the earlier ceiling of 40 | Previous scheme: full runs, then |
|---|---|---|---|---|---|---|---|
| ScopeCheck full-length set (tender + 2 quotations) | 12 | 3520.33 | 1382.25 | **2** | refused up front: needs 3520, 3235 left | 2 | 4, then a run is cut off after 1 of 12 requests |
| ScopeCheck small set (RFQ + 2 quotations) | 3 | 838.25 | 304.93 | **17** | refused up front: needs 838, 816 left | 13 | 18, then a run is cut off after 2 of 3 requests |
| PackCheck pack (4 documents) | 4 | 1194.37 | 230.2 | **20** | refused up front: attempts | 10 | 20, then none (refused at the first request) |


"Held at admission" is what a run needs available to start; "Actual per run" is what it then costs and what the next run can use. With a budget of 6,000 the full-length set fits twice (the third would need 3,520 and 3,235 would be left, so it is refused up front); the small set 17 times; PackCheck 20 times, where the attempt ceiling of 80 ends the day, not the budget. The cap check passed on all three kinds. For comparison: 4,000 and 40 gave 1, 11 and 10.

## Risks and what holds them
- **Budget and attempts** are enforced in one Durable Object transaction before every attempt; a refusal writes nothing. A recorded overrun locks the day.
- **Held budget.** A held run counts its whole hold against the day until it ends, so an abandoned run (the tab closed) keeps its hold for up to 20 minutes; at most 3 runs are held at once, and each browser asks for one run per Analyse. Anyone can still start runs from the allowed origins, so the daily budget is what bounds cost, as before.
- **The estimate is not consumption.** Two dashboard comparisons agree with the published rates (462.81 vs 462.76; 321.65 vs 321.655). 6,000 of the free 10,000 leaves 4,000 for error and other use; that is a thinner margin than the first proposal's 6,000, and the account's daily total is the only thing that shows real consumption, so the dashboard is compared after the first live runs.
- **Per-client limit** is per location and eventually consistent; it slows one client, it is not a quota. The global controls do not depend on it.
- **No authentication.** The origin allowlist is not authentication; anyone can call the Worker from those origins. The daily budget is what bounds cost.

## Dry run (2026-11-03, at the approved values; nothing deployed by it)
```
wrangler deploy --dry-run --var ALLOWED_ORIGINS:https://skeleton-key-scopecheck.pages.dev,https://skeleton-key-packcheck.pages.dev --var DAILY_ADMISSION_CEILING:80 --var DAILY_NEURON_BUDGET:6000
env.ADMISSION (AdmissionCounter)            Durable Object
env.AI                                      AI
env.CLIENT_LIMITER (6 requests/60s)         Rate Limit
env.ALLOWED_ORIGINS ("(hidden)")            Environment Variable
env.ACCESS_GATE ("public")                  Environment Variable
env.MAX_BODY_BYTES ("8192")                 Environment Variable
env.MAX_CHARS ("6000")                      Environment Variable
env.MAX_BLOCKS ("80")                       Environment Variable
env.MAX_BLOCK_CHARS ("1000")                Environment Variable
env.MAX_REPAIR_ATTEMPTS ("1")               Environment Variable
env.INFERENCE_TIMEOUT_MS ("25000")          Environment Variable
env.DAILY_ADMISSION_CEILING ("(hidden)")    Environment Variable   <- 80, from --var
env.DAILY_NEURON_BUDGET ("(hidden)")        Environment Variable   <- 6000, from --var
```
Wrangler hides command-line values; the arguments line shows them.

## Applying it (after approval)
1. Merge this PR (CI green).
2. `WORKER_URL=https://skeleton-key-extraction.teddykgroup.workers.dev CONFIRM_OPEN_LIVE=6000 npx tsx tools/deploy/deploy.ts --open-live`
3. `WORKER_URL=... npx tsx tools/deploy/deploy.ts --verify-open` (no inference: health shows open with 80 / 6,000; a malformed request from a Pages origin is refused before admission, for `/extract` and for `/run`; another origin is refused).
4. The first live analysis by a person is the first real inference; record the dashboard before and after.
