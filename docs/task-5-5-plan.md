# Task 5.5 (offline): proposed limits and a gated binding test plan

Status: **PROPOSAL, revision 2 (2 November 2026). Nothing here is applied.** Production stays at release `0c5d339` (Worker version `665dbf8d`), `DAILY_ADMISSION_CEILING=0`. No inference was made to write this. Task 5.5 and the inference-through-binding validation stay **open**.

Revision 2 corrects revision 1: the production ceiling is no longer derived from an average; reservations are computed for the exact test payloads (363.6 was one request's figure, not a maximum); T4 is corrected; the staging gate is explicit and required; the secret is generated in the sandbox; the dashboard history is corrected.

Sources: `docs/results/task-5-5-reservations.json` (written by `tools/benchmark/src/reservations.ts`: exact request bodies and Worker messages for all 48 chunks of every sample and frozen plan, built from the PDFs; no model call), `results/sc-t4-scopecheck-baseline.md`, `results/sc-t12-fresh-results.md`, `build-log.md`. Gate implementation: PR #12.

## 1. Measured offline (exact payloads)

How a reservation is computed (`tools/benchmark/src/budget.ts`): input tokens bound = ceil(UTF-8 bytes of the messages / bytes-per-token) + 64; output = the profile's whole `max_tokens`; charged at published rates (26,636 / 204,818 neurons per million input / output tokens) x 1.1. **Guaranteed** bound: 1 byte per token (a token covers at least one byte). **Calibrated** bound: 2 bytes per token (observed 4.45 to 5.40 bytes per token over 14 live requests; not a guarantee). The output allowance alone is 1,500 x 204,818 / 10^6 x 1.1 = **338.0** neurons for ScopeCheck profiles (270.4 for PackCheck, cap 1,200), so every reservation is dominated by it.

| Quantity (all 48 chunks) | Maximum | Where |
|---|---|---|
| Request body | 4,753 bytes | `scopecheck-realistic/rfq#6` |
| Characters as the Worker counts them (text + cells) | 3,471 | same |
| Blocks | 48 | same |
| Messages sent to the model (initial / with repair) | 5,907 / 6,014 bytes | same |
| Longest block (text only / text + cells) | 118 / 142 characters | `scopecheck-fresh/quote-b#3` / `scopecheck-fresh/quote-a#4` |
| Per-attempt reservation, guaranteed / calibrated (repair) | 516.0 / 427.9 | same as the largest body |

## 2. Production ceiling: replaced

Revision 1 divided 5,000 neurons by the average measured attempt (about 132, estimated) and proposed 36 attempts. That is withdrawn: an average says nothing about what a request the limits allow can cost, and one full three-document session per day was never more than an estimate.

**The bound that matters is the largest attempt the limits permit**, for any profile and any body they accept. User message bytes are at most its fixed prefix plus the body bytes (the Worker re-serialises parsed blocks, which is never longer than the JSON it was parsed from), plus the system prompt with the cells rule and the repair message:

| `MAX_BODY_BYTES` | Worst profile | Guaranteed (1 B/token) | Calibrated (2 B/token) | Attempts in 5,000, guaranteed | calibrated |
|---|---|---|---|---|---|
| **8,192 (proposed)** | `scopecheck.quote.v1` | **630.5** | 485.2 | **7** | 10 |
| 12,288 | same | 750.5 | 545.2 | 6 | 9 |
| 32,768 (revision 1) | same | 1,350.6 | 845.2 | 3 | 5 |
| 65,536 (current default) | same | 2,310.7 | 1,325.3 | 2 | 3 |

So a strictly safe **attempt** ceiling (option B) is **7 attempts per day** at the proposed limits. A three-document realistic session took 22 attempts, so option B serves about a third of one session a day.

**Recommendation: option A, server-enforced neuron reservations and settlement**, with an attempt ceiling kept as a backstop. In the Durable Object, in one transaction per attempt:
1. Reserve, before the model is called: `charge(messageBytes + 64, max_tokens)` computed in the Worker from the exact messages (guaranteed 1 B/token bound; at most 630.5 at the proposed limits). Admit only if `settled + outstanding + reservation <= 5,000` for the UTC day, and the attempt count is below the backstop.
2. Settle after the call: if the model reports both token counts, the charge becomes `charge(promptTokens, completionTokens)`, rounded up, **even if larger than the reservation**. If usage is missing, or the call errors or times out, the reservation **stands** (consumption unknown). No refunds below the settled figure.
3. A reservation that is never settled (the Worker died mid-call) stands for the day.
This holds the day at or under 5,000 **estimated** neurons by construction, whatever the inputs. How many attempts that admits is not fixed: at the measured average settlement (about 132 per attempt) it would be about 37, which is roughly 1.7 realistic sessions, but that is an **estimate from one run, not a guarantee**; a day of large chunks admits fewer, and in-flight reservations (up to 630.5 each) temporarily reduce headroom. The interface must state the limit as "a small shared daily allowance", not as a number of sessions.

Caveat that remains in both options: the charge uses published rates, not dashboard consumption. The only dashboard comparison so far (section 5) agreed, but it is one aggregate of 5 attempts. The 5,000 public share keeps half of the free allocation (10,000 neurons per day on the free plan, **to be confirmed in the dashboard**) as margin for that error and for owner testing. On the free plan exhausting the allocation fails closed (`quota_exhausted`); there is no overage charge.

Proposed input limits (apply with option A; these also bound option B):

| Setting | Current | Proposed | Basis |
|---|---|---|---|
| `MAX_BODY_BYTES` | 65,536 | **8,192** | largest measured body 4,753 (1.72x). This is the limit that bounds cost |
| `MAX_CHARS` | 24,000 | **6,000** | largest measured 3,471 (1.73x) |
| `MAX_BLOCKS` | 400 | **80** | largest measured 48 (1.67x) |
| `MAX_BLOCK_CHARS` | 4,000 | **1,000** | longest measured 142 with cells (7x). Generous because it does not affect cost (the body limit does) and unusually long lines should not be rejected |
| `MAX_REPAIR_ATTEMPTS`, `INFERENCE_TIMEOUT_MS`, output caps | 1, 25,000, 1,500/1,200 | unchanged | 0 repairs and 1 timeout in 22 baseline attempts |
| Neuron budget (option A) | none | **5,000 estimated per UTC day** | half the free allocation, see above |
| Attempt backstop | `DAILY_ADMISSION_CEILING` = 0 | **40** (with option A) / **7** (option B alone) | backstop only under A |

Option A needs its own PR (Durable Object ledger, settlement, tests including concurrency and a crash between reserve and settle). It is not part of PR #12 and nothing is opened before it passes and the binding test below has passed.

## 3. Staging gate (PR #12, offline, tested)

The production Worker has no authentication; `ALLOWED_ORIGINS` is CORS, not access control. The test therefore runs against a **throwaway** Worker, never the production one:
- `wrangler.gate.toml`: script `skeleton-key-extraction-gate` (its own Durable Object counter), `ACCESS_GATE = "token"`, `ALLOWED_ORIGINS = "https://gate-test-client.invalid"` (an explicit dummy origin for the authenticated test client; `.invalid` is reserved and no page can hold it), the proposed input limits above, `DAILY_ADMISSION_CEILING = "4"`.
- **The gate is explicit and required.** `ACCESS_GATE` must be `public` or `token`; anything else, including missing, closes the service (`not_configured`). In `token` mode a missing or short secret closes the service: authentication cannot disappear because the secret was not bound. A secret alone never selects a mode. Production `wrangler.toml` sets `ACCESS_GATE = "public"` (unchanged behaviour); production is not redeployed by this work.
- The check runs before the origin check, the body, admission and the model; constant-time comparison of SHA-256 digests; the token is never logged or returned. `/health` shows the mode, whether it is valid and whether a credential is bound (never its value).
- Secret: `tools/deploy/gate-secret.ts --create` generates 32 bytes from the OS CSPRNG (43 base64url characters) into the git-ignored `.benchmark-state/gate/secret` with mode 600, never printed; `--put` pipes it to `wrangler secret put` on stdin; `--destroy` removes it after the Worker is deleted. You do not need to supply one.

## 4. Test sequence (exact payloads and reservations)

Runner: `tools/deploy/gate-test.ts` (tested offline against the real handler and health check with a mocked model). Sequential; one request at a time.

| Step | Payload (built from the sample PDF and frozen plan) | Profile | Blocks | Chars | Body bytes | Message bytes | Reservation, guaranteed (repair) | calibrated (repair) |
|---|---|---|---|---|---|---|---|---|
| T1 tiny | `scopecheck/rfq` | `scopecheck.rfq.v1` | 4 | 232 | 375 | 1,529 | 384.6 (387.8) | 362.2 (363.8) |
| T2 largest realistic chunk | `scopecheck-realistic/rfq#6` | `scopecheck.rfq.v1` | 48 | 3,471 | 4,753 | 5,907 | 512.9 (516.0) | 426.4 (427.9) |
| T3 second document | `scopecheck-realistic/quote-a#8` | `scopecheck.quote.v1` | 34 | 2,575 | 3,495 | 4,786 | 480.1 (483.2) | 409.9 (411.5) |
| T4 tiny (only if a slot is left) | `packcheck/registration` | `packcheck.grant.v1` | 2 | 91 | 185 | 1,547 | 317.6 (320.7) | 294.9 (296.5) |

**Attempt budget: exactly 4 inference attempts at most** (the staging Worker's ceiling; repairs count; refused requests consume none). The 5 ways 4 attempts can be spent: T1 T2 T3 T4 (no repair: 1,695.2 guaranteed); T1 T1r T2 T2r; T1 T1r T2 T3; T1 T2 T2r T3; T1 T2 T3 T3r. **Worst case: T1 T2 T2r T3 = 1,893.6 guaranteed / 1,626.4 calibrated.** Expected, from earlier measured runs of similar requests, a few hundred estimated neurons; not a promise.

Order and stop rules:
1. **P0** at least 60 minutes before 00:00 UTC (the counter resets at midnight, which would re-open admission).
2. **P1** `/health` of the gate Worker: ok, gate `token` valid with a credential bound, ceiling 4, counter 0, binding present (not called).
3. **P2** zero-cost refusals: no token -> 401 `unauthorized`; random wrong token -> 401; right token from a non-allowed origin (the ScopeCheck Pages origin) -> 403 `origin_denied`; counter still 0.
4. **T1, T2, T3** with the token and the dummy origin. After each: HTTP 200, token usage reported, counter = before + `meta.attempts`, latency under 25 s.
5. **T4 only while the counter is below 4.** If a repair in T1 to T3 used the fourth slot, T4 is skipped. If no repair happened, the counter is 3 after T3 and T4 is the fourth (tiny) attempt, which is what exhausts the ceiling.
6. **R** only if the counter is exactly 4, no stop fired, and it is still the same UTC day: one more request (the T4 payload) must get 429 `daily_limit` and the counter must still be 4. Under any other condition R is not sent, because a request below the ceiling would be admitted.

**Stop immediately** (no further `/extract` request of any kind; only `/health` is read) on: any failed precheck; a non-200 from an inference step (including the case where a step's first attempt is the fourth and its repair is refused, which returns `daily_limit` after one inference); missing token usage; a counter that does not match the attempts reported; latency at or above the timeout.

After the run: record the result (`docs/results/task-5-5-binding-test.json` is written by the runner, without the token), take the dashboard reading (section 5), delete the gate Worker, destroy the secret file, and confirm production `/health` is unchanged (ceiling 0).

## 5. Dashboard readings

Correction: revision 1 said consumption had never been read from the dashboard. It has, once: **checkpoint 1, 462.81 neurons dashboard-confirmed after 5 attempts, against 462.76 estimated** (`build-log.md`). Every later figure (about 869 after 11 attempts, the SC-T4 2,906, the SC-T12 batch) is an estimate from measured tokens, pending a dashboard reading.

For this test, preserve a fresh pair: a **before** reading (value, model breakdown if shown, UTC date and time) taken immediately before P0, and an **after** reading taken at least 15 minutes after the last request and again at 60 minutes; if the figure is still moving at 60 minutes it is recorded as unsettled. The delta is compared with the settled estimate from the reported tokens. The dashboard figure is per account per UTC day, so no other inference may run that day (production is at 0; no benchmark run is planned).

## 6. Blocker for live execution from the sandbox

This sandbox cannot reach `*.workers.dev`: the egress proxy refuses the CONNECT (403, re-checked 2 November). Deploying the gate Worker and binding the secret work from here (they use `api.cloudflare.com`), but P1 to R cannot. Options:
- allow sandbox egress to `skeleton-key-extraction-gate.teddykgroup.workers.dev`, so the whole run (secret included) stays in the sandbox; or
- run `gate-secret.ts --create/--put` and `gate-test.ts` on a machine that can reach the Worker, so the secret is generated where it is used. The sandbox-generated secret would not be copied out.

## 7. Decisions needed before live execution
1. Approve option A (or B with 7 attempts per day) and the proposed input limits.
2. Approve the 4-attempt gated test, worst-case reservation 1,893.6 estimated neurons.
3. Choose how to resolve section 6.
4. Provide the before dashboard reading at the start of the run, and confirm the free daily allocation.

Unchanged until then: production Worker `665dbf8d`, ceiling 0, Pages apps in sample mode, task 5.5 open, binding inference unvalidated, no inference calls made.
