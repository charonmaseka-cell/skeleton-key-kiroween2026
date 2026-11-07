# Two review apps on a shared engine and UI, running fixture rules in the browser

Adds ScopeCheck (RFQ vs quotations) and PackCheck (grant pack consistency) as React/Vite apps over `packages/engine` (comparison ledger, export model and renderers) and `packages/ui` (session, workspace, badges). Everything runs client-side on fictional fixtures; corrections, review decisions and coverage confirmation live in an in-memory session that feeds a CSV/text export. The ledger and the Not-evaluated list are the right shape for honest states, but several paths still let a comparison disappear, or a confirmed finding rest on something the reviewer cannot see.

Watch for: (1) an RFQ item whose extraction is held is dropped from every check with no finding and no ledger entry (confirmed, ran it); (2) correcting an RFQ item leaves a stale identity in the suggestion path, so a present quote line becomes a **confirmed** omission once coverage is confirmed (confirmed, ran it); (3) absence is concluded while an unvalidated candidate line exists in the response (confirmed by code); (4) a second fact for the same field in the same block is silently ignored and the comparison reports "agrees" (confirmed on the layout fixture); (5) money correction turns `1,5` into 15 (confirmed, ran it); (6) coverage confirmation, a one-click self-attestation that flips absences to confirmed, is not recorded in the export.

**Verdict**: NEEDS_CHANGES

## High-level view

Both apps record `agree`, `flagged` or `not_evaluated` per planned comparison, and Not evaluated is kept apart from "no difference". The gaps are in what gets *planned*. Both adapters filter out unvalidated or duplicate facts before planning, so an item can fall out of the ledger instead of landing in Not evaluated. PackCheck's missing-counterpart cases are silent where ScopeCheck's are recorded.

Absence handling is guarded by coverage, but coverage is a single button per document, never undone, absent from the export, and does not account for held candidates or near-matching titles. Once pressed, absences become confirmed findings.

Corrections preserve the original and carry a user-supplied badge in the review cards, but the identity resolver is keyed on pre-correction facts, the comparison matrix and check tables show corrected values unlabelled, and the money parser can silently change magnitude.

Shared UI state is not scoped to the fixture, so open editors and draft notes carry over when the sample set changes. Keyboard access is mostly native controls, but focus is dropped after several actions and repeated buttons and links have no distinguishing names.

No network calls, storage APIs or raw-HTML sinks were added. The CSV formula guard covers the OWASP leading characters.

<details>
<summary>Issues (17)</summary>

1. **Held RFQ item dropped from all checks (high)** — `scopeMatches`/`evaluateScope`/`buildMatrix` filter RFQ lines to usable items, so a held RFQ item produces no finding, no ledger entry, no matrix row. Emit `item.unverified` for RFQ items and a `not_evaluated` entry per quote.
2. **Stale identity after correcting an item (high)** — `lexicalCandidate` looks up identity by fact ID regardless of provenance. Skip identity lookups for user-supplied facts, or recompute identity for corrected values.
3. **Absence concluded despite held candidate lines (high)** — held quote items and held "attachment provided" titles are excluded from matching, so `item.absent` / `attachment.missing` can be confirmed while an unvalidated candidate exists. Downgrade to `needs_review` when the response has any non-usable candidate of that field.
4. **Second fact per field per block ignored (high)** — `linesOf` keeps the first fact (`??=`); PackCheck uses `[0]`. Plan a comparison for every fact, or mark the extra fact Not evaluated; never report "agrees" with unused facts.
5. **Money parser strips commas (high)** — `1,5` becomes 15, `1 600,50` becomes 160050. Reject comma-decimal input or ask which separator was meant.
6. **Coverage confirmation absent from export (medium)** — export shows confirmed absences with no mention that coverage was self-attested. Add per-document coverage state to the export model and renderers.
7. **Coverage confirmation irreversible; chunks hard-coded ok (medium)** — no un-confirm; `processing_incomplete` can never occur in the app. Add an undo action; let fixtures declare chunk status.
8. **PackCheck ledger silent when counterpart fact missing (medium)** — no comparison planned if the other document lacks the field; `funding_within_budget` skipped when the budget fact is missing. Record `not_evaluated` with `no_fact`, as ScopeCheck does.
9. **Corrected values shown unlabelled in matrix and check tables (medium)** — `detail` strings and the "Requested" column use effective values; "Agrees" can hinge on a typed value. Add a user-supplied marker to ledger entries and render it.
10. **Fixture switch leaks component state (medium)** — both ScopeCheck fixtures share doc ID `rfq` and fact IDs, so open editors and note drafts carry across. Key the workspace on `fixture.id`.
11. **Currency prefilled with ZAR (medium)** — correcting a non-ZAR amount keeps ZAR unless the user notices. Prefill from the original value.
12. **Specification difference confirmed on token inequality (medium)** — `SS316` vs `316 stainless steel` becomes a confirmed `spec.differs`. Emit `needs_review` unless the token difference is clear-cut, or label it as text difference.
13. **PackCheck exact-title match (medium)** — wording variants become a confirmed missing attachment once the form's coverage is confirmed. Add lexical suggestions as ScopeCheck does.
14. **Focus lost after actions (medium)** — Save correction, Revert, and Confirm coverage unmount the focused control. Move focus to a stable target.
15. **Repeated button and link names (medium)** — Correct this value, Accept/Dismiss/Reopen, "Open the finding"/"Open the item" have no item context. Add `aria-label` or `aria-describedby`.
16. **Stale note after reopen; repeated announcements (low)** — note input keeps the old note after a reopen; identical live-region text is not re-announced. Reset the note on reopen; make announcements unique.
17. **Reverted corrections vanish from export; money display mangles long decimals (low)** — keep reverted corrections in history; use one `showValue` and fix the digit-grouping regex.

