# Workflow

- Spec-driven: requirements -> design -> tasks. Pause for human review between phases.
- One small milestone per pull request, with relevant checks and a concise report of what works.
- Build order: engine + two minimal app adapters on structured fixtures first; then PDF ingestion and the model validation path.
- Hooks: create only hooks supported in the interface in use. Never claim a hook ran unless it did. A useful first hook reruns golden fixtures when an engine rule changes.
- Keep standard test commands in GitHub Actions as well (public repo, standard runners).
- Record actual work honestly in `docs/build-log.md`. Planning documents are not evidence of completed work.
- Keep `.kiro/` at the repository root and commit specs, steering and supported hooks.

## Key dates (SAST)
- Credit requests close 1 Dec 22:00; submission deadline 5 Dec 2026 00:00; keep apps available through 29 Jan 2027.
