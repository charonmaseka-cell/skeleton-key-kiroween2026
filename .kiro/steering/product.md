# Product: Skeleton Key (Kiroween 2026, Skeleton Crew)

Skeleton Key is a reusable, domain-neutral document-checking engine. Two distinct apps are built on it:

- **ScopeCheck** (`apps/scopecheck`): matches commercial quotations to an industrial RFQ. Finds quantity mismatches, specification differences, exclusions and omissions.
- **PackCheck** (`apps/packcheck`): grant applications first. Maps required attachments to files and compares organisation name, funding requested, currency, total project budget and project dates across documents. Funding requested and total budget are different fields: R1.6m vs R2m is not an inconsistency by itself. Cross-file equivalent-field checks are primary; a funding-exceeds-budget check is additional only. Must accept uploaded documents, not just its bundled sample.

Both apps are protected scope. If the schedule slips, cut animation, optional formats, extra rules and extra samples before reducing either app below a working demo.

## Core principles

1. **Models extract and suggest; deterministic rules decide.** Findings come from code, never from model prose.
2. **Evidence is validated by code.** A positive evidence excerpt must be verified against extracted source blocks (document ID, block ID, offsets, original text). Model-supplied quotes or page numbers are never trusted.
3. **Unknown stays unknown.** Unknown units, quantities, specs and unpriced exclusions are preserved, never defaulted or guessed.
4. **Needs review is not a finding.** Incomplete extraction or uncertain matching yields "needs review", never a confirmed omission or mismatch.
5. **Corrections preserve originals.** A user correction keeps the original fact and evidence; a correction that changes a finding reopens it. Validate that each critical value is supported by its cited source, not just that the quote exists.
5a. **Omissions cite the requirement** and name the fully processed response that was searched. There is no fabricated quote line.
6. **The buyer stays in control.** Users can confirm or correct extracted facts, accept or dismiss findings, and add notes. No award recommendations.
7. **Honest claims.** Files are parsed in the browser, but extracted text is sent to the model endpoint after the user starts analysis. Never claim all processing is local. Report measured coverage and latency, not universal accuracy.

## Out of scope for the first slice

Paid services, automatic billing, accounts, ERP integration, currency conversion, scanned-document OCR, award recommendations, databases, retained uploaded documents.

## Quality bars
- Labelled structured fixtures are allowed early; the final submission must demonstrate the real document-processing path in both apps.
- Unresolved Needs-review items appear in exports, marked, with confirmed findings, decisions and notes.
- No end-user accounts or login. Developer GitHub/Cloudflare accounts only.
- Keyboard access, AA contrast and reduced-motion support from the first interface work; decorative polish later.