</details>

<details>
<summary>Details</summary>

## RFQ items with held extractions vanish from ScopeCheck

*high, confirmed (reproduced).* `scopeMatches` (`apps/scopecheck/src/adapter/rules.ts:97`) and `evaluateScope` (`:127`) both start from `linesOf(...).filter((l) => usable(l.f.item))`, and `buildMatrix` skips `!item?.usable` (`ComparisonMatrix.tsx:25`). The quote side has an `item.unverified` finding (`rules.ts:192-198`); the RFQ side has none. Setting the Motor starter RFQ claim in the standard fixture to a value not in its excerpt (the fact becomes `needs_review`) yields no finding mentioning MS-20, no ledger entry, and no matrix row. The summary bar still reads as a complete run.

Fix: mirror the quote-side branch for the RFQ: emit `item.unverified` and one `not_evaluated` per quote and aspect with `blocked: { docId: rfq, field: 'item', factId }`, and show the row in the matrix.

## Correcting an item leaves a stale identity in the suggestion path

*high, confirmed (reproduced).* Identity is resolved on `originalFacts` (`adapter/index.ts:233`). `itemIdentityKey` guards this with `provenance === 'document'`, but `lexicalCandidate` (`rules.ts:86-89`) reads `ids.get(rfqItem.fact.id)` without that check. Scenario in the standard fixture: correct the RFQ "Motor starter" item to the text `Motor starter` (key `MOTOR STARTER`), then confirm coverage of both quotes. The quote lines carry code `MS-20`; the keys no longer agree; the stale RFQ identity is still `code MS-20`, so the "two firm codes never suggest" guard (`:89`) returns null, no suggestion is made, the match is `none`, and the result is `confirmed item.absent MOTOR STARTER` for quote-a and quote-b. Without the correction, the same coverage confirmation produces no absence. The only thing that changed was the user's edit, and the app now states a confirmed omission for a line that is plainly in the quote.

Fix: in `lexicalCandidate`, treat a user-supplied item as having no identity (`a = undefined`) so the overlap heuristic can suggest and the match becomes unresolved. A stronger fix is to resolve identity for effective facts, including corrected values, and to apply the multiple-code check to user-supplied text. `itemKey`'s unanchored regex also picks the first code-like token of a typed value (`Pump SANS-1200` keys on `SANS-1200`).

## Absence concluded while an unvalidated candidate exists

*high, confirmed by code (not run).* ScopeCheck matching considers only usable quote lines (`rules.ts:100`); PackCheck matching considers only usable `attachment_title` facts on the form (`packcheck/.../rules.ts:35`). A quote line or form attachment whose item/title fact is held is not a candidate, yet is visible in the same document. Once the reviewer confirms coverage, `concludeAbsence` returns confirmed, and the app states "not in this quotation" or "attachment missing" while also, for ScopeCheck, listing an `item.unverified` finding for the line that may be that item. Coverage confirmation says the extraction found everything it could; it does not say the held candidate is unrelated.

