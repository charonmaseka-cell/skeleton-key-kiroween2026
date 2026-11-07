# Deployment (Task 7.1)

**Status (2 November 2026): CLOSED DEPLOYMENT VERIFIED (externally). Worker deployed with admission closed at 0; Pages apps deployed in sample mode. Inference through the AI binding is NOT validated; task 5.5 is open.**

Provenance of checks: **sandbox** = run from this build environment; **external** = run by me from a network that can reach the sites (reported, not reproducible from the sandbox, whose egress proxy refuses all external hosts including `example.com`).

| Part | State | Evidence |
|---|---|---|
| ScopeCheck Pages app | https://skeleton-key-scopecheck.pages.dev | sandbox: Cloudflare API deployment record. **external**: HTTP 200, loads in labelled sample mode |
| PackCheck Pages app | https://skeleton-key-packcheck.pages.dev | same |
| CI | `main` at `424d3f6` green | **external** (GitHub) |
| workers.dev subdomain | `teddykgroup` | sandbox: created via Cloudflare API (account had none, error 10007) |
| Extraction Worker | https://skeleton-key-extraction.teddykgroup.workers.dev, deployed with `DAILY_ADMISSION_CEILING=0`, `ALLOWED_ORIGINS` = the two Pages origins | sandbox: Cloudflare API shows script and workers.dev route enabled; preflight all PASS |
| Worker `/health` | **external**: HTTP 200; AI binding present, **not called**; Durable Object reachable; admission closed at 0 | sandbox: not possible (TLS reset, 3 bounded probes) |
| `/extract` from each Pages origin | **external**: 429 `daily_limit` (both) | |
| `/extract` from an unlisted origin | **external**: 403 `origin_denied` | |
| Counter after the checks | **external**: still 0 | |

