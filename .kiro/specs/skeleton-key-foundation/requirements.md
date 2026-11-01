# Requirements: Skeleton Key Foundation

## Introduction

Skeleton Key is a generic document-checking engine. Two distinct apps run on it: **ScopeCheck** (RFQ-to-quotation comparison) and **PackCheck** (grant-application completeness and consistency). Models extract and suggest matches; deterministic rules produce findings; every critical value and positive finding is backed by code-validated evidence.

Planning inputs: the Kiro Handoff (amendments take precedence) and the ScopeCheck Build Brief (not in the repository; only the Handoff text has been available, so brief-only requirements are not captured).

## Glossary

- **Engine**: `packages/engine`, domain-neutral.
- **Block**: an addressable unit of extracted source text (PDF text run on a page; DOCX paragraph or table cell).
- **Evidence**: a reference (document ID, block ID, offsets, original text) validated against Blocks.
- **Fact**: an extracted value (e.g. quantity, amount, date) with its cited Evidence.
- **Finding**: a deterministic rule output (mismatch, omission, missing attachment, inconsistency).
- **Needs review**: state for uncertain matches, ambiguous or missing values, or incomplete extraction. It is not a Finding of fact.
- **Correction**: a user-supplied replacement for a Fact. The original Fact and Evidence are preserved.
- **Sample path**: processing of a bundled, original, fictional sample using clearly labelled structured fixtures or prevalidated cached extraction.
- **Adapter**: domain-specific schemas, rules and labels supplied to the Engine by an app.

---

## Requirements

### R1. Repository structure and engine independence
**User story:** As a judge or maintainer, I want two separate apps visibly sharing one generic engine.

1. THE repository `charonmaseka-cell/skeleton-key-kiroween2026` SHALL contain `apps/scopecheck`, `apps/packcheck`, `packages/engine`, `packages/ui`, `services/extraction-api`, `samples/scopecheck`, `samples/packcheck`, `docs/build-log.md` and a root `.kiro/` directory.
2. EACH app SHALL have its own entry point, configuration and build command, and SHALL build and run independently.
3. THE Engine SHALL NOT import from any `apps/*` path or contain domain-specific logic; an automated check SHALL enforce this.
4. THE Engine SHALL accept both Adapters through the same interface.
5. `packages/ui` SHALL contain only components used by both apps.
6. Repository documentation SHALL stay concise: clarifications update existing files rather than adding per-topic reports.

### R2. ScopeCheck: RFQ-to-quotation comparison
**User story:** As a buyer, I want quotations compared against an RFQ, with evidence.

1. THE app SHALL accept one text-based PDF RFQ and two text-based PDF quotations (two to five quotes is a later expansion).
2. THE app SHALL extract RFQ requirements and quote offers (item, quantity, unit, specification, price, exclusions) with source Block IDs.
3. THE app SHALL show a comparison matrix of requirements against each quote.
4. WHEN a requirement has a validated matching offer with a differing quantity or specification, THE rules SHALL emit a Finding citing both RFQ and quote Evidence.
5. WHEN a requirement has no match in a fully processed quote, THE rules SHALL emit an omission Finding citing the RFQ requirement and naming the quote examined, with no fabricated quote evidence.
6. WHEN a quote states an exclusion, THE app SHALL report it; an exclusion with no stated price SHALL remain "unpriced".
7. WHEN extraction of a quote is incomplete or a match is uncertain, THE app SHALL mark the item **Needs review** and SHALL NOT emit a confirmed omission or mismatch. Successful processing of every chunk does not prove the model extracted every item: an unmatched requirement SHALL stay **Needs review** until coverage of that quote is verified or explicitly confirmed by the user.
8. THE app SHALL NOT produce award recommendations or supplier rankings.
9. LATER MILESTONES (M5) SHALL add: delivery lead-time and Incoterm differences; changed payment terms; missing or shorter warranty coverage; and arithmetic inconsistencies where quantities, prices, discounts, tax and rounding give a clear calculation basis. Each SHALL follow R4 and R6, and unclear terms SHALL remain **Needs review**.

### R3. PackCheck: grant-application completeness and consistency
**User story:** As a grant reviewer, I want required attachments mapped to files and key facts compared across documents.

