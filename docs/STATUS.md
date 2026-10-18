# Status

Updated: 2026-10-18

- Phase: 0 in progress (local files done, staged, not committed; no remote yet)
- Scope changed to Germany-wide architecture with staged coverage (federal + Berlin + Brandenburg + Bavaria), ADR 0009. Retrieval backend now decided by measurement in Phase 3 (ADR 0004 revised).
- Done: licence AGPL-3.0 chosen; plan, architecture, workflow, 9 ADRs, 4 agents; spike stages A-C (`docs/SPIKE-RESULTS.md`); test Worker deleted; Cloudflare plan confirmed Free
- Last commit: none (git not initialised)
- Phase 0 done locally: git init (main, hooksPath=.githooks), .gitignore, .env.example, README, PRIVACY, CONTRIBUTING, commit-msg hook (tested), folder skeleton, regions/de.yaml, topics/de.yaml. CI check for LLM signatures not written yet.
- Next 3: 1) human commits staged files with -s (LICENSE now included); 2) private GitHub repo + push; 3) CI signature check, name/trademark checks
- Name: Plainstamp chosen (ADR 0008); trademark/product check still to do before going public
- Blockers: reuse terms per state not cleared; backend default unknown until the Phase 3 measurement; free-plan CPU enforcement discrepancy unexplained (spike was not cut off at 2.4 s, docs say 10 ms)
- Notes: spike results are Berlin-only and optimistic (hand-written German rewrites). service.berlin.de also offers en/ru/uk/de_plain versions, to evaluate. Spandau office layer moves to Phase 8 (city layers).
