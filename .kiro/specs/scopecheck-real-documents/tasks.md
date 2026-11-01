# ScopeCheck real-document path: tasks

Introduced 2026-11-01 (see `requirements.md`). Only the final dates are given (ScopeCheck deployed by 2026-11-22; PackCheck working upload by 2026-11-29); every other date is a proposed target. Shared engineering tasks (multi-chunk client, task 5.5, deployment checks) live in the foundation `tasks.md` M2 plan corrections and are referenced, not duplicated.

- [ ] SC-T1 Pre-register the realistic ScopeCheck documents and expected outputs (SC-4). Generator under `tools/benchmark`, PDFs under `samples/scopecheck-realistic/`, expected findings and per-line labels committed **before** extraction. Target 2026-11-05.
- [ ] SC-T2 Offline multi-chunk tests with a mock model on SC-T1: chunk split, one failed chunk, one chunk the model returns nothing for, boundary duplicates; assert no confirmed absence from any of them (SC-2, SC-3). Target 2026-11-06.
- [ ] SC-T3 Foundation task 8 for ScopeCheck: in-browser upload and parse, Analyse step, live banner, scanned-PDF rejection (SC-1). Target 2026-11-10.
- [ ] SC-T4 Live measurement on SC-T1 within an explicit attempt budget: extraction, matching and findings scored separately; record chunks, latency, repairs, measured tokens, estimated neurons (SC-4). Needs an authorised attempt budget. Target 2026-11-12.
- [ ] SC-T5 Foundation task 9 live wiring for ScopeCheck: validation, session reuse, quota and limit banners with manual retry (SC-5). Target 2026-11-14.
- [ ] SC-T6 Foundation task 5.5 limits and deployment validation (binding, Durable Object) (SC-6). Target 2026-11-17.
- [ ] SC-T7 Deploy ScopeCheck (Pages project and Worker), open admission only after SC-T6 passes, end-to-end run on SC-T1 documents, record in the build log (SC-6). **Target 2026-11-22.**
- [ ] SC-T8 2 to 5 quotations (SC-7). After SC-T7, before final regression.
- [ ] SC-T9 DOCX input (SC-7). After SC-T8.
- [ ] SC-T10 Supplier-specific clarification email drafts (SC-7). After SC-T8.
- [ ] SC-T11 Duplicate-key identity fix (SC-8). With SC-T3.
