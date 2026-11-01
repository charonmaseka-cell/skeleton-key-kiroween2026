# Tech stack and conventions

## Stack
- npm workspaces monorepo; TypeScript everywhere
- React + Vite + Tailwind for both apps
- PDF.js (browser) for PDF text, page numbers and coordinates; Mammoth (browser, DOCX) added only after the PDF path works. Extract text only; never inject converted HTML.
- Zod for schema validation; decimal.js for all money and quantity arithmetic (no floating point)
- `services/extraction-api`: small Cloudflare Worker using a Workers AI binding behind a provider interface
- Cloudflare Pages hosting (one project per app); no database, no uploaded-file storage; in-memory session state only
- Vitest (deterministic fixtures) and Playwright (end-to-end); live-model checks are separate and optional

## Layout
- `apps/scopecheck`, `apps/packcheck`: separate entry points, config and build commands
- `packages/engine`: generic blocks, extraction interfaces, evidence validation, matching, rules execution
- `packages/ui`: only genuinely shared presentation components
- `samples/scopecheck`, `samples/packcheck`: original fictional documents and expected outputs
- `docs/build-log.md`: short factual record of Kiro tasks, tests and decisions

## Rules
- `packages/engine` MUST NOT import from `apps/*` or contain domain-specific logic. Domain behaviour enters through adapters.
- Evidence references: PDF = page + text span/coordinates; DOCX = paragraph or table-cell reference. Never invent Word page numbers.
- Rule execution is independent of the model provider. One extraction per document; reuse validated structures.
- Invalid-JSON repair: at most one controlled retry, then a recoverable error.
- Match confidence thresholds (e.g. 0.7) are uncalibrated heuristics until measured. Do not present model scores as probabilities.
- Arithmetic checks must account for stated discounts, rounding, tax treatment and pack quantities; if the basis is unjustified, do not report a mismatch.
- Do not log original filenames or document content.
- Cached extraction is allowed only for bundled original fictional samples, labelled as such; rules and matching always rerun.
- Never introduce a paid service or dependency requiring billing without flagging it first.

## Worker limits and quota
- Server-enforced (not client-only): origin allowlist, max body size, max text length, per-client request limit, global daily ceiling, bounded retries (one JSON-repair retry per chunk; no automatic retry loops). Each has a handler test.
- Quota exhaustion returns a distinct error; keep session data, show a recoverable banner, never fall back silently to cache.
- Reuse each document's validated extraction in-session (multiple chunk requests allowed); corrections rerun rules locally without calling the model.
- Run the live-extraction benchmark before building the full interface.
- Keep docs concise: update existing files rather than adding per-topic reports.
- Origin allowlist is an extra control, not authentication. Quota counters (atomic, SQLite Durable Object, no content) and limits are set from benchmark data; a request-count ceiling alone does not guard the neuron allowance.
