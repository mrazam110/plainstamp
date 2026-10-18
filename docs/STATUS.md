# Status

Updated: 2026-10-18

- Phase: 3 in progress. Pipeline `ask()` done (rewrite + topic pick, per-region hybrid retrieval, cited answer, move/not-covered/ask-state/no-evidence handling), 26 TS tests with fake LLM. Privacy review fixed: provider JSON errors carry fixed messages. Still missing: Worker `POST /ask` (streaming, rate limit, Turnstile), live Gemini check, real Worker + Neon measurement.
- Scope changed to Germany-wide architecture with staged coverage (federal + Berlin + Brandenburg + Bavaria), ADR 0009. Retrieval backend now decided by measurement in Phase 3 (ADR 0004 revised).
- Done: licence AGPL-3.0 chosen; plan, architecture, workflow, 9 ADRs, 4 agents; spike stages A-C (`docs/SPIKE-RESULTS.md`); test Worker deleted; Cloudflare plan confirmed Free
- Last commit: see `git log` (history pushed to private repo mrazam110/plainstamp)
- Phase 0 done locally: git init (main, hooksPath=.githooks), .gitignore, .env.example, README, PRIVACY, CONTRIBUTING, commit-msg hook (tested), folder skeleton, regions/de.yaml, topics/de.yaml. 
- Next 3: 1) Worker POST /ask: stateless, no body/IP logging, CORS, streaming, config JSON built from YAML; 2) live Gemini check with a key (user sets GEMINI_API_KEY); 3) real Worker + Neon measurement (accounts, ask first), rate limiting and Turnstile
- Name: Plainstamp chosen (ADR 0008). 2026-10-18 quick check: web search finds no product or mark; whois shows .com, .de, .eu, .io, .org unregistered (.app unclear); no GitHub user/org `plainstamp`. TMview (DE, EU, WIPO, active only) and DPMAregister (exact match) show no hits for "plainstamp"; a DPMA wildcard search returned 0 but its query echoed blank, so repeat it by hand. Searches were word-mark only; similar names and classes 9, 41, 42 not reviewed. Domains not registered.
- Blockers: none for local work; public use needs reuse permission per source (ADR 0011); backend default unknown until the Phase 3 measurement; free-plan CPU enforcement discrepancy unexplained
- Notes: spike results are Berlin-only and optimistic (hand-written German rewrites). service.berlin.de also offers en/ru/uk/de_plain versions, to evaluate. Spandau office layer moves to Phase 8 (city layers).
