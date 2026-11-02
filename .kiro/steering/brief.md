---
inclusion: manual
---

# ScopeCheck Build Brief (reference) and approved amendments

The original brief is imported verbatim at **`docs/reference/ScopeCheck_Build_Brief.md`** (dated 1 November 2026; the two diagrams are transcribed as text). It is **historical**. Where it conflicts with the approved amendments below, the amendments win. Do not restore superseded proposals from it.

## Submission

- **Deadline: Saturday 5 December 2026 at 00:00 SAST** (Friday 4 December, 22:00 UTC, 14:00 PT). The last working day is 4 December. Everything must be pushed and verified before 22:00 UTC that day.
- Request free Kiro credits early; requests close 1 December at 22:00 SAST.
- The submission period began on **30 October**. **1 November was our chosen build start**, not the start of the period. Disclose any pre-existing work as the brief requires.
- Live app URL kept up until 29 January 2027; public YouTube demo under 3 minutes; project description and Kiro write-up; MIT licence; `.kiro/` committed.

## Approved amendments (authoritative)

1. **Stack:** React, Vite, TypeScript and Cloudflare (Pages, a Worker with Workers AI, a Durable Object) remain the selected stack. Next.js and Vercel in the brief are superseded.
2. **Both applications are protected submission scope.** If a gate slips, cut theme polish, DOCX, extra quotations and extra rules first, never evidence quality or the review states. (The brief says to cut from PackCheck first; that is superseded.)
3. **Evidence and claimed values require code validation.** A cited excerpt must exist in the cited block and the claimed value must be supported by it. An omission cites the requirement and the document examined. No evidence means no finding.
4. **Processing success does not establish coverage.** Uncertainty stays **Needs review** or **Not evaluated**. A failed, unsent or missed chunk can never yield a confirmed absence.
5. **Match scores are suggestions**, not probabilities and not automatic verification. A match is verified only by user confirmation or deterministic key agreement. The brief's 0.7 "confidence" becomes a suggestion threshold.
6. **Accuracy:** keep the current accuracy requirements (foundation R10, including zero false critical findings on known fixtures) and **report measured performance**. Do not promise a one-minute result or a fixed accuracy percentage; the brief's "within a minute", "under 60 seconds" and "90% of planted findings" are not promises here.
7. **Honest labelling:** sample mode is unmistakably labelled and never presented as processing real documents; live mode says extracted text leaves the device.
8. **Hooks:** Kiro Web does not execute hooks. Record **configuration**, **manual command execution** and **genuine hook execution** separately (`docs/hooks.md`). CI in GitHub stays authoritative.

## Reconciliation with the brief (2026-11-01)

| Brief item | Status |
|---|---|
| Upload text PDFs; DOCX | PDF upload path exists for ScopeCheck against a fake service; no real service connected; DOCX scheduled (SC-7) |
| Extract requirements and offers; terms (delivery, payment, warranty) | Items, quantities, specifications, prices, exclusions done; delivery, payment, warranty, validity, arithmetic, unit ambiguity and unrequested extras scheduled (foundation task 17) |
| Match with confidence and reason | Deterministic key agreement plus suggestions; no probability claimed (amendment 5) |
| Findings with side-by-side evidence; comparison matrix; accept, dismiss, annotate | Done in both apps in sample mode; evidence shown per finding |
| Export PDF report; clarification drafts per supplier | Text, CSV and print export done; supplier-specific clarification drafts scheduled (SC-7) |
| Three sample sets | Fictional sets exist (ScopeCheck standard, layout and realistic multi-page; PackCheck pack); the brief's conveyor, pump and PPE sets are not built |
| Haunted UI, lights-on, keyboard, AA | Visual system and AA palettes defined with a test; implementation scheduled (`haunted-ui`) |
| Stack Next.js on Vercel; cache sample results | Superseded; sample mode already runs without a model |
| Five-week plan, ScopeCheck live by 22 Nov, PackCheck by 29 Nov | Adopted as targets (foundation `tasks.md`) |
| Kiro specs, steering, hooks | Specs and steering committed; one hook configured, never executed by Kiro (`docs/hooks.md`) |
| Source documents processed in memory and discarded | Matches the privacy design (R8): no persistence of document content |

Open items from the brief's questions: model provider chosen by measured comparison (`docs/model-comparison.md`); documents are not stored; solo build.
