# Deployment (Task 7.1)

**Status (2 November 2026): Worker deployed with admission closed (ceiling 0); Worker verification NOT yet done (sandbox cannot reach it); Pages apps deployed and externally verified.**
| Part | State | Evidence |
|---|---|---|
| ScopeCheck Pages app | **deployed**: https://skeleton-key-scopecheck.pages.dev | Redeployed 2 November (`0343bb09`, same build, `VITE_EXTRACTION_API_URL=""`). **External check** (owner-reported, not run from this sandbox): loads in labelled sample mode |
| PackCheck Pages app | **deployed**: https://skeleton-key-packcheck.pages.dev | Redeployed 2 November (`75f39831`). Same external check |
| CI | `main` at `424d3f6` passed CI | **External check** (GitHub, owner-reported) |
| workers.dev subdomain | **`teddykgroup`** created via the Cloudflare API (PUT `/workers/subdomain`) after the account was found to have none (error 10007) | API returned success |
| Extraction Worker | **deployed**: `skeleton-key-extraction`, https://skeleton-key-extraction.teddykgroup.workers.dev | Cloudflare API: script exists (modified 2026-11-02T04:16:16Z), workers.dev route enabled. Deployed with `DAILY_ADMISSION_CEILING=0` and `ALLOWED_ORIGINS` = the two Pages origins only |
| Worker `/health`, `/extract` refusal checks | **NOT done** | this sandbox's egress proxy refuses all external hosts (TLS reset on the Worker URL, three bounded probes; `example.com` also fails). Run externally: `WORKER_URL=https://skeleton-key-extraction.teddykgroup.workers.dev npx tsx tools/deploy/deploy.ts --verify-only` |

No inference was made; admission is closed (0). Free plan unchanged. Task 5.5 (limits from measurement against the deployed Worker) stays **open**; admission opens only after it passes.

Both apps were built by `buildApps()` with `VITE_EXTRACTION_API_URL=""` and passed the bundle check (no workers.dev host, no `/extract` URL, no env-file URL). So they open in labelled sample mode with analysis disabled and need no Worker. Production admission is 0 (the Worker does not exist); no live inference was made; no plan was changed. When the Worker is deployed, its `ALLOWED_ORIGINS` are exactly the two URLs above.

**Still to do:** run the verify-only command above from a network that can reach the Worker; then task 5.5.

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
