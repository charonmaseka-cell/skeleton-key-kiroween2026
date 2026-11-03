# Opening public live analysis (proposal, not applied)

**Status: prepared for approval. Production is closed** (ceiling 0, budget 0). Nothing here has been deployed.

## What changes when it is applied
| Setting | Now (production) | Proposed |
|---|---|---|
| `DAILY_NEURON_BUDGET` (estimated neurons per UTC day) | 0 | **4,000** (passed only by `--open-live`) |
| `DAILY_ADMISSION_CEILING` (attempts per UTC day, repairs included; a backstop) | 0 | **40** (passed only by `--open-live`) |
| Per-client limit (`CLIENT_LIMITER`, 6 requests / 60 s per client IP) | **not deployed** (it was commented out) | bound (`[[ratelimits]]` in `wrangler.toml`) |
| `MAX_BODY_BYTES` / `MAX_CHARS` / `MAX_BLOCKS` / `MAX_BLOCK_CHARS` | 65,536 / 24,000 / 400 / 4,000 (provisional) | 8,192 / 6,000 / 80 / 1,000 (task 5.5, tested on staging) |
| Browser client chunk limits | 24,000 chars / 400 blocks | 4,500 chars / 80 blocks; blocks over 1,000 chars are oversized (a failed part), never sent |
| Pages apps | sample mode, no analysis URL | rebuilt with `VITE_EXTRACTION_API_URL` = the production Worker |
| Access gate, origins, repairs, timeout | public, the two Pages origins, 1, 25 s | unchanged |

`wrangler.toml` stays closed (0 and 0) so a plain `wrangler deploy` can never open analysis; only `deploy.ts --open-live` with `CONFIRM_OPEN_LIVE=4000` does. Running `deploy.ts` without flags closes it again (ceiling 0, budget 0, sample-mode apps).

## Expected full runs per day (at 4,000)
Simulated with the Worker's own ledger code (`services/extraction-api/src/admission.ts`: reserve the worst case before each attempt, settle from reported tokens after it), the published neuron rates and the recorded token usage of real 70B runs, one run after another, concurrency 1, no repairs.

| Run | Requests | Estimated charge per run (x1.1 margin) | Largest reservation | Full runs per day | Then |
|---|---|---|---|---|---|
| ScopeCheck full-length set (tender + 2 quotations, SC-T12) | 12 | 1,382 | 446 | **2** | a third run gets 8 of 12 requests, then `daily_limit` (its documents show "not fully processed") |
| ScopeCheck small set (RFQ + 2 quotations) | 3 | 305 | 406 | **12** | refused at the 37th request (budget) |
| PackCheck pack (4 documents) | 4 | 230 | 358 | **10** with ceiling 40 (16 without) | the attempt ceiling stops it first |

Real documents of other sizes will differ; these are **estimates from one recorded run of each**, not guarantees. A repair adds an attempt (and its reservation); a call that times out keeps its whole reservation. With the ceiling at 40, small PackCheck packs are limited by attempts, not neurons; raising the ceiling to 64 would let the budget decide in every case above.

The worst case of one attempt is about 651 estimated neurons at the proposed limits (it would be about 2,333 at the current 65,536-byte limit, so the limits matter for the bound).

## Risks and what holds them
- **Budget and attempts** are enforced in one Durable Object transaction before every attempt; a refusal writes nothing. A recorded overrun locks the day.
- **The estimate is not consumption.** Two dashboard comparisons agree with the published rates (462.81 vs 462.76; 321.65 vs 321.655). 4,000 of the free 10,000 leaves room for error and other use.
- **Per-client limit** is per location and eventually consistent; it slows one client, it is not a quota. The global controls do not depend on it.
- **No authentication.** The origin allowlist is not authentication; anyone can call the Worker from those origins. The daily budget is what bounds cost.

## Dry run (2026-11-03, nothing deployed)
```
wrangler deploy --dry-run --var ALLOWED_ORIGINS:https://skeleton-key-scopecheck.pages.dev,https://skeleton-key-packcheck.pages.dev --var DAILY_ADMISSION_CEILING:40 --var DAILY_NEURON_BUDGET:4000
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
env.DAILY_ADMISSION_CEILING ("(hidden)")    Environment Variable   <- 40, from --var
env.DAILY_NEURON_BUDGET ("(hidden)")        Environment Variable   <- 4000, from --var
```
Wrangler hides command-line values; the arguments line shows them.

## Applying it (after approval)
1. Merge this PR (CI green).
2. `WORKER_URL=https://skeleton-key-extraction.teddykgroup.workers.dev CONFIRM_OPEN_LIVE=4000 npx tsx tools/deploy/deploy.ts --open-live`
3. `WORKER_URL=... npx tsx tools/deploy/deploy.ts --verify-open` (no inference: health shows open with 40 / 4,000; a malformed request from a Pages origin is refused before admission; another origin is refused).
4. The first live analysis by a person is the first real inference; record the dashboard before and after.
