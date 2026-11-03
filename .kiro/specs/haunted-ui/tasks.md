# Haunted interface: tasks

Introduced 2026-11-01 (see `requirements.md`). Implemented alongside the upload flow; finished before the final submission week. The submission date comes from the Build Brief and is **5 December 2026, 00:00 SAST** (recorded 2026-11-01). Dates for HU-T1 and HU-T2 are proposed, not given. Dependencies reference the other specs by ID.

**2026-11-02:** requirements revision 2 (HU-10 to HU-15, from the Build Brief's haunted design layer) is under review. These tasks are revised after it is accepted and `design.md` is updated; until then nothing below starts.

- [x] HU-T0 Define the visual system and Lights-on behaviour (`design.md`) and enforce palette contrast with a test (`packages/ui/src/theme-tokens.ts`). Done 2026-11-01.
- [ ] HU-T1 Theme provider, CSS variables from the tokens, the Lights toggle with live-region announcement and persistence (HU-1, HU-3, HU-8). With SC-T3 (ScopeCheck upload). Proposed 2026-11-12.
- [ ] HU-T2 Apply tokens to shared components and both apps, Lights on then Lights off; evidence highlight with outline (HU-2, HU-6, HU-7). With SC-T5. Proposed 2026-11-19.
- [ ] HU-T3 Motifs and effects behind the reduced-motion guard (HU-5, HU-9). After SC-T7 (ScopeCheck deployed). Before the final submission week (deadline 5 December 2026, 00:00 SAST).
- [ ] HU-T4 Automated accessibility checks and screenshots in both modes for both apps, using the Task 11 tooling (HU-4). Depends on foundation task 11. Then enable the accessibility hook (see `docs/hooks.md`). Before the final submission week (deadline 5 December 2026, 00:00 SAST).
- [ ] HU-T5 Theme complete and reviewed; build-log entry. **Before the final submission week.**