Fix: if the response document has any non-usable fact of the matching field (or an unresolved suggestion), keep the absence at `needs_review` with a reason such as `held_candidate_in_response`.

PackCheck has a related path: matching is exact on normalised title only and has no lexical suggestion (ScopeCheck has one). "Audited financial statement" against "Audited financial statements" is a confirmed `attachment.missing` after the form is marked checked. Add suggestions, or state the exactness in the finding text.

## Duplicate facts per field are silently collapsed

*high, confirmed on the layout fixture.* `linesOf` keeps the first fact per field per block (`rules.ts:33`, `line.f[e.fact.field] ??= e`). `scopecheck-layout` quote-c block `p1-l4` has two `specification` facts (`0-10 bar range`, `certified to SANS-1200`). Only the first is compared; the second has no ledger entry, no finding and no way to reach it from a finding card, so a reviewer cannot correct it. If extraction order flips, the comparison would run against the SANS text and report a confirmed `spec.differs`. The row reads "Agrees" with an unexamined spec beside it. PackCheck has the same pattern with `factsOf(...)[0]` for the form anchor and the funding fact (`rules.ts:87`, `:135`).

Fix: when more than one fact exists for a field in a line, either compare against each (distinct ledger IDs) or mark the comparison Not evaluated with reason `multiple_candidates`. Ledger IDs are also not unique when two RFQ lines share a key, or two requirements normalise alike, which collides React keys and `find` lookups in the matrix.

## Money parsing changes magnitude

*high, confirmed (reproduced).* `parseCorrection` removes spaces and commas from money (`session-core.ts:163`). `1,5` becomes `15` and `1 600,50` becomes `160050`; quantity rejects commas, so the two kinds disagree. The result carries a user-supplied badge, which makes the value look deliberate, and feeds `funding.differs`/`funding.exceeds_budget` at confirmed state.

Fix: accept a comma only as a thousands separator when every group has exactly three digits; otherwise return an error asking for a plain number. Related: the editor defaults the currency to `ZAR` (`Workspace.tsx:51`) regardless of the original, so a USD correction can change currency unnoticed; prefill from the original fact.

## Coverage confirmation: one click, no undo, not exported

*medium, confirmed.* "I checked this document: confirm coverage" (`Workspace.tsx:319-323`) moves a document to `user_confirmed`, which turns every absence against it from Needs review to confirmed. The button disappears on use and there is no way back except Reset, which also wipes corrections and decisions. `ExportEntry` (`export.ts:8-20`) has no coverage field, so a confirmed `item.absent` in the CSV or text is indistinguishable from one backed by a deterministic check. The finding itself holds a `coverage` snapshot, which is simply not exported.

`newExtraction` marks every chunk `ok` (`session-core.ts:106`), so `processing_incomplete` cannot occur in the app and a fixture cannot represent a failed chunk.

Fix: add `coverage: { docId, state }[]` to export entries for absence findings and a "coverage confirmed by reviewer at <time>" line in the text render; add an undo; let fixtures declare chunk status.

## PackCheck records fewer not-evaluated cases than ScopeCheck

*medium, confirmed.* In `compare()` the loop runs over the *other* document's facts (`packcheck/.../rules.ts:89`), so a supporting document without the field plans nothing. `funding_within_budget` is skipped when `budget` is missing (`:138`). ScopeCheck records these as `not_evaluated` with `no_fact` (`scopecheck/.../rules.ts:155-159`). In PackCheck, an extraction miss on `total_project_budget` removes the only budget check without a trace. The ledger should plan from the form's fields and each supporting document's role, not from whichever facts happen to exist.

## Corrected values appear unlabelled in matrix and check tables

*medium, confirmed.* Findings show a User-supplied badge and a "document said …" note, and export lines say "user-supplied value … replaced the document value …". The comparison matrix `detail` (`scopecheck/.../rules.ts:168`, rendered `ComparisonMatrix.tsx:123`), the "Requested" column (`:29`) and PackCheck's "Values compared" cell (`Checks.tsx:57`) print effective values with no marker. A correction that makes two sides equal moves the aspect to "Agrees" and counts toward "Comparisons agree" in the summary with nothing indicating a typed value caused it. `PlannedComparison` has no way to say so.

Fix: add `userSupplied: string[]` (fact IDs) to `PlannedComparison`, fill it from the inputs' provenance, and render a badge in the matrix, the check tables and the export.

