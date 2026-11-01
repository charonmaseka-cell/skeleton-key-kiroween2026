---
inclusion: manual
---

# ScopeCheck Build Brief (reference material)

**Import status (2026-11-01): the original brief text is NOT yet imported.** The attachment reached the agent as the raw bytes of a `.docx` file (a compressed zip), which cannot be read as text, and no copy exists in the workspace. Nothing in this file claims to quote the brief. To import it verbatim, either paste the text into the chat, or commit the file (for example `docs/reference/ScopeCheck-Build-Brief.docx`) and ask for the import. Until then the reconciliation of the project against the brief is **pending**; see "Reconciliation" below.

This file is reference material, loaded on request. The accepted amendments below take precedence over anything in the original brief that conflicts with them. They are recorded here from the project owner's instruction of 2026-11-01.

## Accepted amendments (authoritative)

1. **Stack: React and Vite, deployed on Cloudflare** (Pages for the apps, a Worker with Workers AI and a Durable Object for the extraction service). Superseded stack choices from the original brief are **not** restored.
2. **Validated evidence.** Every value a finding relies on is tied to a cited source span that was found in the document, and the value is checked against that span in code. The model suggests; deterministic rules decide. Accuracy is measured and reported (benchmark), never promised.
3. **Conservative matching and coverage.** A match is verified only by user confirmation or deterministic key agreement. Suggested or ambiguous matches never support a confirmed finding. A successful extraction never proves complete coverage: absences stay Needs review until coverage is confirmed on a completely processed document. Failed or unprocessed chunks can never yield a confirmed absence. Comparisons that could not run are shown as Not evaluated.
4. **Honest sample labelling.** Sample mode is unmistakably labelled and never presented as processing real documents; live mode says that extracted text leaves the device for AI processing. Exports are marked.
5. **Two working applications.** ScopeCheck (RFQ against quotations) and PackCheck (grant-pack completeness and consistency) both work on uploaded documents, on one shared domain-neutral engine. Both are protected scope.

Superseded accuracy promises (for example any fixed accuracy percentage in the original brief) are replaced by measured results in `docs/model-comparison.md` and `docs/build-log.md`.

## Where the amendments live in the project

| Amendment | Foundation spec | Implementation / evidence |
|---|---|---|
| React/Vite, Cloudflare | `design.md` section 1 to 3, R11 | `apps/*`, `services/extraction-api`, `wrangler.toml` |
| Validated evidence | R4 | `packages/engine` (evidence, value support), benchmark rates in `docs/model-comparison.md` |
| Conservative matching and coverage | R2.7, R5.6, R10.10, R4.9 | matcher, coverage, comparison ledger; golden and review-regression tests |
| Honest sample labelling | R9, R8.3 | sample banner, fixture labels, export marker |
| Two working apps | R1, R2, R3 | sample mode today; upload path is the next milestone (`scopecheck-real-documents`, `packcheck-real-documents`) |

## Reconciliation

Pending the import. When the brief text is available the reconciliation will list, requirement by requirement: satisfied, satisfied with an accepted amendment, not yet done (with the spec or task that covers it), or deliberately not done (with the reason). The final submission date and any submission requirements from the brief will be recorded in `.kiro/specs/skeleton-key-foundation/tasks.md` at that point.
