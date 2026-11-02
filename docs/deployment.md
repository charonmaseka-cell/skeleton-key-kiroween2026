# Deployment (Task 7.1)

**Status (2 November 2026, from `main` at `722b4fd`): PARTIAL.**
| Part | State | Evidence |
|---|---|---|
| ScopeCheck Pages app | **deployed**: https://skeleton-key-scopecheck.pages.dev (deployment `d0d2f51b`) | Cloudflare API: production, branch `main`, commit `722b4fd`, stage deploy = success, canonical deployment of the project |
| PackCheck Pages app | **deployed**: https://skeleton-key-packcheck.pages.dev (deployment `b07d1873`) | same |
| Extraction Worker (`/extract`, `/health`, Durable Object) | **NOT deployed** | `wrangler deploy` refused ("No access to the specified resource"); the account has no Worker script |
| Browser and HTTP check of the two sites | **NOT done** | this environment's egress proxy refuses connections to `*.pages.dev` (curl `CONNECT 403`; Playwright and agent-browser `ERR_TUNNEL_CONNECTION_FAILED`; the fetch tool HTTP 403); even `example.com` is refused |
| Worker health and API checks | **NOT possible** | there is no Worker URL |

Both apps were built by `buildApps()` with `VITE_EXTRACTION_API_URL=""` and passed the bundle check (no workers.dev host, no `/extract` URL, no env-file URL). So they open in labelled sample mode with analysis disabled and need no Worker. Production admission is 0 (the Worker does not exist); no live inference was made; no plan was changed. When the Worker is deployed, its `ALLOWED_ORIGINS` are exactly the two URLs above.

**Still to do:** grant the token Workers Scripts: Edit and Account Settings: Read; then `npx tsx tools/deploy/deploy.ts` (it redeploys both apps the same way) and `WORKER_URL=... npx tsx tools/deploy/deploy.ts --verify-only`, and open both sites in a browser from a network that can reach them.

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
