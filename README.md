# Skeleton Key

A reusable document-checking engine powering two separate apps, built with Kiro for Kiroween 2026 (Skeleton Crew):

- **ScopeCheck** (`apps/scopecheck`): compares supplier quotations against an RFQ.
- **PackCheck** (`apps/packcheck`): checks grant-application packs for completeness and consistency.

Models extract and suggest; deterministic rules produce findings backed by validated evidence.

**Status (2026-11-03).** The haunted interface is built in both apps (see "The haunted interface" below). Earlier status, 2026-11-01: Both apps run in **sample mode** on clearly labelled fictional fixtures: validation, identity resolution, matching, rules, corrections, review decisions and export all run in the browser from fixture inputs (source text plus recorded model claims). ScopeCheck also has an **upload path** (choose an RFQ and quotation PDFs, read on your device, then an explicit Analyse step) that works against an analysis service when one is connected through `VITE_EXTRACTION_API_URL`; none is connected yet, so on this site it explains that analysis is unavailable. Real-document processing at scale is the next engineering milestone (see "Roadmap"). Production admission to the extraction Worker is closed (`DAILY_ADMISSION_CEILING = "0"`) until the limits and the deployed controls are validated.

**Privacy note (planned design):** files will be parsed in the browser, but extracted text is sent to an AI service after you start analysis. Not all processing is local.

## The haunted interface

Two modes, one product. **Lights off** is the haunted presentation (the default); **Lights on** is plain and light, and is chosen automatically when the system asks for reduced motion or more contrast. A choice made with the toggle (first control in the header) is remembered; nothing about the documents is stored.

- **Séance summary** above the ScopeCheck matrix: one sentence per quotation, with the plain counts beside it, built from the same data as the summary and the export. It never says "clean" while anything is uncertain.
- **Evidence side by side**: a difference between two documents shows both source lines with the exact cited words marked (background and outline, not colour alone).
- **Ghost rows**: a missing item stays *Needs review* until you confirm the document's coverage; then it becomes a confirmed finding and its cell turns into a ghost with a one-time flicker (none in Lights on or under reduced motion). "Show the evidence" solidifies it and jumps to the finding.
- **Theme names** are a second name next to the plain wording, in Lights off only and never in exports: ScopeCheck ghost, miscount, curse; PackCheck Lost page, Doppelgänger, Changeling, Bottomless purse.
- Checked in a real browser in both modes at 1280 px and 375 px (`npm run a11y`: axe-core, focus rings, no sideways scroll, no decoration over text, reduced motion). No sound, no third-party code, no image over 20 kB.

| Lights off | Lights on |
| --- | --- |
| ![ScopeCheck, Lights off](docs/screenshots/haunted/scopecheck-lights-off.png) | ![ScopeCheck, Lights on](docs/screenshots/haunted/scopecheck-lights-on.png) |
| ![ScopeCheck ghost row, Lights off](docs/screenshots/haunted/scopecheck-ghost-lights-off.png) | ![ScopeCheck ghost row, Lights on](docs/screenshots/haunted/scopecheck-ghost-lights-on.png) |
| ![PackCheck, Lights off](docs/screenshots/haunted/packcheck-lights-off.png) | ![PackCheck, Lights on](docs/screenshots/haunted/packcheck-lights-on.png) |

## Feature list (from the specs)

<!-- features:start -->
| Spec | Delivered | Open |
|---|---|---|
| `haunted-ui` | 8 | 0 |
| `packcheck-real-documents` | 3 | 3 |
| `scopecheck-real-documents` | 11 | 6 |
| `skeleton-key-foundation` | 35 | 19 |

**haunted-ui** (delivered):
- HU-T0: Visual system, Lights-on behaviour and the palette contrast test
- HU-T0b: Ectoplasm token
- HU-T1: Mode logic and toggle
- HU-T2: Lights on first, then Lights off, across `packages/ui` and both apps
- HU-T3: Theme names, séance summary, ghost rows and possessed cells
- HU-T4: Motifs and effects behind the reduced-motion guard
- HU-T5: Accessibility and visual checks in both modes for both apps
- HU-T6: Theme complete and reviewed; build-log entry; screenshots in the README. Before 30 November.

**packcheck-real-documents** (delivered):
- PC-T1: Pre-registered realistic pack, done 2026-11-01, offline
- PC-T2: (partly) Offline tests with a mock model on PC-T1
- PC-T3: Upload and role assignment

**scopecheck-real-documents** (delivered):
- SC-T1: Pre-register the realistic ScopeCheck documents and expected outputs
- SC-T2: (partly) Offline multi-chunk tests with a mock model on SC-T1
- SC-T3: Browser upload path for ScopeCheck
- SC-T2b: Output-aware chunking
- SC-T4: Live baseline on SC-T1, done 2026-11-01
- SC-T11: Requirement-line identity, multi-item blocks and evidence-empty items
- SC-T4a: Correctness fixes from the saved baseline responses, done 2026-11-01
- SC-T13: Bounded concurrency PREPARED
- SC-T12: Fresh-document validation, live batch run 2026-11-01
- SC-T14: Cell boundaries reach the model, done 2026-11-01 offline
- SC-T15: Second-model comparison on the fresh set, done 2026-11-02

