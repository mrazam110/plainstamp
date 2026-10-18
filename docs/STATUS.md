# Status

Updated: 2026-10-18

- Phase: 3 in progress. Retriever (bundle, Postgres), LLM and embeddings interfaces with Gemini REST clients (fake-fetch tests; models verified in ADR 0006, no live call yet). Backend default provisionally Postgres.
- Scope changed to Germany-wide architecture with staged coverage (federal + Berlin + Brandenburg + Bavaria), ADR 0009. Retrieval backend now decided by measurement in Phase 3 (ADR 0004 revised).
- Done: licence AGPL-3.0 chosen; plan, architecture, workflow, 9 ADRs, 4 agents; spike stages A-C (`docs/SPIKE-RESULTS.md`); test Worker deleted; Cloudflare plan confirmed Free
- Last commit: see `git log` (history pushed to private repo mrazam110/plainstamp)
- Phase 0 done locally: git init (main, hooksPath=.githooks), .gitignore, .env.example, README, PRIVACY, CONTRIBUTING, commit-msg hook (tested), folder skeleton, regions/de.yaml, topics/de.yaml. 
- Next 3: 1) /ask pipeline (context modes, rewrite + topic pick, per-region retrieval, cited answer, not-covered handling) with fake LLM tests; 2) live Gemini check once a key is set; 3) real Worker + Neon measurement (accounts, ask first)
- Name: Plainstamp chosen (ADR 0008). 2026-10-18 quick check: web search finds no product or mark; whois shows .com, .de, .eu, .io, .org unregistered (.app unclear); no GitHub user/org `plainstamp`. TMview (DE, EU, WIPO, active only) and DPMAregister (exact match) show no hits for "plainstamp"; a DPMA wildcard search returned 0 but its query echoed blank, so repeat it by hand. Searches were word-mark only; similar names and classes 9, 41, 42 not reviewed. Domains not registered.
- Blockers: none for local work; public use needs reuse permission per source (ADR 0011); backend default unknown until the Phase 3 measurement; free-plan CPU enforcement discrepancy unexplained
- Notes: spike results are Berlin-only and optimistic (hand-written German rewrites). service.berlin.de also offers en/ru/uk/de_plain versions, to evaluate. Spandau office layer moves to Phase 8 (city layers).