1. THE acceptance sample SHALL be one original fictional grant-application pack with its requirements list. The application's supported inputs SHALL NOT be limited to that sample: PackCheck SHALL accept user-uploaded documents (text-based PDF first, DOCX later) for the same checks. The final submission SHALL demonstrate this real document-processing path; early milestones MAY run on clearly labelled structured fixtures.
2. THE app SHALL map each required attachment to an actual file, or report it missing, citing the requirement and listing the files examined.
3. THE app SHALL extract and check: organisation name, funding requested, currency, total project budget and project start and end dates.
4. THE app SHALL compare equivalent fields across documents (e.g. organisation name in the form versus the budget; funding requested in the form versus the budget summary; currency; project dates) and report inconsistencies with Evidence from each file. These cross-file checks are the core PackCheck behaviour and SHALL NOT be replaced by the funding-versus-budget check in item 5.
5. Non-equivalent fields SHALL NOT be flagged as inconsistent: funding requested (e.g. R1.6 million) differing from total project budget (e.g. R2 million) is not by itself a Finding. As an additional rule, PackCheck MAY check that funding requested does not exceed the total budget, only when both values are validated and share a currency.
6. WHEN a value is missing, ambiguous, in differing currencies or unsupported by its source, THE app SHALL mark it **Needs review** and SHALL NOT emit a confirmed Finding.
7. WHEN a file cannot be fully extracted or a mapping is uncertain, THE app SHALL mark it **Needs review**.
8. PackCheck SHALL use the shared Engine without a copy of ScopeCheck's procurement logic.

### R4. Evidence and value validation
**User story:** As a user, I want every cited value to be genuinely supported by its source.

1. THE Engine SHALL retain, per Evidence item, the document ID, Block ID, character offsets and original text.
2. THE Engine SHALL verify that each model-supplied excerpt exists in the cited Block. Offsets SHALL refer to the original block text (normalisation of whitespace or hyphens SHALL keep a mapping to original characters), and the stored excerpt SHALL equal the original text slice at those offsets. Excerpts not found SHALL be rejected.
3. THE Engine SHALL also verify that each critical Fact's value is supported by its cited excerpt (e.g. the normalised amount, date, quantity or name can be parsed from that text). Unsupported values SHALL be rejected or marked **Needs review**. WHERE an excerpt contains several plausible amounts, dates or quantities, the field SHALL be identified by enough context (a field label); otherwise the value SHALL stay **Needs review**. Differences in organisation names that are not purely case, punctuation or spacing SHALL be preserved, not normalised away.
4. WHEN a source Block is missing or validation fails, THE Engine SHALL NOT produce an evidence-backed confirmed Finding for it.
5. FOR PDFs, THE Engine SHALL retain page numbers and text coordinates where PDF.js provides them.
6. FOR DOCX (after the PDF path works), THE Engine SHALL use paragraph or table-cell references and SHALL NOT invent page numbers.
7. THE UI SHALL NOT present reflowed extracted lines as original document lines.
8. WHEN a user Corrects a Fact, THE system SHALL preserve the original Fact and Evidence alongside the Correction and SHALL mark the value as user-supplied. Findings and exports that depend on it SHALL identify it as user-supplied and SHALL NOT present the original evidence as supporting the corrected value.

### R5. Extraction and matching
**User story:** As a developer, I want model use isolated and bounded.

1. THE system SHALL use a provider interface; the first provider SHALL be Workers AI behind `services/extraction-api`.
2. THE system SHALL reuse each document's validated extraction for the rest of the session, and MAY issue multiple chunk requests to extract one document. Extraction SHALL be repeated only when the user changes or re-uploads the document or explicitly retries a failed extraction.
3. User Corrections and match confirmations SHALL rerun matching-dependent rules locally and SHALL NOT call the model unless extraction itself must be repeated.
4. THE system SHALL validate all model output with Zod; on invalid JSON it SHALL perform at most one controlled retry per chunk, then show a recoverable error.
5. THE system SHALL chunk documents within the model's context and output limits.
6. Match confidence thresholds (initially 0.7) SHALL be treated as uncalibrated heuristics until measured against fixtures; scores SHALL NOT be presented as probabilities. A score above the threshold alone SHALL NOT establish a verified match; verification requires user confirmation or deterministic key agreement, and uncertain matches SHALL remain reviewable.
7. Rule execution SHALL NOT depend on the model provider.

