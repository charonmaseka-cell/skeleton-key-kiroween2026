# Implementation Plan

One milestone slice per PR. Checks must pass before each PR. Update `docs/build-log.md` with actual results as tasks complete. Tasks 1 to 6 are done (see the ticks); task 5.5 and everything from task 7 on is not.

## Plan corrections (2026-11-01)

The original task numbering and history above are kept. These corrections reflect what exists and what is next.

**State.** Both apps run end to end in clearly labelled **sample mode** on fictional fixtures (recorded model claims; rules run in the browser). They do **not** yet process an uploaded document. Merged: PRs #1 to #3. PR #4 (Tasks 4 to 5: samples, benchmark, 70B model decision) is ready for review and awaits merge; PR #5 (Task 6) is a draft on top of it and has passed a source review (`docs/reviews/`). Production admission is closed (`DAILY_ADMISSION_CEILING = "0"`).

**Delivery order (next engineering milestone: real documents).**
1. Merge PR #4; rebase PR #5 onto `main`, confirm its base is `main` and its diff is Task 6 only; merge after review.
2. **Real-document path, multi-chunk first** (tasks 8 to 10): original, realistically sized, multi-page documents for both apps, expected outputs committed before extraction; extraction, matching and findings measured separately; a failed or missed chunk can never yield a confirmed absence. Detail: `scopecheck-real-documents`, `packcheck-real-documents`.
3. **Task 5.5 and deployment validation**: limits from bounded inputs, output limits, repairs and measured consumption; Workers AI binding and the deployed Durable Object validated before any public access; admission stays closed until then.
4. **Haunted interface** (`haunted-ui`) as a committed task: visual system and Lights-on behaviour defined; implemented alongside the upload flow; complete before the final submission week; AA, keyboard, readable evidence and reduced motion in both modes.
5. **After the two-quotation PDF path works and before final regression and submission preparation**: 2 to 5 quotations, DOCX, supplier-specific clarification email drafts (`scopecheck-real-documents` SC-7).

**Dates.** ScopeCheck upload workflow **deployed by 2026-11-22**; PackCheck working upload workflow **by 2026-11-29**. **Submission deadline: 5 December 2026, 00:00 SAST** (recorded in `.kiro/steering/brief.md`). The haunted interface (HU-T5) and final regression must be complete before the final submission week.

**If scope must be reduced** (protect both apps, evidence quality and the review states): cut DOCX, then extra quotations beyond three, then email drafts, then haunted effects beyond the Lights-on and Lights-off palettes, then extra rules. Never cut validated evidence, Needs review, Not evaluated, the coverage rules, honest sample and live labelling, keyboard access or AA contrast. PackCheck falls back to four core document roles with attachment mapping; if upload cannot ship it stays in labelled sample mode and says so.

**Finding that changes the plan (2026-11-01).** The benchmark preflight shows the pre-registered 3-page documents cannot be extracted inside 16 attempts: a request returns about 14 values under the 25 s timeout and 1,500-token cap, and character-based chunks hold far more. Next engineering step is output-aware chunking (`scopecheck-real-documents` SC-2b / SC-T2b), then the live measurement; task 5.5 limits must be derived with it. The browser upload path (SC-T3) exists and is tested against a fake Worker; no real Worker is connected and admission stays closed.

**Hooks (task 7.2 refined).** Two planned: rerun golden fixtures when engine or rule code changes (configured, not yet run); run accessibility checks when UI code changes (not configured until the accessibility tests of task 11 exist). `docs/hooks.md` distinguishes configured from actually run. CI in Web stays authoritative.

**Task map.** Task 8 to ScopeCheck then PackCheck uploads (SC-T3, PC-T3); task 9 live wiring (SC-T5, PC-T6); task 10 end-to-end with the realistic fixtures (SC-T4, PC-T5); task 5.5 (SC-T6) and task 7.1 deployment checks come before opening admission; task 11 accessibility and Playwright flows include both haunted modes (HU-T4); tasks 17 to 19 are rescheduled by delivery-order item 5.


## M1: Foundation, Worker limits, live benchmark

- [x] 1. Scaffold monorepo (done; see PR)
  - [x] 1.1 npm workspaces, TypeScript, ESLint, Vitest, Tailwind config; root scripts `lint`, `typecheck`, `test`, `build`. (R1.1, R1.2)
  - [x] 1.2 Empty `apps/scopecheck`, `apps/packcheck`, `packages/*`, `services/extraction-api`, `samples/*`, `tools/benchmark`, `docs/build-log.md` with independent build commands. (R1.1–1.2)
  - [x] 1.3 GitHub Actions: lint, typecheck, test, build both apps. (R11.4)
  - [x] 1.4 Engine boundary test and `no-restricted-imports` rule. (R1.3)
