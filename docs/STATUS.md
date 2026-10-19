# Status

Updated: 2026-10-18

- Phase: 3/5 wired to real services. Secrets on the Worker: GEMINI_API_KEY, RATE_SALT, TURNSTILE_SECRET (DATABASE_URL still to store: use the read-only URL). Neon (Frankfurt, pgvector 0.8.6) holds the 42 pilot pages; a real /ask through the Worker config returned a cited answer; `npm run build` passes; 82 tests.
- Scope changed to Germany-wide architecture with staged coverage (federal + Berlin + Brandenburg + Bavaria), ADR 0009. Retrieval backend now decided by measurement in Phase 3 (ADR 0004 revised).
- Done: licence AGPL-3.0 chosen; plan, architecture, workflow, 9 ADRs, 4 agents; spike stages A-C (`docs/SPIKE-RESULTS.md`); test Worker deleted; Cloudflare plan confirmed Free
- Last commit: see `git log` (history pushed to private repo mrazam110/plainstamp)
- Phase 0 done locally: git init (main, hooksPath=.githooks), .gitignore, .env.example, README, PRIVACY, CONTRIBUTING, commit-msg hook (tested), folder skeleton, regions/de.yaml, topics/de.yaml. 
- Next 3: 1) user: store DATABASE_URL (read-only Neon URL, command in WORKFLOW.md); tomorrow (after the Gemini quota reset) `scripts/embed_daily.sh`, then I load berlin-topical into Neon, re-run the eval and check the page with the real Worker; 2) deploy: `wrangler deploy`, publish web/dist at plainstamp.razadetechnologies.com (needs user OK, ALLOWED_ORIGINS and VITE_API_URL set); 3) state expert checks eval facts; free-tier quotas cap real traffic (about 250 questions/day)
- Name: Plainstamp chosen (ADR 0008). 2026-10-18 quick check: web search finds no product or mark; whois shows .com, .de, .eu, .io, .org unregistered (.app unclear); no GitHub user/org `plainstamp`. TMview (DE, EU, WIPO, active only) and DPMAregister (exact match) show no hits for "plainstamp"; a DPMA wildcard search returned 0 but its query echoed blank, so repeat it by hand. Searches were word-mark only; similar names and classes 9, 41, 42 not reviewed. Domains not registered.
- Blockers: none for local work; public use needs reuse permission per source (ADR 0011); backend default unknown until the Phase 3 measurement; free-plan CPU enforcement discrepancy unexplained
- Notes: spike results are Berlin-only and optimistic (hand-written German rewrites). service.berlin.de also offers en/ru/uk/de_plain versions, to evaluate. Spandau office layer moves to Phase 8 (city layers).