### R6. Deterministic rules and arithmetic
1. ALL money and quantity arithmetic SHALL use decimal arithmetic.
2. Arithmetic checks SHALL account for explicitly stated discounts, rounding, tax treatment and pack quantities.
3. IF the calculation basis is not justified by the documents, THEN no mismatch SHALL be reported.
4. Unknown units, quantities or specifications SHALL remain unknown; an unknown unit SHALL NOT yield an exact unit-price comparison.
5. No currency conversion SHALL be performed; values in differing currencies SHALL NOT be compared numerically.

### R7. User review and export
**User story:** As a user, I want to correct, decide and annotate, and export an honest record.

1. THE user SHALL be able to confirm or correct critical Facts and uncertain matches.
2. THE user SHALL be able to accept or dismiss each Finding and add a note.
3. WHEN a Fact or match changes, THE rules SHALL rerun on the updated inputs (see R5.3).
4. A Finding's identity SHALL include its comparison context and response document, so the same item missing from two responses yields two findings with independent decisions. A Finding's fingerprint SHALL include the rule version, relevant evidence and validation state, coverage and effective inputs. IF any of these change, THEN that Finding SHALL be reopened for review and SHALL NOT carry forward its earlier accepted or dismissed status; the earlier decision and note SHALL stay in the history.
5. Exports (CSV, plain-text draft, and PDF via print or jsPDF) SHALL include unresolved **Needs review** items, clearly marked, alongside confirmed Findings, user decisions, Corrections and notes. THE app SHALL NOT send email.

### R8. Privacy, limits and quota handling
**User story:** As a user handling confidential documents, I want accurate privacy statements and a protected service.

1. Files SHALL be parsed in the browser; original files SHALL NOT be uploaded to the app server.
2. Extracted text SHALL be sent to the model endpoint only after the user explicitly starts analysis.
3. THE UI and README SHALL state that extracted text leaves the device for AI processing and SHALL NOT claim all processing is local.
4. Original filenames and document content SHALL NOT appear in application or Worker logs.
5. THE system SHALL NOT use persistent AI caching, content logging, a database or uploaded-file storage for user documents; session state SHALL be in memory only.
6. THE Worker SHALL enforce, server-side, a documented maximum request body size and maximum text length per request, rejecting larger inputs with a defined error before calling the model.
7. THE Worker SHALL enforce a documented per-client request limit and a global daily request ceiling, returning a defined rate-limit error that the UI shows as recoverable. Client-side limits alone SHALL NOT satisfy this requirement. Usage counters SHALL be atomic and SHALL store no document content or filenames; a SQLite-backed Durable Object (available on Workers Free) SHALL be evaluated for this. A request-count ceiling does not by itself keep model usage within the neuron allowance, so ceilings and size limits SHALL be set from benchmark measurements.
8. THE system SHALL bound retries: at most one JSON-repair retry per chunk, a fixed maximum number of chunks per document, and a maximum total model calls per session; no unbounded or automatic retry loops.
9. THE Worker SHALL accept requests only from the deployed app origins (CORS allowlist) and SHALL return generic error bodies without echoing input. The origin allowlist is an additional control, not authentication.
10. WHEN free inference quota is exhausted or the model is unavailable, THE system SHALL return a distinct error, tell the user that analysis is temporarily unavailable, keep the session data and any already-extracted documents intact, and SHALL NOT fall back silently to cached or partial findings.
11. Each limit SHALL have an automated test that exercises the Worker handler.
12. THE Worker SHALL accept only a schema ID from a server allowlist; prompts, model and output limits SHALL be server-controlled, and document text SHALL be treated as data, not instructions. Request limits SHALL apply to actual bytes read, not only to Content-Length; preflight SHALL NOT invoke the model; every inference attempt, repairs included, SHALL be admitted by the counter before the model is called, SHALL NOT be refunded, and SHALL fail closed if the counter is unavailable. Quota exhaustion, model unavailability, timeout, invalid input and rate limiting SHALL be distinct errors.

### R9. Sample path
1. ONLY original fictional bundled samples MAY use structured fixtures or prevalidated cached extraction.
2. THE UI SHALL clearly label sample-path processing.
3. Matching and rules SHALL rerun whenever inputs or rules change; cached findings SHALL NOT be substituted.
4. Uploaded user documents SHALL NEVER be served from the sample cache.
5. Weak live extraction SHALL NOT be hidden behind the cache.

