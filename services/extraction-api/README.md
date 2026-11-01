# extraction-api

Cloudflare Worker: `POST /extract` `{schemaId, blocks:[{id,text}]}`. See `.kiro/specs/skeleton-key-foundation/design.md` §6.

- Local dev: copy values into `.dev.vars` (git-ignored), e.g. `DAILY_ADMISSION_CEILING=20`, then `npm run dev -w @skeleton-key/extraction-api`.
- Config lives in `wrangler.toml` `[vars]`. `DAILY_ADMISSION_CEILING = "0"` keeps the service closed until set from benchmark results.
- Tests (mocked model): `npm test`. No secrets are needed; Workers AI uses the account binding, not an API key.
