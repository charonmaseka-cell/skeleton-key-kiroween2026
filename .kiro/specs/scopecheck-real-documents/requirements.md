# ScopeCheck: real-document path and later scope

**Introduced:** 2026-11-01, in PR #5 (`task-6-app-shells`); exact commit recorded in `.kiro/specs/README.md`. Not part of the foundation spec, which is preserved unchanged apart from the plan corrections in its `tasks.md`.

**Reads with:** foundation requirements R2 (ScopeCheck), R4/R4.9 (evidence, held fields), R5 (extraction, matching), R7/R7.6 (review, export), R8 (privacy, limits), R9 (sample path), R10 (measurement), R13 (accessibility). Those are not repeated here.

**Target:** ScopeCheck upload workflow **deployed by 2026-11-22**: RFQ plus two text-PDF quotations, Analyse, review, export, with the admission controls of task 5.5 validated first.

## Requirements

- **SC-1 Upload and analyse.** The user selects an RFQ and two quotations (text PDFs). Files are parsed in the browser (`packages/ingest`); extracted text is sent only after an explicit Analyse; the live banner says extracted text leaves the device; scanned PDFs are rejected with a message. (R4.5, R8.1 to R8.3, R10.9)
- **SC-2 Multi-chunk extraction.** A document that does not fit one chunk is split by `chunkBlocks` within the measured chunk budget. Each chunk has a status. A failed, timed-out, quota-limited or unsent chunk leaves its blocks unprocessed, the document is "processing incomplete", coverage cannot be confirmed, and no absence against it can be confirmed. One manual retry per failed chunk; chunk and call counts stay bounded. (R5.4, R8.8, R10.10; the rule is already enforced in `packages/ui/src/session-core.ts` and must hold on the live path)
- **SC-3 Chunk boundaries.** Facts keep block IDs; evidence offsets are validated per block; the same item extracted twice across a boundary is kept as two facts and compared as `multiple_candidates`, never collapsed to the first.
- **SC-4 Realistic fixtures, registered first.** Original, fictional, multi-page documents: an RFQ of at least three pages and about 25 line items; two quotations of at least three pages each with terms, boilerplate and noise; seeded: at least one quantity mismatch, one specification difference, one exclusion, one absence, an item-code typo trap, an item with two code-like tokens, and free-text lines without delimiters. **Expected outputs are committed before any extraction on these documents**; git history is the evidence. Extraction, matching and findings are scored separately, strictly, with unlabelled claims listed apart. (R10.3, R10.6)
- **SC-5 Honest degraded states.** Quota, limit, timeout and schema errors keep the session and already-extracted documents intact, show a recoverable banner and offer a manual retry; sample mode stays selectable and unmistakably labelled. (R8.10, R9)
- **SC-6 Deployment gate.** Production `DAILY_ADMISSION_CEILING` stays 0 until the Workers AI binding and the deployed Durable Object are validated and task 5.5 limits are derived from realistic-size measurements. (R8.7, R11.5)
- **SC-7 Later scope (after SC-1 to SC-6 work for two quotations; before final regression and submission preparation).**
  - 2 to 5 quotations (R2.1).
  - DOCX input with paragraph and cell references (R4.6; foundation task 18).
  - **Supplier-specific clarification email drafts.** One draft per supplier. It lists only that supplier's items, grouped as Needs review, Not evaluated and confirmed, each with the quoted source text. An unconfirmed omission is worded as a question ("we could not find X in your quotation; please confirm"), never as fact. The user edits the draft; the app offers copy and download only and never sends email (R7.5). Drafts carry the SAMPLE marker in sample mode.
- **SC-8 Known deferred defect.** Two RFQ lines resolving to the same key share ledger ids in the matrix lookup (findings are de-duplicated, so no false result is produced). Fix by treating duplicate keys as uncertain identity.

## Protected scope if the schedule slips

Cut in this order: SC-7 DOCX, then 4 to 5 quotations (keep 2 to 3), then email drafts, never SC-1 to SC-6. Evidence quality, Needs review, Not evaluated and the coverage rules are not negotiable.
