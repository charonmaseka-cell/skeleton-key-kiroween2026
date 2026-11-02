# Task 5.5 (offline): proposed limits and a gated binding test plan

Status: **PROPOSAL, 2 November 2026. Nothing here is applied.** Production stays at release `0c5d339`, `DAILY_ADMISSION_CEILING=0`. No inference was made to write this; every figure comes from the saved results cited. Task 5.5 and the inference-through-binding validation stay **open**.

## 1. What the evidence supports

| Quantity | Value | Source | Kind |
|---|---|---|---|
| Realistic set | 3 documents, 21 chunks (6 + 8 + 7) | `samples/scopecheck-realistic/chunk-plan.json` | fixed plan |
| Largest chunk | 3,471 chars, 48 blocks (incl. context) | same | measured input |
| Whole document | 5,463 to 6,934 chars, 68 to 93 blocks | same | measured input |
| Attempts for the set | 22 (21 chunks + 1 timeout retry), 0 repairs | `results/sc-t4-scopecheck-baseline.md` | measured |
| Tokens for the set | 14,235 prompt, 11,047 completion (about 647 in / 502 out per attempt) | same | measured (model-reported) |
| Neurons for the set | about 2,906 estimated, about 132 per attempt | same | **estimate** (published rates x 1.1), not dashboard-confirmed |
| Fresh set | 12 answered calls, provider-reported 1,256.6 neurons (about 105 per call) | `results/sc-t12-fresh-results.md` | provider figure, not dashboard-confirmed |
| Latency per attempt | typically 11 to 20 s, one 25 s timeout (cap is 25 s) | baseline | measured, n = 22 |
| Request time for 3 documents | 297 to 322 s sequential | baseline | one run |
| Worst-case reservation per attempt | 363.6 neurons | `tools/benchmark/src/budget.ts` | calculated bound |

Gaps that block a public ceiling: neuron consumption has never been read from the Cloudflare dashboard (only estimated); the binding path in the deployed Worker has never been exercised (the benchmark ran through the same handler logic but not the deployed binding and Durable Object); latency in the deployed Worker is unmeasured; n is one run per document.

## 2. Proposed limits (to apply only after section 4 passes)

Rule: choose limits from what was measured, with stated headroom, never from the code defaults.

| Setting | Current | Proposed | Basis |
|---|---|---|---|
| `DAILY_ADMISSION_CEILING` (attempts per UTC day, repairs included) | 0 | **36** | See the budget below. Applies to the whole service, not per user |
| `MAX_CHARS` (per request) | 24000 | **6000** | Largest measured chunk is 3,471 chars; about 1.7x headroom. The client's output-aware chunker already caps chunks well below this |
| `MAX_BLOCKS` | 400 | **80** | Largest chunk 48 blocks; about 1.7x |
| `MAX_BLOCK_CHARS` | 4000 | **keep 4000 until the longest block in the realistic set is read from the fixtures** (not checked offline here); then set about 2x that | not measured in this plan |
| `MAX_BODY_BYTES` | 65536 | **32768** | 6000 chars of JSON blocks with ids stays well under this; confirm with a test |
| `MAX_REPAIR_ATTEMPTS` | 1 | 1 | 0 repairs in 22 baseline attempts, but the schema gate G3 needs the single repair |
| `INFERENCE_TIMEOUT_MS` | 25000 | 25000 | 1 of 22 attempts timed out and succeeded on retry (13.6 s). Do not raise without measuring |
| Profile `maxOutputTokens` | 1500 / 1200 | unchanged | the baseline averaged about 502 completion tokens; the cap is a safety bound |