**skeleton-key-foundation** (delivered):
- 1: Scaffold monorepo
- 1.1: npm workspaces, TypeScript, ESLint, Vitest, Tailwind config; root scripts `lint`, `typecheck`, `test`,…
- 1.2: Empty `apps/scopecheck`, `apps/packcheck`, `packages/*`, `services/extraction-api`, `samples/*`,…
- 1.3: GitHub Actions
- 1.4: Engine boundary test and `no-restricted-imports` rule
- 2: Engine core
- 2.1: Types and Zod schemas
- 2.2: Evidence validator with normalisation and code-computed offsets
- 2.3: Value support validators
- 2.4: Effective-value resolution with Corrections preserving originals
- 2.5: Matcher with configurable threshold and decision states
- 2.6: Rule runner, fingerprinting and review-state reopening
- 2.7: Document completeness tracking and needs-review propagation
- 2.8: Export model
- 2.9: Property tests listed in R10.8 using a generic test Adapter
- 3: Extraction Worker with enforced limits
- 3.1: (Durable Object confirmed locally; Rate Limiting binding left optional and unverified) evaluate a…
- 3.2: `/extract` handler
- 3.3: Per-client limit and global daily ceiling; set values from benchmark results, not request count alone
- 3.4: Workers AI call with JSON mode, profile token cap, timeout, at most one counted repair; map quota errors to…
- 3.5: Content-free logging; no persistence or AI caching
- 3.6: Handler tests for every limit and error code
- 4: Fictional samples and expected outputs
- 4.1: Original RFQ + 2 quotes
- 4.2: Original grant pack
- 5.1: Minimal PDF.js Node/browser parser to Blocks with pages and bbox; scanned PDF rejection
- 5.2: (chunker in engine; client bounds via attempt budget and admission ceiling) Chunker and ExtractionClient with…
- 5.3: `tools/benchmark` ran on both sample sets and a layout variant with two candidate models
- 5.4: Results and model/scope decision recorded in `docs/build-log.md` and `docs/model-comparison.md`
- 6: Minimal app shells on labelled fixtures
- 6.1: `packages/ui` primitives
- 6.2: ScopeCheck Adapter
- 6.3: PackCheck grant Adapter
- 6.4: Golden fixture tests
- 6.5: Review interface and exports

**Open:**
- `packcheck-real-documents` PC-T4: Attachment mapping UI with manual remap
- `packcheck-real-documents` PC-T5: Live measurement on PC-T1 within an authorised attempt budget
- `packcheck-real-documents` PC-T6: Live wiring, deployment and end-to-end run; record in the build log
- `scopecheck-real-documents` SC-T5: Foundation task 9 live wiring for ScopeCheck
- `scopecheck-real-documents` SC-T6: Foundation task 5.5 limits and deployment validation
- `scopecheck-real-documents` SC-T7: Deploy ScopeCheck
- `scopecheck-real-documents` SC-T8: 2 to 5 quotations
- `scopecheck-real-documents` SC-T9: DOCX input
- `scopecheck-real-documents` SC-T10: Supplier-specific clarification email drafts
- `skeleton-key-foundation` 5: Live-extraction benchmark
- `skeleton-key-foundation` 5.5: OPEN. Derive and set `DAILY_ADMISSION_CEILING`, `MAX_CHARS`, `MAX_BLOCKS`, `MAX_BLOCK_CHARS` and the profile…
- `skeleton-key-foundation` 7: First deployments
- `skeleton-key-foundation` 7.1: Two Pages projects and the Worker; origins and limits configured
- `skeleton-key-foundation` 7.2: Optional hook
- `skeleton-key-foundation` 7.3: Build log entry for M1 with measured values
- `skeleton-key-foundation` 8: Upload ingestion for both apps
- `skeleton-key-foundation` 9: Live adapter wiring
- `skeleton-key-foundation` 10: End-to-end live run for RFQ + 2 quotes and for the grant pack; extraction/matching/rules measured separately
- `skeleton-key-foundation` 11: Playwright flows with mocked Worker for error codes; axe checks
- `skeleton-key-foundation` 12: Comparison matrix, match confirmation, fact corrections, accept/dismiss/notes, reopen-on-change
- `skeleton-key-foundation` 13: Export
- `skeleton-key-foundation` 14: Calibrate match threshold from fixtures
- `skeleton-key-foundation` 15: Attachment mapping UI with manual remap, grant-field review and corrections on uploads
- `skeleton-key-foundation` 16: Export for grant review with unresolved items marked
- `skeleton-key-foundation` 17: ScopeCheck M5 checks
- `skeleton-key-foundation` 18: DOCX via Mammoth with paragraph/cell refs; 2–5 quotes
- `skeleton-key-foundation` 19: Regression run, accessibility pass, decorative polish if time, README
- `skeleton-key-foundation` 20: Confirm free-tier usage and keep apps available through 29 January 2027

