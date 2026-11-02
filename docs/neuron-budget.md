# Server-side neuron budget (task 5.5, option A)

Status: **implemented offline, not deployed, not enabled.** Production `DAILY_NEURON_BUDGET = "0"` and `DAILY_ADMISSION_CEILING = "0"`: nothing is admitted. The proposed public value is **5,000 estimated neurons per UTC day** (half the free plan's daily allocation), applied only after task 5.5 passes. The free plan is unchanged.

## What the Worker does for every inference attempt (repairs included)
1. Builds the exact messages, then computes the attempt's **reservation**: the worst case for those messages and the profile's whole output allowance (`src/cost.ts`).
2. Asks the Durable Object to **reserve**, in one transaction: admitted only if today's attempts are below `DAILY_ADMISSION_CEILING` **and** today's charged neurons + this reservation are at most `DAILY_NEURON_BUDGET`. A refusal writes nothing and returns `daily_limit` before the model is called. A ledger failure closes the service (`limiter_unavailable`).
3. Calls the model.
4. **Settles**: if the model reported both token counts, the attempt is charged the full estimate from those tokens, **not clipped** to the reservation; a charge above the reservation is flagged as an **overrun** (stored, logged, and counted against the day, so later reservations are refused sooner). If usage is missing or malformed, or the call failed or timed out, the reservation **stands** (consumption unknown). If the Worker dies between reserving and settling, the reservation stands. Nothing is ever refunded below a settled figure.

Because every admission checks charged + outstanding reservations against the budget, the day's estimated total stays at or under the budget by construction, **except for overruns**, which are recorded and stop further admissions.

Ledger rows: UTC day, reserved, charged, state, overrun flag. No document text, no client data. Rows older than 7 days are deleted. `/health` reports today's attempts, charged estimate, unsettled reservations and overruns, and probes the admission path with a refusal that writes nothing.

## Assumptions behind the cost bound (each stated so it can be checked)
| | Assumption | Evidence / what breaks it |
|---|---|---|
| A1 | Rates: published prices ($0.293 input, $2.253 output per million tokens) at $0.011 per 1,000 neurons = 26,636 and 204,818 neurons per million tokens, for `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. A model without a listed rate is never called (`not_configured`). | One dashboard comparison: 462.81 measured vs 462.76 estimated (5 attempts, checkpoint 1). If the dashboard diverges, all charges (reservations and settlements) are wrong by the same factor; the 5,000 of 10,000 split is the margin for that. |
| A2 | Margin x1.1 on every reservation and settlement. | Same factor on both, so they are comparable. |
| A3 | Input tokens <= UTF-8 bytes of the messages + 64. | A byte-level BPE token covers at least one byte. The 64 covers the chat template and anything the provider adds (for example from `response_format`). Observed 4.45 to 5.40 bytes per reported prompt token over 14 live requests, small ones included, so additions are small. If the provider added more than 64 tokens, settlement still charges the reported figure and records an overrun. |
| A4 | Output tokens <= the profile's `max_tokens` (1,500 ScopeCheck, 1,200 PackCheck). | Enforced by the provider; never exceeded in the measured runs. A breach would show as an overrun. |
| A5 | One model call per admitted attempt; the usage the model reports is the usage charged. | A call the Worker abandoned at the 25 s timeout may still finish and consume; its usage never reaches the Worker, so its reservation stands (it covers A3 + A4). |
| A6 | All figures are **estimates**. Only the Cloudflare dashboard shows consumption. | Dashboard readings are compared after every live run. |

Bound at the proposed limits (`MAX_BODY_BYTES` 8,192): the largest reservation any accepted request can produce is **630.5** estimated neurons (`docs/results/task-5-5-reservations.json`, `permitted`). How many attempts 5,000 admits depends on settlements: about 37 at the measured average of about 132 per attempt, but that is an **estimate from one run, not a guarantee**; large chunks and outstanding reservations admit fewer.

## Configuration
- `DAILY_NEURON_BUDGET`: **required**, integer 0 to 10,000 (hard cap = the free daily allocation). Missing or invalid closes the service.
- `DAILY_ADMISSION_CEILING` stays as an attempt backstop (proposed 40 with the budget).
- Production `wrangler.toml`: both 0. `tools/deploy/deploy.ts` passes `DAILY_NEURON_BUDGET:0` explicitly. The staging gate Worker (`wrangler.gate.toml`): 2,000, matching the authorised test cap.

## Tests
`test/ledger.test.ts` (ledger over real SQLite: admission on attempts and neurons, settlement, unknown usage kept, overrun unclipped and blocking, unsettled reservation stands, once-only settle, day rollover, a randomised serial sequence never passing the budget; cost model agrees with the benchmark's rates and guaranteed bound; handler reserve/call/settle including repairs, timeouts, model errors, missing usage, overruns, budget refusal before the model, a repair refused by the budget, required configuration, settlement failure). `test/durable-object.test.ts` (real SQLite Durable Object in workerd: 20 concurrent requests with unknown usage cannot pass a 1,000 budget; measured settlements free headroom).