No inference was made and the plan is unchanged. **Still open:** (1) task 5.5, limits from measurement against the deployed Worker; (2) validation of real inference through the AI binding (needs one admitted request, so a non-zero ceiling); admission stays 0 until both pass. **Deployment provenance (2 November 2026, sandbox, from a clean checkout of `main` at `0c5d339eb558ea5de57386e81f0d9ce833cf08fc`, i.e. PR #9 merged after green CI):**
| Part | ID | Evidence |
|---|---|---|
| ScopeCheck Pages | deployment `c1cdd1ac` | Cloudflare API: production, `commit_hash` = `0c5d339...`, `commit_dirty` = false, deploy stage success |
| PackCheck Pages | deployment `4624810b` | same |
| Extraction Worker | version `665dbf8d-013f-4436-ba94-6c35216519ff` | `wrangler deploy` output; `DAILY_ADMISSION_CEILING=0` unchanged |

**External re-verification of these production deployments (`c1cdd1ac`, `4624810b`, Worker `665dbf8d`), performed by me, not the sandbox:** `/health` 200; Durable Object reachable; admission closed at 0; both Pages origins refused with `daily_limit`; an unlisted origin refused with `origin_denied`; both Pages sites 200; counter still 0 afterwards. No inference ran. This supersedes the earlier caveat that the checks had only covered the previous deployments (`0343bb09`, `75f39831`, earlier Worker version). The clean deployed release remains `0c5d339`; this documentation change is not redeployed. The deploy script's "project already exists" message on Pages is harmless.

Both apps were built by `buildApps()` with `VITE_EXTRACTION_API_URL=""` and passed the bundle check (no workers.dev host, no `/extract` URL, no env-file URL). So they open in labelled sample mode with analysis disabled and need no Worker. Production admission is 0 (the Worker does not exist); no live inference was made; no plan was changed. When the Worker is deployed, its `ALLOWED_ORIGINS` are exactly the two URLs above.


**Current production (3 November 2026, from clean `main` at `e4f4790860ab0dbf9705f1c257726ebbca842101`, after PRs #12 to #18):** ScopeCheck Pages production deployment `66b47b7f-05ea-4679-b415-4e500d3328d2`, PackCheck `4ed27dbb-11e7-4160-b272-c62dbfe4b10a` (Cloudflare API: `commit_hash` `e4f4790860ab...`, `commit_dirty` false, deploy success). Extraction Worker version `c20864c5-83bd-4938-a62e-d52b32217081` (created 2026-11-03 19:01:15 UTC): code from the same `main` commit, settings unchanged (`DAILY_ADMISSION_CEILING=0`, `DAILY_NEURON_BUDGET=0`, `ACCESS_GATE=public`, the two Pages origins); `/health` shows admission closed and 0 used. The per-client limiter is still not bound. **The Worker was redeployed unintentionally** (a helper script named `*deploy.ts` ran the full one-command deploy when it imported `deploy.ts`); that run also made one extra Pages deployment per app marked dirty (`f266419b`, `73f41763`, same commit, superseded by the clean ones above). Nothing opened and no inference ran. The previous deployments of this release line were ScopeCheck `cac432f7` / PackCheck `e775418a` at `53d1d385` (and the earlier ones listed above). **Verification:** I opened both sites in a browser and confirmed they serve `e4f4790` (full-length ScopeCheck sample with totals and plain labels; PackCheck results first). The sandbox cannot reach `*.pages.dev`; from the sandbox the Worker half of `--verify-only` passed (health, binding, Durable Object, admission closed, `daily_limit` from a Pages origin, 403 from another origin) and the Pages half was unreachable. `deploy.ts --verify-only` itself was not run by me (not required).

**Redeployment of 3 November 2026, evening (Pages only, from clean `main` at `540b19004c5a3f36c97181a6f79b36e655313d9c`, after the haunted interface HU-T2 to HU-T6):** ScopeCheck Pages production deployment `20c85d65-46cc-417d-85a7-1c0c1acc2242`, PackCheck `ff5cb521-cea6-4091-b99f-3399cb06e09f` (Cloudflare API: `commit_hash` `540b1900...`, `commit_dirty` false, deploy success). Built in sample mode with no analysis URL; both bundles passed the no-analysis-URL check. **The Worker was not touched** and is still version `c20864c5-83bd-4938-a62e-d52b32217081`, admission closed (ceiling 0, budget 0). Pages deployed by a script outside the repository (so the tree stayed clean). Not browser-verified by the sandbox (it cannot reach `*.pages.dev`).

**Public live analysis opened, 3 November 2026 (6,000 estimated neurons per UTC day, attempt ceiling 80, my decision):** from clean `main` at `84d0f168` (PR #21 merged after both checks were green), `CONFIRM_OPEN_LIVE=6000 npx tsx tools/deploy/deploy.ts --open-live`. Preflight passed; Worker version `b48bca11-9dc0-4ca2-a5c3-2c741ed0721c` (per-client limiter bound, input limits 8192 / 6000 / 80 / 1000, `DAILY_ADMISSION_CEILING` 80, `DAILY_NEURON_BUDGET` 6000); both Pages apps rebuilt with the Worker URL and deployed: ScopeCheck `06fcdbcc-19f3-4308-828b-7703986be6ca`, PackCheck `5042fa39-0011-4d84-8160-9ab4c9d0d580` (Cloudflare API: `commit_hash` `84d0f168`, `commit_dirty` false, success). **`--verify-open`** from the sandbox: the Worker checks passed (health ok; Workers AI binding present, not called; Durable Object reachable and its zero probe refuses and writes nothing; admission open with 80 / 6000; gate public; `/extract` and `/run` from a Pages origin refused before anything is held or sent to the model; both from another origin refused with `origin_denied`); the two Pages checks could not run because the sandbox cannot reach `*.pages.dev`. Health after opening: 0 attempts, 0 charged, 0 unsettled, 0 overruns. **No inference had run at that point.** The Cloudflare dashboard reading is to be compared after the first live runs. To close again: `npx tsx tools/deploy/deploy.ts` without flags (ceiling 0, budget 0, sample-mode apps). **From now on a Pages redeploy must be built with the Worker URL** (`buildApps(APPS, workerUrl)`, as `--open-live` does); a plain build has analysis disabled.

**Pages redeployed after the haunted pass, 3 November 2026 (Pages only, from clean `main` at `a80cbd08`, PR #32):** ScopeCheck `5009d589-0111-470a-a23f-221cffffe0ef`, PackCheck `117403c6-bc1c-4d83-ac52-d3425101080c` (Cloudflare API: `commit_hash` `a80cbd08`, `commit_dirty` false, success), **built with the production Worker address** (checked in both bundles) because analysis is open. The Worker was not touched (still `b48bca11`; `/health` afterwards: open, 80 / 6000, 0 attempts, 0 charged). Not browser-checked by the sandbox.

**Pages redeployed after the Next finding fix and the bolder pass, 3 November 2026 (Pages only, from clean `main` at `34e9be97`, PR #34):** ScopeCheck `3eec633d-9e61-49dc-a780-14df833325f1`, PackCheck `55918a43-1e47-4e21-8c04-b608ba6a2069` (Cloudflare API: `commit_hash` `34e9be97`, `commit_dirty` false, success), **built with the production Worker address** (checked in both bundles). The Worker was not touched (still `b48bca11`). `--verify-open` run again after the deploy: the Worker checks all pass (open at 80 / 6000, gate public, `/extract` and `/run` refused before anything is held or sent to the model, from a Pages origin and from another origin; health: 0 attempts, 0 charged, 0 overruns); the two Pages checks cannot run from the sandbox (`*.pages.dev` is not reachable from it), so I open the sites myself.

## What the token needs (account level)
| Permission | Why | Now |
|---|---|---|
| Workers Scripts: Edit | upload the Worker and its Durable Object migration | **refused** |
| Account Settings: Read | wrangler publishes to the account's workers.dev subdomain | **refused** |
| Cloudflare Pages: Edit | create and deploy the two Pages projects | allowed (granted by 2 November) |
| Workers AI: Read | the `AI` binding | allowed |
I decide the token's permissions; nothing here changes credentials.

## What a deployment does (one command once the token allows it)
`npx tsx tools/deploy/deploy.ts`: permission preflight (stops before changing anything if a permission is missing), then:
1. Builds both apps with **`VITE_EXTRACTION_API_URL=""` set explicitly** (not deleted: Vite also reads `.env*` files, and only a value already in the environment takes priority over them), and refuses to continue if a bundle carries an analysis service address: a workers.dev host, a URL ending in `/extract`, or any URL named in the app's env files. Control test (`tools/deploy/build-env.test.ts`): with a custom API domain in `.env.production.local`, a build that merely deletes the variable bakes the domain in; the public build does not. The sites open in **labelled sample mode**; the upload panel says analysis is not available. Public live extraction is closed in the interface.
2. Deploys the Worker `skeleton-key-extraction` with `DAILY_ADMISSION_CEILING=0` (closed: every `/extract` is refused before any inference) and `ALLOWED_ORIGINS` set to the two Pages origins only.
3. Creates (if missing) and deploys the Pages projects `skeleton-key-scopecheck` and `skeleton-key-packcheck`.
Then `WORKER_URL=... npx tsx tools/deploy/deploy.ts --verify-only` checks, without inference:
- `GET /health`: configuration valid; **Workers AI binding present (it is not called)**; **deployed Durable Object reachable, refuses at ceiling 0 and writes nothing**; admission closed.
- `/extract` from a Pages origin is refused with `daily_limit`; from any other origin with `origin_denied`.
- both Pages sites serve the app.

## What `/health` proves, and what it does not
It proves the bindings are wired in the deployed Worker and that the deployed counter's admission path fails closed without consuming anything. It does **not** prove inference through the binding works: that needs one admitted request, which needs a non-zero ceiling. That belongs to task 5.5 (limits from measurement against the deployed Worker), which stays open; admission opens only after it passes.

## Tests (offline)
`services/extraction-api/test/durable-object.test.ts` (the check against the real SQLite Durable Object in workerd: closed, after real admissions, missing AI binding), `test/health.test.ts` (failure cases, nothing sensitive in the body), `tools/deploy/deploy.test.ts` (the verification logic against a fake deployment).

## Candlelight pass deployed (3 Nov 2026)
Pages only, built with the Worker address, from `2541b39` (PR #36): ScopeCheck `1ac4aafd`, PackCheck `92cd5f02`. The Worker was not touched (still `b48bca11`, ceiling 80, budget 6000, open). `--verify-open` Worker checks pass; the two Pages reachability checks fail from the sandbox (HTTP 599, `*.pages.dev` is unreachable here), so the live pages were not fetched. No inference was run.

## Pages redeployed after the beta fixes, 5 November 2026 (D3)
Pages only, built with the Worker address, from clean `main` at `7691632` (PRs #36 to #40: candlelight pass, unit and price rules, live-run follow-ups, beta fixes). ScopeCheck `f139ea91`, PackCheck `f41825c5`. The previous live deployment was from `2541b39`. The Worker was not touched (version `b48bca11`, ceiling 80, budget 6,000, open). `--verify-open`: all Worker checks pass; the two Pages reachability checks fail from the sandbox (HTTP 599, `*.pages.dev` is unreachable here), so the live pages were not fetched from here. No inference was run by the deploy. Worker ledger afterwards: 11 attempts and 764.597 estimated neurons charged today, 0 unsettled, 0 overruns (this includes the first PackCheck production run and one diagnostic `/run` probe of mine, 271.693 neurons, recorded in the build log).

## Worker with the line-total profile, then Pages again, 5 November 2026
**Worker first (same 80 / 6,000 limits, new profile only).** Redeployed from clean `main` at `011b279` as Worker version `afcf4876`; the bindings and variables were identical to production (checked with a dry run first). It accepts both `scopecheck.quote.v1` and `scopecheck.quote.v2` (and the RFQ and PackCheck profiles), checked without any charge: an oversized plan answers `too_large` for a known profile and `invalid_input` for an unknown one. `--verify-open`: all Worker checks pass. Production limits, model and infrastructure are otherwise unchanged. **Pages after the line-total recording merged (PR #42).** Pages only, built with the Worker address, from clean `main` at `fe306d9`: ScopeCheck `88d29413`, PackCheck `09a05521`. The deployed ScopeCheck build uses `scopecheck.quote.v2` for both quotation slots; the live site now asks for line totals. `--verify-open`: Worker checks pass; the two Pages reachability checks fail from the sandbox (HTTP 599, `*.pages.dev` unreachable here), so the live pages were not fetched from here. The re-recording itself (3 attempts, 285.564 neurons settled) is in the build log. Ledger afterwards: 14 attempts and 1,050.161 estimated neurons charged that day, 0 unsettled, 0 overruns.