_Generated from `.kiro/specs/*/tasks.md` by `npm run docs:sync`. A ticked task means its tests passed in CI; what was measured and what was not is in `docs/build-log.md`._
<!-- features:end -->

## Layout

| Path | Purpose |
| --- | --- |
| `apps/scopecheck`, `apps/packcheck` | Separate runnable apps |
| `packages/engine` | Domain-neutral engine (must not import app code) |
| `packages/ui` | Components shared by both apps |
| `services/extraction-api` | Cloudflare Worker (extraction profiles, limits, admission counter) |
| `tools/benchmark` | Live-extraction benchmark, model comparison, fixture builder |
| `samples/` | Fictional sample documents (`scopecheck*`, `packcheck*`, realistic and fresh-validation sets with pre-registered labels), `fixtures/` (app inputs), `benchmark-results/` |
| `.kiro/` | Steering and specs (requirements, design, tasks) |
| `docs/build-log.md` | Factual build record |
| `docs/model-comparison.md`, `docs/handoff-task-6.md` | Model decision; Task 6 handoff |
| `docs/reference/scopecheck-build-brief.md` | The original build brief (historical; approved amendments in `.kiro/steering/brief.md` take precedence) |
| `docs/hooks.md`, `docs/reviews/` | Hooks (configured vs actually run); source review and its resolution |
| `.kiro/specs/` | Foundation spec plus focused specs for ScopeCheck, PackCheck and the haunted interface; `README.md` there is the index with introduction dates |

## Commands (Node 20+)

```bash
npm install
npm run dev:scopecheck      # http://localhost:5173
npm run dev:packcheck       # http://localhost:5174
npm run build:scopecheck    # builds independently of PackCheck
npm run build:packcheck     # builds independently of ScopeCheck
npm run preview -w @skeleton-key/scopecheck   # serve the built app on http://localhost:4173 (PackCheck: 4174)
npm run lint && npm run typecheck && npm test && npm run build
npm run a11y                # browser checks of both apps in both modes (build first; needs Playwright's Chromium)
```

## Try the sample mode

1. `npm install`, then `npm run dev:scopecheck` (or `dev:packcheck`) and open the printed address.
2. The amber **SAMPLE MODE** banner is always visible. Nothing is uploaded and no model is called.
3. ScopeCheck: comparison table of RFQ items against each quotation (switch to the free-text sample with the selector). PackCheck: attachment checks and field checks across the pack.
4. Every item with a source shows the cited text highlighted. **Needs review** items and **Not evaluated** comparisons (which did *not* run, with the reason and the blocked input) have their own sections.
5. Try: *Correct this value* on a held value (for example the ambiguous start date in PackCheck), *Accept* or *Dismiss* a finding, *confirm coverage* of a document (an omission only becomes a confirmed finding after that), then *Download CSV / text* (all states are kept) or *Print*.
6. Keyboard: Tab through the page (skip link first), Enter or Space on buttons and links; the correction editor takes focus when it opens, and results are announced to screen readers.

Regenerate the fixtures from the samples with `npm run fixtures -w @skeleton-key/benchmark`. Screenshots: `docs/screenshots/`.

## Roadmap (what is next, in order)

1. Merge PR #4 (samples, benchmark, model decision) and PR #5 (both apps in sample mode, reviewed).
2. **Real documents, multi-chunk first:** original multi-page documents for both apps with expected outputs committed before extraction; upload, chunking, live wiring. A failed or missed chunk can never yield a confirmed absence. Specs: `scopecheck-real-documents`, `packcheck-real-documents`.
3. Production limits (task 5.5) and validation of the Workers AI binding and the deployed Durable Object, before any public access.
4. The shared haunted interface (`haunted-ui`): Lights off (haunted) and Lights on (plain), both with readable evidence, keyboard access, AA contrast and reduced motion.
5. Then 2 to 5 quotations, DOCX and supplier-specific clarification email drafts, before final regression.

Targets: ScopeCheck upload workflow deployed by **22 November**; PackCheck working upload workflow by **29 November**. If scope must shrink, both apps, evidence quality and the review states (Needs review, Not evaluated, coverage) are protected; DOCX, extra quotations, email drafts and decoration go first.

## Measured, not promised

The model (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) was chosen over `@cf/meta/llama-3.1-8b-instruct` by a pre-registered comparison on fictional documents (`docs/model-comparison.md`). The benchmark envelope is single-chunk text PDFs of up to about 400 characters; nothing beyond it is validated. The 70B model misses some extractions (for example one specification in the free-text sample), and the apps show such gaps as Not evaluated rather than hiding them.

## Licence

MIT