- [x] 2. Engine core (no app code) (done; see PR)
  - [x] 2.1 Types and Zod schemas: Block, Evidence, Fact, Correction, Finding, ReviewDecision. (R4.1)
  - [x] 2.2 Evidence validator with normalisation and code-computed offsets. (R4.2, R4.4)
  - [x] 2.3 Value support validators: money (with magnitude words, currency), date, quantity/unit, name, text. Table-driven tests including "R1.6 million". (R4.3, R6.4)
  - [x] 2.4 Effective-value resolution with Corrections preserving originals. (R4.8)
  - [x] 2.5 Matcher with configurable threshold and decision states. (R5.6)
  - [x] 2.6 Rule runner, fingerprinting and review-state reopening. (R7.3, R7.4)
  - [x] 2.7 Document completeness tracking and needs-review propagation. (R2.7, R3.7)
  - [x] 2.8 Export model (findings, unresolved items, decisions, corrections, notes). (R7.5)
  - [x] 2.9 Property tests listed in R10.8 using a generic test Adapter. (R10.8)
- [x] 3. Extraction Worker with enforced limits (done with mocked inference; see PR)
  - [x] 3.1 (Durable Object confirmed locally; Rate Limiting binding left optional and unverified) evaluate a SQLite-backed Durable Object for atomic request/neuron counters with no content stored; record result in build log. (R8.7, R11.3)
  - [x] 3.2 `/extract` handler: origin allowlist, body size, text length, block count. (R8.6, R8.9)
  - [x] 3.3 Per-client limit and global daily ceiling; set values from benchmark results, not request count alone. (R8.7)
  - [x] 3.4 Workers AI call with JSON mode, profile token cap, timeout, at most one counted repair; map quota errors to `quota_exhausted`. Live JSON-mode behaviour is untested until the benchmark. (R8.8, R8.10)
  - [x] 3.5 Content-free logging; no persistence or AI caching. (R8.4, R8.5)
  - [x] 3.6 Handler tests for every limit and error code. (R8.11)
- [x] 4. Fictional samples and expected outputs (done)
  - [x] 4.1 Original RFQ + 2 quotes (text PDFs) with one quantity mismatch, one spec difference, one exclusion, one absence; expected outputs. (R10.3–10.4)
  - [x] 4.2 Original grant pack (application form, budget, organisation documents) with a missing attachment, org-name inconsistency, an ambiguous date or currency, and a funding < budget pair that must NOT be flagged; requirements list; expected outputs. (R3.1, R10.3)
- [ ] 5. Live-extraction benchmark (comparison and model decision done: 5.1 to 5.4; **production limit derivation remains OPEN: 5.5**). See `docs/model-comparison.md` and `docs/build-log.md`.
  - [x] 5.1 Minimal PDF.js Node/browser parser to Blocks with pages and bbox; scanned PDF rejection. (R4.5, R10.9)
  - [x] 5.2 (chunker in engine; client bounds via attempt budget and admission ceiling) Chunker and ExtractionClient with client bounds (chunks per doc, calls per session, one repair retry). (R5.4, R5.5, R8.8)
  - [x] 5.3 `tools/benchmark` ran on both sample sets and a layout variant with two candidate models (`llama-3.3-70b-instruct-fp8-fast` baseline, `llama-3.1-8b-instruct`), same profiles, chunks, validators and identity resolver; reported requests, time, repairs, measured tokens, estimated neurons, schema/evidence/value-supported rates, recall, misses, safe holds, strict findings. Model selection stays in benchmark configuration (`tools/benchmark/src/candidates.ts`). Deriving production limits is NOT part of this tick: see 5.5. (R10.1)
  - [x] 5.4 Results and model/scope decision recorded in `docs/build-log.md` and `docs/model-comparison.md`: retain the 70B model (the 8B failed the quality bar: 21 vs 1 missed facts; strict findings 3/4 and 2/5 vs 4/4 and 4/5); supported scope = the measured benchmark envelope (single-chunk text PDFs of up to about 400 characters). (R10.2)
  - [ ] 5.5 **OPEN.** Derive and set `DAILY_ADMISSION_CEILING`, `MAX_CHARS`, `MAX_BLOCKS`, `MAX_BLOCK_CHARS` and the profile token caps from measurements on realistic-size documents against the deployed Worker and Durable Object (binding path, 25 s timeout). The benchmark envelope (documents of up to about 400 characters, single chunk, eight documents, one run each) does not support any public ceiling; `DAILY_ADMISSION_CEILING` stays `0`. Dashboard-confirmed consumption (not just per-token prices) is required for the neuron budget. (R8.7, R10.1)
