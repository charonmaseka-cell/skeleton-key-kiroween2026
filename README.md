# Skeleton Key

**One open-source document-checking engine, two haunted apps built on it.** Skeleton Key checks a set of documents against what was required, and points to the exact source line behind every gap. A language model only reads the documents; plain code decides what counts as a finding.

Built for **Kiroween 2026**, Skeleton Crew category.

| App | What it checks | Live |
| --- | --- | --- |
| **ScopeCheck** | Supplier quotations against the RFQ they answer: missing items, quantity and specification differences, unclear units, exclusions | https://skeleton-key-scopecheck.pages.dev/ |
| **PackCheck** | A grant application pack: missing attachments, and names, amounts and dates that disagree across documents | https://skeleton-key-packcheck.pages.dev/ |

> *Stop finding out at delivery that the cheapest quote left something out.*

## Try it in 30 seconds

1. Open **ScopeCheck**. A full-length fictional tender and two quotations load at once. They are recorded from one real AI run and replayed, so nothing is sent anywhere.
2. Read **the séance**: what was confirmed, what needs review and what was not evaluated, with plain counts beside it.
3. Click any **Differs** cell in the comparison matrix: both source lines open side by side, with the cited words highlighted.
4. Find a missing item under **Needs review**, then **confirm coverage** of that quotation: only then does it become a confirmed finding (a ghost).
5. **Accept**, **Dismiss** or **Correct** a value; the rules rerun on your device. Then **Export** a CSV, a text report, or a clarification list for each supplier.
6. Open **PackCheck** to see the same engine doing an unrelated job.

Prefer no atmosphere? Press **Lights on**. It's also automatic if your system asks for reduced motion.

## Using your own documents

Expand **Analyse your own documents** at the end of either page.

- **What leaves your device:** files are read in your browser. When you press Analyse, only the *extracted text* is sent to an AI service (Llama 3.3 70B on Cloudflare Workers AI). The original files are never uploaded, and nothing is stored.
- **Limits:** text-layer PDFs up to 5 MB; scanned PDFs are refused. ScopeCheck takes an RFQ and up to two quotations. A small run takes about 30 seconds; full-length documents take minutes.
- **Shared daily allowance:** live analysis runs on a small free budget. Each run is priced before anything is sent; if today's allowance can't cover the whole run, it is refused up front, and the samples keep working.

Use fictional or non-confidential documents.

## How it works

```
 ScopeCheck adapter        PackCheck adapter          each app: schema, rules, labels, theme words
        \                        /
   ┌──────────────── Skeleton Key engine (domain-neutral) ────────────────┐
   │  Ingest → Extract (AI) → Validate evidence → Match → Check (code)   │
   └──────────────────────────────────────────────────────────────────────┘
                                │
      Shared haunted UI: séance, matrix, evidence pane, review, export, Lights on
```

- **The model extracts; code decides.** I don't trust a language model to judge a quotation, so it only reads. Every value it returns must quote text that really exists at the cited block, or it is dropped. Findings come only from deterministic rules.
- **Unknown stays unknown.** An absence is never confirmed until the response is confirmed as fully read. A comparison that can't run is listed as *Not evaluated* with its reason. Ambiguous dates, units and identities are held for you.
- **The engine stays generic.** A test fails if any procurement or grant vocabulary appears in it. PackCheck is about 500 lines on top of the shared engine and UI.
- **Measured, not promised.** On a pre-registered set of three documents with 12 expected findings, the pipeline found 12 of 12 with no false critical and no over-confident finding, first with extraction profile `scopecheck.quote.v1` (1 Nov 2026) and again with `scopecheck.quote.v2` (7 Nov 2026), which also asks for each line's total. One set, one model, two runs; the misses and extraction faults are in [`docs/results/sc-t12-fresh-results.md`](docs/results/sc-t12-fresh-results.md).

## Run it locally

```bash
npm install
npm run dev:scopecheck   # http://localhost:5173
npm run dev:packcheck    # http://localhost:5174
npm test                 # unit and integration tests
npm run a11y             # browser accessibility and visual checks, both apps, both modes
```

Without an extraction service configured, both apps run fully on the bundled samples.

## Built with Kiro

I built Skeleton Key with Kiro, spec first: I wrote down what each part must guarantee, reviewed the requirements and design before any code, and had Kiro implement one small milestone at a time. [`docs/kiro.md`](docs/kiro.md) explains how: four specs, six steering files, two hooks, and a build log of what each milestone delivered.

## Project status

<!-- features:start -->
| Spec | Delivered | Open |
|---|---|---|
| `haunted-ui` | 11 | 0 |
| `packcheck-real-documents` | 4 | 2 |
| `scopecheck-real-documents` | 15 | 2 |
| `skeleton-key-foundation` | 43 | 11 |

