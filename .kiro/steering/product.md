# Product: Skeleton Key (Kiroween 2026, Skeleton Crew)

Skeleton Key is a reusable, domain-neutral document-checking engine. Two distinct apps are built on it:

- **ScopeCheck** (`apps/scopecheck`): matches commercial quotations to an industrial RFQ. Finds quantity mismatches, specification differences, exclusions and omissions.
- **PackCheck** (`apps/packcheck`): maps required attachments to actual files in an application pack and checks selected facts across documents.

Both apps are protected scope. If the schedule slips, cut animation, optional formats, extra rules and extra samples before reducing either app below a working demo.

## Core principles

1. **Models extract and suggest; deterministic rules decide.** Findings come from code, never from model prose.
2. **Evidence is validated by code.** A positive evidence excerpt must be verified against extracted source blocks (document ID, block ID, offsets, original text). Model-supplied quotes or page numbers are never trusted.
3. **Unknown stays unknown.** Unknown units, quantities, specs and unpriced exclusions are preserved, never defaulted or guessed.
4. **Needs review is not a finding.** Incomplete extraction or uncertain matching yields "needs review", never a confirmed omission or mismatch.
5. **Omissions cite the requirement** and name the fully processed response that was searched. There is no fabricated quote line.
6. **The buyer stays in control.** Users can confirm or correct extracted facts, accept or dismiss findings, and add notes. No award recommendations.
7. **Honest claims.** Files are parsed in the browser, but extracted text is sent to the model endpoint after the user starts analysis. Never claim all processing is local. Report measured coverage and latency, not universal accuracy.

## Out of scope for the first slice

Paid services, automatic billing, accounts, ERP integration, currency conversion, scanned-document OCR, award recommendations, databases, retained uploaded documents.