### R10. Quality measurement and live-extraction benchmark
1. BEFORE the full interface is built, a benchmark harness SHALL run the real extraction path (PDF parsing, Worker, model, Zod and evidence validation) on the fictional RFQ and two quotes, and on the fictional grant pack, and SHALL report: request count, elapsed time, neurons or token consumption where available, schema-valid rate, evidence-valid rate and value-supported rate.
2. THE benchmark outcome SHALL decide the model choice and whether to simplify document scope; the result SHALL be recorded in `docs/build-log.md`.
3. ScopeCheck fixtures SHALL include one quantity mismatch, one specification difference, one exclusion and one absence. PackCheck fixtures SHALL include a missing attachment, an organisation-name inconsistency, a currency or date ambiguity, and a funding-versus-budget pair that is correctly NOT flagged.
4. Fixtures SHALL be original and fictional, with expected outputs.
5. KNOWN fixtures SHALL produce zero false critical Findings.
6. Extraction, matching and rule behaviour SHALL be measured separately; coverage and latency SHALL be reported as measured values, not promises.
7. Deterministic fixture tests (Vitest) SHALL be separate from optional live-model checks.
8. Property tests SHALL cover: reordering quote lines leaves the substantive comparison unchanged; unknown unit never yields an exact unit-price comparison; a missing source block prevents an evidence-backed confirmed Finding; a failed extraction never becomes a confirmed omission; a Correction that changes a Finding reopens it; the Engine accepts both Adapters with no domain imports.
9. Unsupported inputs (e.g. scanned PDFs) SHALL be rejected with an explicit message.

### R11. Cost, accounts and hosting
1. THE end-user experience SHALL require no accounts or login. Developer accounts for GitHub and Cloudflare are expected.
2. THE solution SHALL stay within GitHub Free, Cloudflare Pages/Workers free plans and Workers AI free allowances, with no automatic billing, and SHALL handle quota exhaustion per R8.10.
3. THE design SHALL identify any component that could exceed free allowances and SHALL flag it before adoption.
4. GitHub Actions SHALL run lint, type-check and Vitest on standard runners.
5. Both apps SHALL be deployable as separate Cloudflare Pages projects.

### R12. Kiro usage and records
1. `.kiro/` SHALL remain at the repository root with the real steering, specs and supported hooks.
2. `docs/build-log.md` SHALL record only actual Kiro tasks, tests and decisions.
3. Hooks SHALL be created only where supported; none SHALL be claimed as run unless it ran.

### R13. Accessibility (first interface work)
1. ALL interactive controls and the evidence viewer SHALL be keyboard operable with visible focus.
2. TEXT and status indicators SHALL meet WCAG AA contrast, and status SHALL NOT rely on colour alone.
3. ANIMATION SHALL respect `prefers-reduced-motion`; essential function SHALL NOT depend on animation.
4. Decorative polish MAY follow in a later gate.

---

## Scope by milestone

- **M1 (foundation):** monorepo scaffold, CI, engine core, both apps' minimal shells on labelled structured fixtures, Worker with enforced limits, live-extraction benchmark, first deployments.
- **M2 (real document path):** PDF.js ingestion, validated evidence and value support, live model adapter, one RFQ + two quotes and one grant pack end to end from uploads.
- **M3 (ScopeCheck):** matrix, review, corrections, export.
- **M4 (PackCheck):** attachment mapping, grant-field checks on uploads, review, export.
- **M5 (later checks and submission):** delivery, payment, warranty and arithmetic checks; DOCX; 2–5 quotes; regression, setup guide, demo video. Final submission shows the real document-processing path in both apps.

## Risks and constraints

1. Build Brief text is not in the repository; brief-only requirements are uncaptured.
2. Workers Free (10 ms CPU per invocation) and Workers AI (10,000 neurons/day) may not support a 70B model across multi-page documents; the benchmark (R10.1) decides.
3. Workers AI data terms apply to submitted text; Gemini free tier may use content for product improvement and is unsuitable for confidential documents.
4. Server-side rate limiting on the free plan must be verified during design (see design.md); fall back to a documented stricter ceiling if unavailable.
5. Hook support in Kiro Web is unverified; CI is the authoritative check.
6. The 0.7 match threshold is uncalibrated; "zero false critical findings" applies to known fixtures only.
