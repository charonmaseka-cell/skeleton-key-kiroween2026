# PackCheck: real-document path

**Introduced:** 2026-11-01, in PR #5 (`task-6-app-shells`); exact commit recorded in `.kiro/specs/README.md`. Not part of the foundation spec.

**Reads with:** foundation requirements R3 (PackCheck), R4/R4.9, R5, R7/R7.6, R8, R9, R10, R13. Shared real-document behaviour (multi-chunk handling, degraded states, deployment gate) is **SC-2, SC-3, SC-5, SC-6 in `scopecheck-real-documents`** and applies here unchanged; it is not repeated.

**Target:** PackCheck **working upload workflow by 2026-11-29**, reusing the ScopeCheck pipeline.

## Requirements

- **PC-1 Upload a pack.** The user uploads the call's requirements, the application form, the budget and organisation documents (text PDFs), assigns each a role (a filename-based suggestion is computed locally and never sent), and presses Analyse. Same privacy statements as SC-1. (R3.1, R8.1 to R8.3)
- **PC-2 Attachment mapping.** Required attachments are mapped to uploaded files and to the titles the form lists, with a manual remap; suggestions are never verified matches; an unmapped requirement stays Needs review unless coverage is confirmed on a completely processed document. (R3.2 to R3.6; foundation task 15)
- **PC-3 One profile family.** `packcheck.grant.v2` for every PackCheck document (measured on all four fixture documents with claims identical to v1 apart from the form's funding scale). A behaviour change is a new profile ID; results record the version. (foundation R8.12)
- **PC-4 Held critical fields.** A rejected, ambiguous or unsupported critical value enters Needs review; every dependent comparison is Not evaluated with reason and blocked input; both appear in the export (R4.9, R7.6). Name comparison keeps legal-form differences visible and never normalised away. (R4.3)
- **PC-5 Realistic fixtures, registered first.** Original, fictional, multi-page pack: an application form of at least four pages with narrative sections, a budget with a line-item table whose total is checked, registration and tax documents. Seeded: an organisation-name inconsistency (one legal-form variant, one real difference), a missing attachment, an ambiguous date, a currency ambiguity, and a funding request below the total budget that must **not** be flagged. **Expected outputs are committed before any extraction.** Extraction, matching and findings are scored separately; the comparison ledger is scored too (how many Not evaluated, and why). (R3.1, R10.3, R10.6)
- **PC-6 Deployment.** Deployed after ScopeCheck, on the same Worker and admission controls (SC-6). **Target 2026-11-29.**

## Protected scope if the schedule slips

PackCheck keeps a working upload for the four core roles (requirements, form, budget, one organisation document), the attachment mapping with manual remap, and every review state. Cut first: additional organisation-document roles, extra rules, polish. If upload cannot ship, the app stays in clearly labelled sample mode and says so; it is never presented as processing real documents.