### Ceiling budget (current free plan, no paid upgrade)
- Free daily allocation is **10,000 neurons per day** (Cloudflare's published Workers AI free tier; **confirm in the dashboard** before relying on it).
- Proposed public share: **about 5,000 neurons per day**; the other half is reserved for owner testing and for the estimate error, because no dashboard figure exists yet.
- At about 132 neurons per attempt (baseline average, estimated) a ceiling of 36 is about 4,750 neurons, and about 5,400 at 150 per attempt. One full three-document session is about 22 attempts, so **the ceiling allows roughly one full session per day**, or several shorter ones. That is a small free-tier service and the interface must say so (the upload panel already states live limits in numbers).
- If every attempt hit the worst-case reservation (363.6) the ceiling would be 13,090 neurons, above the allocation. On the free plan the allocation then fails safe (the Worker maps the provider's neuron/quota error to `quota_exhausted`, see `src/inference.ts`), so there is no overage charge; the cost is lost availability, not money.
- **Adjust rule:** after the section 4 test, if the dashboard figure for N attempts is within +/-25% of the estimate, keep 36. If dashboard consumption per attempt is higher by more than 25%, set the ceiling to `floor(5000 / measured neurons per attempt)`. If lower, leave 36 (do not raise on one measurement).
- The ceiling counts attempts, not neurons, and is global (one Durable Object). It is not per-client; the optional `CLIENT_LIMITER` is eventually consistent and is not relied on.

## 3. Gate design: how to test without opening public admission

Problem: the Worker has no authentication. `ALLOWED_ORIGINS` is a browser CORS control and is **not** access control, so setting the production ceiling above 0 would let anyone who can send an `/extract` request (a script can send any Origin header) consume the allocation. So the production Worker must not be the test target with a non-zero ceiling.

**Recommended: a separate, throwaway test Worker** (`skeleton-key-extraction-gate`), same source and bindings (`AI`, its own Durable Object), with:
- `DAILY_ADMISSION_CEILING=4`, `ALLOWED_ORIGINS` empty or a non-existent origin (no Pages site can call it);
- a **secret** `TEST_GATE_TOKEN` checked before body parsing and before admission, constant-time compare, refusing with 404/401 otherwise;
- deleted after the test (`wrangler delete`), so nothing persists and the production Worker, DO counter and ceiling are untouched.

This needs one small code change (the optional gate check, active only when `TEST_GATE_TOKEN` is bound, so production behaviour is unchanged) plus unit tests for: missing/wrong token refused before admission and before any AI call; correct token reaches admission; the production configuration without the secret behaves exactly as today. That change is **not made in this plan**; it is its own reviewed PR with CI, and it does not redeploy production unless separately decided.

Alternative considered and rejected: temporarily raising the production ceiling to 1 with Pages origins removed. It leaves the real endpoint open to any script for the duration, and a mistake in the revert would leave admission open.

## 4. Minimal test plan (inference through the binding)

Preconditions: gate PR merged with green CI; owner approves the run and supplies the secret; confirmed baseline of the dashboard neuron counter (screenshot or figure) taken immediately before; production `/health` still shows admission closed at 0.

Budget: **4 attempts total** (the test Worker's ceiling), worst-case reservation 4 x 363.6 = 1,454 neurons, expected about 400 to 550.

| Step | Request | Pass criteria | Stop if |
|---|---|---|---|
| T1 | One tiny known request: the `rfq` sample (357 chars, 8 blocks, `scopecheck.rfq.v1`) | HTTP 200; schema-valid claims; `meta.usage` present with token counts; latency under the 25 s timeout; counter reads 1 | any non-200, schema error, no usage, `quota_exhausted` |
| T2 | One realistic chunk: the largest planned chunk (3,471 chars, 48 blocks) | same; latency recorded; claims have located evidence | timeout (record it, do not retry beyond the budget) |
| T3 | One more realistic chunk from a second document | same; gives a second latency and usage point | as above |
| T4 | One request when the ceiling is reached (the 4th admitted, then a 5th) | the 5th is refused `daily_limit` **without** calling the model; counter stays 4 | the 5th calls the model, or the counter exceeds 4 |

(T1 to T3 use 3 attempts; the 4th attempt is held in reserve for one repair or one retry; the refused 5th request consumes nothing. If no repair/retry is needed the reserve is simply unused.)

Measurements to record: HTTP status, latency, `meta.usage` tokens, repairs, dropped claims; the Durable Object counter before and after each step; the **dashboard neuron delta for the whole test** (this is the first dashboard-confirmed figure, to compare with the 132 per attempt estimate). Do not read the dashboard mid-test and keep the sequence strictly sequential (one request at a time) so attempts map to consumption.

Output: `docs/results/task-5-5-binding-test.md` with the raw figures, the verdict against the pass criteria, and the section 2 adjust rule applied. Then delete the test Worker, confirm production `/health` unchanged, and only then decide the production limits in a separate PR.

What this does **not** do: it does not validate public use, concurrency (the Durable Object serialises admission; a concurrency test is a separate decision), quality of extraction (already measured offline), or per-client abuse control.

## 5. Decisions needed from the owner
1. Approve the throwaway gated test Worker design (section 3) and the 4-attempt budget.
2. Confirm the free daily allocation figure and the 5,000-neuron public share in the dashboard.
3. Provide the gate secret out of band when the run is authorised; it is never committed.
4. Acceptance that a free-tier public service supports about one full three-document session per day.

## 6. What stays unchanged until then
Production Worker `skeleton-key-extraction` version `665dbf8d`, ceiling 0, Pages apps in sample mode, Task 5.5 open, binding inference unvalidated, no inference calls made.