- [x] 6. Minimal app shells on labelled fixtures (done in sample mode; live upload path is task 8)
  - [x] 6.1 `packages/ui` primitives: status badge (text + icon), evidence viewer, banner, review panel; keyboard focus, AA contrast, reduced motion. (R13) Done: `StatusBadge`, `SampleBanner`, `EvidenceView`, `FindingCard`, `ReviewQueue`, `NotEvaluatedList`, `DocumentsPanel`, `ExportPanel`, session logic. Colours are dark-on-light and status is text + icon, but contrast was NOT measured with a tool; automated axe checks are task 11.
  - [x] 6.2 ScopeCheck Adapter (schemas, rules for quantity/spec/exclusion/omission) and minimal page on structured fixtures labelled "Sample (fictional)". (R2.4–2.7, R9) Done: `apps/scopecheck/src/adapter` (shared identity resolver, rules, matching), comparison view, two sample sets.
  - [x] 6.3 PackCheck grant Adapter (rules in design §4) and minimal page on structured fixtures labelled "Sample (fictional)". (R3.2–3.7, R9) Done: `apps/packcheck/src/adapter`, attachment and field checks.
  - [x] 6.4 Golden fixture tests: zero false critical findings. (R10.5) Done: golden tests per app; the known `quote-c` miss is asserted, not hidden.
  - [x] 6.5 Review interface and exports: rejected or held critical fields appear as Needs review items; dependent comparisons show **Not evaluated** with reason and blocked input, in a separate section of the panel and of every export; never rendered as "no difference". Reuse the ScopeCheck identity resolver (`apps/scopecheck/src/adapter/identity.ts`) and the benchmark's comparison ledger shape. (R4.9, R7.6) Done in both apps and in the text/CSV exports.
- [ ] 7. First deployments
  - [ ] 7.1 Two Pages projects and the Worker; origins and limits configured. Keep the endpoint closed to the public until 3.3 limits pass tests. (R11.5, R8.7)
  - [ ] 7.2 Optional hook: rerun golden fixtures on engine rule changes, only if supported; record honestly. (R12.3)
  - [ ] 7.3 Build log entry for M1 with measured values. (R12.2)

## M2: Real document path

- [ ] 8. Upload ingestion for both apps (text PDF), explicit Analyse step, mode banner "Live: extracted text sent to AI service". (R3.1, R8.1–8.3)
- [ ] 9. Live adapter wiring: Zod validation, evidence and value-support validation, session extraction reuse, quota/limit banners with manual retry and intact session. (R4, R5.2, R8.10)
- [ ] 10. End-to-end live run for RFQ + 2 quotes and for the grant pack; extraction/matching/rules measured separately. (R10.6)
- [ ] 11. Playwright flows with mocked Worker for error codes; axe checks. (R13)

## M3: ScopeCheck completion
- [ ] 12. Comparison matrix, match confirmation, fact corrections, accept/dismiss/notes, reopen-on-change. (R2.3, R7.1–7.4)
- [ ] 13. Export (CSV, text, print/PDF) with unresolved items marked. (R7.5)
- [ ] 14. Calibrate match threshold from fixtures. (R5.6)

## M4: PackCheck completion
- [ ] 15. Attachment mapping UI with manual remap, grant-field review and corrections on uploads. (R3.2–3.6, R7)
- [ ] 16. Export for grant review with unresolved items marked. (R7.5)

## M5: Later checks and submission
- [ ] 17. ScopeCheck M5 checks: delivery lead time and Incoterm differences; changed payment terms; missing or shorter warranty; arithmetic inconsistencies with a clear quantity/price/discount/tax/rounding basis. Unclear terms stay Needs review. (R2.9, R6)
- [ ] 18. DOCX via Mammoth with paragraph/cell refs; 2–5 quotes. (R4.6, R2.1)
- [ ] 19. Regression run, accessibility pass, decorative polish if time, README (accurate privacy statement), setup guide, demo video showing the real document-processing path in both apps. (R3.1, R8.3, R13.4)
- [ ] 20. Confirm free-tier usage and keep apps available through 29 January 2027. (R11.2)

**Status: Tasks 1 to 4 complete; Task 5 harness built and mock-tested. Live benchmark in progress (needs Cloudflare credentials in sandbox secrets).**