Spec comparison (`scopecheck/.../rules.ts:174`) declares `different` whenever token sets differ and then sets the finding `confirmed` (`:171`). `SS316` versus `316 stainless steel` is stated as a confirmed difference on a lexical test. Consider `needs_review` with a reason when tokens overlap partially.

## Fixture switching leaks open editors and note drafts

*medium, likely.* `useSession` keeps per-fixture state correctly (`useSession.ts:19`, `:54`), but the React tree is not remounted. Both ScopeCheck fixtures contain a doc with ID `rfq` and identical RFQ claims, so fact IDs match (verified in the fixture JSON; I did not render the switch). `FactLine`'s `editing` flag and `ValueEditor`'s draft are keyed by fact ID and `FindingCard`'s `note` by finding ID. An editor opened on the standard set stays open on the layout set, and Save applies a correction to the layout session. Fix: `key={fixture.id}` on `ReviewWorkspace`.

`FindingCard` also initialises `note` once from the store (`Workspace.tsx:153`). After a reopen clears the stored note, the input still holds the old text and the next Accept re-submits it. A card that moves between the Confirmed and Needs-review groups remounts and loses unsaved text.

## Keyboard and screen-reader gaps

*medium for focus and names, low for announcements.* After Save correction, Revert to document value and Confirm coverage, the focused control is unmounted (`Workspace.tsx:140-143`, `:131`, `:319`) and focus falls to the document. Every fact row repeats "Correct this value" and "Revert to document value"; the `sr-only` " in <doc>" is placed after the buttons (`:146`), so it does not name them. Each finding card repeats Accept/Dismiss/Reopen, and the matrix and check tables repeat "Open the finding"/"Open the item" (`ComparisonMatrix.tsx:98,111,128`, `Checks.tsx:63`). Use `aria-label` with field, item and document. The live region (`AppShell.tsx:47-49`) does not re-announce identical consecutive messages ("Decision saved: accepted." twice). Anchor targets (`#finding-…`) are non-focusable articles; add `tabIndex={-1}` and focus on navigation.

## Smaller correction and display issues

*low.* `revertCorrection` removes the correction entirely (`session-core.ts:141`), so a reverted correction leaves no trace in the export or the history. A second correction on the same fact appends; `effectiveFact` uses the latest but the export lists both. No test covers revert or repeated correction. `showValue` exists in three copies (`session-core` via `Workspace.tsx:10-17`, `scopecheck/.../rules.ts:40`, `packcheck/.../rules.ts:53`). The UI copy goes through `Number()` and a digit-grouping regex that also groups decimals (`0.12345` shows as `0.12 345`) and loses precision on long integers, so the display can differ from the engine value.

## Not tested

Nothing covers a held RFQ item, a second fact per field in a block, a correction of an RFQ item after identity resolution, comma input to the money parser, fixture switching with an open editor, or the export of a coverage-confirmed absence.

</details>

<details>
<summary>File map</summary>

Full diff: `git diff task-4-benchmark...task-6-app-shells`

- `packages/engine/src/comparisons.ts`: comparison ledger types and summary helpers
- `packages/engine/src/export.ts`, `export-render.ts`: Not-evaluated section and comparison summary in the export model; text and CSV renderers with formula guard
- `packages/engine/src/findings.ts`: `makeDraft` and `dedupeDrafts` helpers added
- `packages/ui/src/session-core.ts`, `useSession.ts`: pure session logic and in-memory per-fixture state
- `packages/ui/src/Workspace.tsx`, `Badges.tsx`, `AppShell.tsx`: review queue, correction editor, documents/coverage, export panel, status badges, live region
- `apps/scopecheck/src/adapter/*`, `ComparisonMatrix.tsx`, `App.tsx`: ScopeCheck rules with ledger, adapter, matrix view
- `apps/packcheck/src/adapter/*`, `Checks.tsx`, `App.tsx`: PackCheck rules with ledger, adapter, check tables
- `samples/fixtures/*.json`, `tools/benchmark/src/build-fixtures.ts`, `checks.ts`: fixtures built from recorded claims; benchmark checks reduced to shared adapter imports
- `apps/*/src/*.test.ts(x)`, `packages/engine/test/export-render.test.ts`: golden and keyboard-correction tests
- `docs/`, `README.md`, `package*.json`, `eslint.config.js`, `vitest.config.ts`, benchmark result JSON: documentation, screenshots, tooling, recorded runs

</details>
