# Deployment (Task 7.1)

**Status (2 November 2026): CLOSED DEPLOYMENT VERIFIED (externally). Worker deployed with admission closed at 0; Pages apps deployed in sample mode. Inference through the AI binding is NOT validated; task 5.5 is open.**

Provenance of checks: **sandbox** = run from this build environment; **external** = run by the owner from a network that can reach the sites (reported, not reproducible from the sandbox, whose egress proxy refuses all external hosts including `example.com`).

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

**External re-verification of these production deployments (`c1cdd1ac`, `4624810b`, Worker `665dbf8d`), performed by the owner, not the sandbox:** `/health` 200; Durable Object reachable; admission closed at 0; both Pages origins refused with `daily_limit`; an unlisted origin refused with `origin_denied`; both Pages sites 200; counter still 0 afterwards. No inference ran. This supersedes the earlier caveat that the checks had only covered the previous deployments (`0343bb09`, `75f39831`, earlier Worker version). The clean deployed release remains `0c5d339`; this documentation change is not redeployed. The deploy script's "project already exists" message on Pages is harmless.

Both apps were built by `buildApps()` with `VITE_EXTRACTION_API_URL=""` and passed the bundle check (no workers.dev host, no `/extract` URL, no env-file URL). So they open in labelled sample mode with analysis disabled and need no Worker. Production admission is 0 (the Worker does not exist); no live inference was made; no plan was changed. When the Worker is deployed, its `ALLOWED_ORIGINS` are exactly the two URLs above.


**Current production (3 November 2026, from clean `main` at `e4f4790860ab0dbf9705f1c257726ebbca842101`, after PRs #12 to #18):** ScopeCheck Pages production deployment `66b47b7f-05ea-4679-b415-4e500d3328d2`, PackCheck `4ed27dbb-11e7-4160-b272-c62dbfe4b10a` (Cloudflare API: `commit_hash` `e4f4790860ab...`, `commit_dirty` false, deploy success). Extraction Worker version `c20864c5-83bd-4938-a62e-d52b32217081` (created 2026-11-03 19:01:15 UTC): code from the same `main` commit, settings unchanged (`DAILY_ADMISSION_CEILING=0`, `DAILY_NEURON_BUDGET=0`, `ACCESS_GATE=public`, the two Pages origins); `/health` shows admission closed and 0 used. The per-client limiter is still not bound. **The Worker was redeployed unintentionally** (a helper script named `*deploy.ts` ran the full one-command deploy when it imported `deploy.ts`); that run also made one extra Pages deployment per app marked dirty (`f266419b`, `73f41763`, same commit, superseded by the clean ones above). Nothing opened and no inference ran. The previous deployments of this release line were ScopeCheck `cac432f7` / PackCheck `e775418a` at `53d1d385` (and the earlier ones listed above). **Verification:** the owner opened both sites in a browser and confirmed they serve `e4f4790` (full-length ScopeCheck sample with totals and plain labels; PackCheck results first). The sandbox cannot reach `*.pages.dev`; from the sandbox the Worker half of `--verify-only` passed (health, binding, Durable Object, admission closed, `daily_limit` from a Pages origin, 403 from another origin) and the Pages half was unreachable. `deploy.ts --verify-only` itself was not run by the owner (not required).

## What the token needs (account level)
| Permission | Why | Now |
|---|---|---|
| Workers Scripts: Edit | upload the Worker and its Durable Object migration | **refused** |
| Account Settings: Read | wrangler publishes to the account's workers.dev subdomain | **refused** |
| Cloudflare Pages: Edit | create and deploy the two Pages projects | allowed (granted by 2 November) |
| Workers AI: Read | the `AI` binding | allowed |
Changing the token's permissions is the account owner's decision; nothing here changes credentials.

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