**haunted-ui** (delivered):
- HU-T0: Visual system, Lights-on behaviour and the palette contrast test
- HU-T0b: Ectoplasm token
- HU-T1: Mode logic and toggle
- HU-T2: Lights on first, then Lights off, across `packages/ui` and both apps
- HU-T3: Theme names, séance summary, ghost rows and possessed cells
- HU-T4: Motifs and effects behind the reduced-motion guard
- HU-T5: Accessibility and visual checks in both modes for both apps
- HU-T6: Theme complete and reviewed; build-log entry; screenshots in the README. Before 30 November.
- HU-T7: The signature pass
- HU-T8: The bolder pass
- HU-T9: Candlelight

**packcheck-real-documents** (delivered):
- PC-T1: Pre-registered realistic pack, done 2026-11-01, offline
- PC-T2: (partly) Offline tests with a mock model on PC-T1
- PC-T3: Upload and role assignment
- PC-T6: Live wiring, deployment and end-to-end run; record in the build log

**scopecheck-real-documents** (delivered):
- SC-T1: Pre-register the realistic ScopeCheck documents and expected outputs
- SC-T2: (partly) Offline multi-chunk tests with a mock model on SC-T1
- SC-T3: Browser upload path for ScopeCheck
- SC-T2b: Output-aware chunking
- SC-T4: Live baseline on SC-T1, done 2026-11-01
- SC-T5: Foundation task 9 live wiring for ScopeCheck
- SC-T6: Foundation task 5.5 limits and deployment validation
- SC-T7: Deploy ScopeCheck
- SC-T10: Supplier-specific clarification email drafts
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
- 5: Live-extraction benchmark
- 5.1: Minimal PDF.js Node/browser parser to Blocks with pages and bbox; scanned PDF rejection
- 5.2: (chunker in engine; client bounds via attempt budget and admission ceiling) Chunker and ExtractionClient with…
- 5.3: `tools/benchmark` ran on both sample sets and a layout variant with two candidate models
- 5.4: Results and model/scope decision recorded in `docs/build-log.md` and `docs/model-comparison.md`
- 5.5: Done 2026-11-07
- 6: Minimal app shells on labelled fixtures
- 6.1: `packages/ui` primitives
- 6.2: ScopeCheck Adapter
- 6.3: PackCheck grant Adapter
- 6.4: Golden fixture tests
- 6.5: Review interface and exports
- 7.1: Two Pages projects and the Worker; origins and limits configured
- 7.2: Optional hook
- 8: Upload ingestion for both apps
- 9: Live adapter wiring
- 13: Export
- 16: Export for grant review with unresolved items marked

**Open:**
- `packcheck-real-documents` PC-T4: Attachment mapping UI with manual remap
- `packcheck-real-documents` PC-T5: Live measurement on PC-T1 within an authorised attempt budget
- `scopecheck-real-documents` SC-T8: 2 to 5 quotations
- `scopecheck-real-documents` SC-T9: DOCX input
- `skeleton-key-foundation` 7: First deployments
- `skeleton-key-foundation` 7.3: Build log entry for M1 with measured values
- `skeleton-key-foundation` 10: End-to-end live run for RFQ + 2 quotes and for the grant pack; extraction/matching/rules measured separately
- `skeleton-key-foundation` 11: Playwright flows with mocked Worker for error codes; axe checks
- `skeleton-key-foundation` 12: Comparison matrix, match confirmation, fact corrections, accept/dismiss/notes, reopen-on-change
- `skeleton-key-foundation` 14: Calibrate match threshold from fixtures
- `skeleton-key-foundation` 15: Attachment mapping UI with manual remap, grant-field review and corrections on uploads
- `skeleton-key-foundation` 17: ScopeCheck M5 checks
- `skeleton-key-foundation` 18: DOCX via Mammoth with paragraph/cell refs; 2–5 quotes
- `skeleton-key-foundation` 19: Regression run, accessibility pass, decorative polish if time, README
- `skeleton-key-foundation` 20: Confirm free-tier usage and keep apps available through 29 January 2027

_Generated from `.kiro/specs/*/tasks.md` by `npm run docs:sync`. A ticked task means its tests passed in CI; what was measured and what was not is in `docs/build-log.md`._
<!-- features:end -->

## Candlelight, art and font credits

Original SVG art only, listed in `docs/art.md`; no stock photos, no sound. Fonts are self-hosted, each with its licence file beside it in `packages/ui/src/fonts/`: **Pirata One** (SIL OFL 1.1, unmodified) for the app title, and **Special Elite** (Apache License 2.0; a subset, see `packages/ui/src/fonts/README.md`) for the séance card and stage names. Data text stays in the system sans-serif.

## Licence

MIT. All sample documents, companies and amounts are fictional.
