# Proposal: open production live analysis at 4,000 neurons/day (NOT APPLIED)

Status: prepared 3 November 2026, awaiting owner approval. Nothing deployed; production still has ceiling 0, budget 0, and both Pages apps built with analysis disabled.

## Dry-run config (`services/extraction-api/wrangler.open.toml`, `wrangler deploy --dry-run`, nothing uploaded)
| Binding / variable | Now (production) | Proposed |
|---|---|---|
| `DAILY_NEURON_BUDGET` | 0 | **4000** (estimated neurons per UTC day; hard cap in code is 10,000) |
| `DAILY_ADMISSION_CEILING` | 0 | **40** attempts per UTC day (backstop from docs/neuron-budget.md; must be non-zero to admit anything) |
| `CLIENT_LIMITER` (ratelimit, namespace 1001) | not bound (commented out) | **6 requests per 60 s per `cf-connecting-ip`** (the existing block, uncommented) |
| `ALLOWED_ORIGINS` | the two Pages origins (set by deploy script) | unchanged |
| `ACCESS_GATE` | public | unchanged |
| `MAX_BODY_BYTES` / `MAX_CHARS` / `MAX_BLOCKS` / `MAX_BLOCK_CHARS` | 65536 / 24000 / 400 / 4000 | unchanged (see decision 2) |
| `MAX_REPAIR_ATTEMPTS`, `INFERENCE_TIMEOUT_MS` | 1, 25000 | unchanged |

## Expected full runs per day (estimates, not guarantees; published rates, 1.1 margin, not dashboard-confirmed)
Measured charges: ScopeCheck full-length baseline (RFQ + quotation A + quotation B, 21 chunks, 22 attempts): **2,906** (sc-t4 baseline). ScopeCheck fresh set (12 chunks): **1,382.1** for the 12 answered calls (sc-t12-fresh). PackCheck v2, four documents: about **209** before margin, about **230** with it.
| Full run | Charge | Complete runs in 4,000 | Then |
|---|---|---|---|
| ScopeCheck, full-length baseline set | ~2,906 | **1** | a second run is refused partway (about 6 of 21 chunks, see below) |
| ScopeCheck, fresh set | ~1,382 | **2** | a third gets about 8 of 12 chunks |
| PackCheck, 4 documents | ~230 | **about 17** | |
The budget admits an attempt only if charged + that attempt's worst-case reservation (about 364 for a typical chunk) fits, so the last ~364 of the 4,000 are not usable for the final attempt. A timed-out or unanswered attempt keeps its worst-case reservation, so a bad day gives fewer runs. The 40-attempt ceiling does not bind first for ScopeCheck (21 and 12 attempts per run).

## Decisions and risks you should see before approving
1. **The apps must also be rebuilt and redeployed with the Worker URL** (`VITE_EXTRACTION_API_URL`). They are deliberately built with it empty. The Worker change alone opens nothing visible.
2. **Input limits are still the provisional 65,536 / 24,000.** The 630.8-neuron worst-case reservation in docs/neuron-budget.md assumes 8,192 bytes. At 65,536 bytes one request can reserve about 2,262 of the 4,000. I have not changed the limits (not asked, and I have not checked every real chunk against 8,192). Recommended: adopt the task 5.5 limits (8192 / 6000 / 80 / 1000) in the same step if the app chunks fit.
3. **`tools/deploy/deploy.ts` hard-codes ceiling 0 and budget 0** on every Worker deploy, so a routine redeploy would close analysis again. Applying needs a deliberate, separate command (or a script change you approve).
4. **The per-client limit is per location and eventually consistent, and one IP can still use the whole budget:** 6 per minute for about 11 minutes drains 4,000. It slows abuse; the budget is the real cap. I have not confirmed the ratelimit binding is available on your plan (the toml says to confirm first); the Worker treats a limiter error as "allow".
5. A recorded overrun locks the UTC day (by design).

## To apply (after approval, not before)
`cd services/extraction-api && npx wrangler deploy -c wrangler.open.toml`, then rebuild both apps with `VITE_EXTRACTION_API_URL=<worker url>` and redeploy Pages, then `WORKER_URL=... npx tsx tools/deploy/deploy.ts --verify-only` (its checks expect a closed Worker, so it will need updating for an open one).
