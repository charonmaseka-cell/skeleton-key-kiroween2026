# Skeleton Key

A reusable document-checking engine powering two separate apps, built with Kiro for Kiroween 2026 (Skeleton Crew):

- **ScopeCheck** (`apps/scopecheck`): compares supplier quotations against an RFQ.
- **PackCheck** (`apps/packcheck`): checks grant-application packs for completeness and consistency.

Models extract and suggest; deterministic rules produce findings backed by validated evidence.

**Status:** early scaffold (Task 1). No document processing yet.

**Privacy note (planned design):** files will be parsed in the browser, but extracted text is sent to an AI service after you start analysis. Not all processing is local.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/scopecheck`, `apps/packcheck` | Separate runnable apps |
| `packages/engine` | Domain-neutral engine (must not import app code) |
| `packages/ui` | Components shared by both apps |
| `services/extraction-api` | Cloudflare Worker (placeholder) |
| `tools/benchmark` | Live-extraction benchmark (placeholder) |
| `samples/` | Original fictional sample documents |
| `.kiro/` | Steering and specs (requirements, design, tasks) |
| `docs/build-log.md` | Factual build record |

## Commands (Node 20+)

```bash
npm install
npm run dev:scopecheck      # http://localhost:5173
npm run dev:packcheck       # http://localhost:5174
npm run build:scopecheck
npm run build:packcheck
npm run lint && npm run typecheck && npm test && npm run build
```

## Licence

MIT
