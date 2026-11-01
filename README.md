# Skeleton Key

A reusable document-checking engine powering two separate apps, built with Kiro for Kiroween 2026 (Skeleton Crew):

- **ScopeCheck** (`apps/scopecheck`): compares supplier quotations against an RFQ.
- **PackCheck** (`apps/packcheck`): checks grant-application packs for completeness and consistency.

Models extract and suggest; deterministic rules produce findings backed by validated evidence.

**Status:** both apps run in **sample mode** on clearly labelled fictional fixtures (Task 6): validation, matching, rules, review, corrections and export all run in the browser from fixture inputs (source text plus recorded model claims). The live upload path (parsing your own PDF, calling the Worker) is not wired yet (Task 8). Production admission is closed (`DAILY_ADMISSION_CEILING = 0`).

**Privacy note (planned design):** files will be parsed in the browser, but extracted text is sent to an AI service after you start analysis. Not all processing is local.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/scopecheck`, `apps/packcheck` | Separate runnable apps |
| `packages/engine` | Domain-neutral engine (must not import app code) |
| `packages/ui` | Components shared by both apps |
| `services/extraction-api` | Cloudflare Worker (extraction profiles, limits, admission counter) |
| `tools/benchmark` | Live-extraction benchmark, model comparison, fixture builder |
| `samples/` | Original fictional sample documents, `fixtures/` (app inputs), `benchmark-results/` |
| `.kiro/` | Steering and specs (requirements, design, tasks) |
| `docs/build-log.md` | Factual build record |
| `docs/model-comparison.md`, `docs/handoff-task-6.md` | Model decision; Task 6 handoff |

## Commands (Node 20+)

```bash
npm install
npm run dev:scopecheck      # http://localhost:5173
npm run dev:packcheck       # http://localhost:5174
npm run build:scopecheck    # builds independently of PackCheck
npm run build:packcheck     # builds independently of ScopeCheck
npm run preview -w @skeleton-key/scopecheck   # serve the built app on http://localhost:4173 (PackCheck: 4174)
npm run lint && npm run typecheck && npm test && npm run build
```

## Try the sample mode

1. `npm install`, then `npm run dev:scopecheck` (or `dev:packcheck`) and open the printed address.
2. The amber **SAMPLE MODE** banner is always visible. Nothing is uploaded and no model is called.
3. ScopeCheck: comparison table of RFQ items against each quotation (switch to the free-text sample with the selector). PackCheck: attachment checks and field checks across the pack.
4. Every item with a source shows the cited text highlighted. **Needs review** items and **Not evaluated** comparisons (which did *not* run, with the reason and the blocked input) have their own sections.
5. Try: *Correct this value* on a held value (for example the ambiguous start date in PackCheck), *Accept* or *Dismiss* a finding, *confirm coverage* of a document (an omission only becomes a confirmed finding after that), then *Download CSV / text* (all states are kept) or *Print*.
6. Keyboard: Tab through the page (skip link first), Enter or Space on buttons and links; the correction editor takes focus when it opens, and results are announced to screen readers.

Regenerate the fixtures from the samples with `npm run fixtures -w @skeleton-key/benchmark`. Screenshots: `docs/screenshots/`.

## Licence

MIT
