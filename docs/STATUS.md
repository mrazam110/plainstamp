# Status

Updated: 2026-10-18

- Phase: 5 baseline recorded. Real-model eval on the 42-page pilot corpus (121 questions): right page cited 0.93, fact recall 0.71, false refusals 5%, refusals/ask-state/not-covered 100%, wrong-state leaks 0; all thresholds pass. Facts are not human-checked. Fix for off-topic federal overview made, re-run pending.
- Scope changed to Germany-wide architecture with staged coverage (federal + Berlin + Brandenburg + Bavaria), ADR 0009. Retrieval backend now decided by measurement in Phase 3 (ADR 0004 revised).
- Done: licence AGPL-3.0 chosen; plan, architecture, workflow, 9 ADRs, 4 agents; spike stages A-C (`docs/SPIKE-RESULTS.md`); test Worker deleted; Cloudflare plan confirmed Free
- Last commit: see `git log` (history pushed to private repo mrazam110/plainstamp)
- Phase 0 done locally: git init (main, hooksPath=.githooks), .gitignore, .env.example, README, PRIVACY, CONTRIBUTING, commit-msg hook (tested), folder skeleton, regions/de.yaml, topics/de.yaml. 
- Next 3: 1) Gemini free-tier embedding cap (about 1,000/day) is used up until about 5 h after 2026-10-18 evening: then re-run `--type needs_state` eval; decide: enable billing on the Google project (user) or ship the pilot corpus plus topic-classified Berlin pages only (about 1.3k chunks); 2) user stores wrangler secrets (commands in chat/WORKFLOW.md) and picks a database for the Worker (Neon account or bundle backend measured on a real Worker); 3) state expert checks eval facts
- Name: Plainstamp chosen (ADR 0008). 2026-10-18 quick check: web search finds no product or mark; whois shows .com, .de, .eu, .io, .org unregistered (.app unclear); no GitHub user/org `plainstamp`. TMview (DE, EU, WIPO, active only) and DPMAregister (exact match) show no hits for "plainstamp"; a DPMA wildcard search returned 0 but its query echoed blank, so repeat it by hand. Searches were word-mark only; similar names and classes 9, 41, 42 not reviewed. Domains not registered.
- Blockers: none for local work; public use needs reuse permission per source (ADR 0011); backend default unknown until the Phase 3 measurement; free-plan CPU enforcement discrepancy unexplained
- Notes: spike results are Berlin-only and optimistic (hand-written German rewrites). service.berlin.de also offers en/ru/uk/de_plain versions, to evaluate. Spandau office layer moves to Phase 8 (city layers).
