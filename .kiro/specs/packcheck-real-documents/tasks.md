# PackCheck real-document path: tasks

Introduced 2026-11-01 (see `requirements.md`). Only the final dates are given (ScopeCheck deployed by 2026-11-22; PackCheck working upload by 2026-11-29); every other date is a proposed target. Shared tasks are referenced from `scopecheck-real-documents/tasks.md` and the foundation plan, not duplicated.

- [ ] PC-T1 Pre-register the realistic PackCheck pack and expected outputs (PC-5): documents, per-field labels, expected findings, expected ledger. Committed before extraction. Target 2026-11-24.
- [ ] PC-T2 Offline multi-chunk tests with a mock model on PC-T1, including a failed chunk in the application form and a budget table split across chunks (SC-2 applies). Target 2026-11-25.
- [x] PC-T3 Upload and role assignment (PC-1), done 2026-11-01 against a FAKE Worker, reusing `UploadPanel` and the output-aware client chunker: four slots (requirements and application form required; budget and registration optional), the slot id is the document id and role the adapter reads, all on `packcheck.grant.v2`. Tests: slot rules, nothing sent before Analyse, no service connected, Live mode, failed chunk cannot confirm an absence, stopping error. **Not done:** no real Worker is connected, no live inference was run for PackCheck uploads, production admission stays 0; role assignment is by slot (a mis-chosen file is not detected); PC-T1 (pre-registered realistic pack) is still open.
- [ ] PC-T4 Attachment mapping UI with manual remap (PC-2, foundation task 15). Target 2026-11-27.
- [ ] PC-T5 Live measurement on PC-T1 within an authorised attempt budget (PC-3, PC-5). Target 2026-11-28.
- [ ] PC-T6 Live wiring, deployment and end-to-end run; record in the build log (PC-6). **Target 2026-11-29.**
