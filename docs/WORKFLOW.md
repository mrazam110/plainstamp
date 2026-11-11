# Workflow

## Trunk-based development (current phase)
- Single branch: `main`. Private GitHub repo.
- One logical change per commit, small (aim under ~150 lines). Docs commits are separate from code commits.
- Commit format: `type(scope): summary`. Types: `feat fix docs test chore refactor`. Use `git commit -s` (DCO).
- Run tests/lint before commit. Push right after. `main` must always work.
- Large work is split into steps that each leave `main` working. Unfinished behaviour goes behind a config flag, not a long-lived branch.
- Update `docs/STATUS.md` when a task finishes.

## Commit and PR text, authorship
- Say what changed and why, in one or two plain sentences. Subject under ~70 characters, imperative mood, no trailing period. Body only when the why is not obvious.
- Run the draft through the `humanizer` skill before committing or posting a PR, issue or review comment.
- No LLM or tool signatures in any commit message, PR title or body, issue, comment, changelog or release note: no `Co-Authored-By` naming a model or tool, no "Generated with ..." lines, no model names. A `commit-msg` hook and a CI check reject them (Phase 0 task).
- The person who commits is responsible for the change, whoever or whatever drafted it. Review AI-written code as you would a colleague's before it lands on `main`.
- Example: `fix(ingest): skip pages that return a redirect loop` is good; `feat: leverage cutting-edge chunking to enhance retrieval` is not.
- Decisions that cost time to reverse get a short ADR in `docs/adr/NNNN-title.md` (context, decision, consequences).

## Later (Phase 8)
Branch protection, feature branches, PRs, issue templates, CODEOWNERS for `sources/` and `eval/`.

## Using Claude efficiently
- Start a session by reading `CLAUDE.md` and `docs/STATUS.md` only.
- Delegate: source research to `source-scout`, questions to `eval-writer`, diff checks to `privacy-reviewer` and `commit-reviewer`.
- Ask agents for compact reports (bullets, tables), never raw page dumps.
- End each task by updating `docs/STATUS.md` (current task, last commit, next 3 tasks, blockers).

## Embedding under the free Gemini quota
`scripts/embed_daily.sh` runs `embed-all` from the cache: it embeds what is missing, stops cleanly with exit status 3 when the daily cap is hit, and exits 0 when every source has vectors. Run it once a day after the quota resets (or schedule it), then `load-pg` each source. Sources with `embed: false` (`berlin-full`) are skipped.

## Deploying the Worker (setup done in Cloudflare by the maintainer)
Code, tests and config are ready; these steps need the maintainer's accounts. Never paste keys into chat or commit them.
1. **Cloudflare account, Free plan.** The Rate Limiting binding docs do not state plan availability: confirm in the dashboard before relying on it. If it is not available, the Worker still refuses to run (see step 7), so a fallback limiter must be added first.
2. **Turnstile widget** (Dashboard > Turnstile > Add widget): mode Managed, hostnames = the page's hostname (add `localhost` only for a dev widget). Copy the public site key (goes into the web build as `VITE_TURNSTILE_SITEKEY`) and the secret key.
3. **Secrets**, each with `npx wrangler secret put <NAME> --config worker/wrangler.toml`: `GEMINI_API_KEY`, `TURNSTILE_SECRET`, `RATE_SALT` (any long random string; changing it resets rate-limit keys), `DATABASE_URL`: use the read-only Neon URL, not the owner URL: `grep '^READONLY_DATABASE_URL=' .env | cut -d= -f2- | tr -d "'" | npx wrangler secret put DATABASE_URL --config worker/wrangler.toml` (or add a Hyperdrive binding named `HYPERDRIVE`).
4. **Variables** in `worker/wrangler.toml`: `ALLOWED_ORIGINS` = the exact origin of the web page (for example `https://plainstamp.example`).
5. **Database**: Neon project `plainstamp` (Frankfurt), set up with `neon init`/`neon deploy` (neon.ts). Load or refresh with `DATABASE_URL=$DATABASE_URL_UNPOOLED PYTHONPATH=ingest .venv/bin/python -m plainstamp_ingest load-pg <source>` after embedding with the same `EMBEDDING_*` settings. Tests use `TEST_DATABASE_URL` (a throwaway local database), never Neon. Local Worker secrets go in `worker/.dev.vars` (gitignored).
6. **Web**: `VITE_API_URL=https://<worker-url> VITE_TURNSTILE_SITEKEY=<site key> npm run web:build`, then publish `web/dist/` (Cloudflare Pages or static assets).
7. **Keep `REQUIRE_GUARDS = "1"`.** With it, the Worker answers 503 until the rate limiter bindings, `RATE_SALT` and `TURNSTILE_SECRET` exist. Do not override it in the dashboard; that opens the endpoint.
8. **Quotas (free tier)**: embeddings 100/min and about 1,000/day, text model about 15/min. Lower `GLOBAL_LIMITER` in `worker/wrangler.toml` (it is 60/min per location) to match what the key can serve, or enable billing on the Google project. **Cost cap**: set a spend or quota alert on the Gemini key in Google AI Studio. `GLOBAL_LIMITER` (60/min per Cloudflare location) is only a coarse brake.
Local checks: `npm run dev:fakes` (no guards), `npm run dev:guarded` (guards with Cloudflare's published dummy Turnstile secret; use the dummy token `XXXX.DUMMY.TOKEN.XXXX`).

## Deployed on 2026-10-19 (maintainer chose a public pilot, see ADR 0011)
- API: Worker `plainstamp-api` at https://plainstamp-api.razadetechnologies.com (`npx wrangler deploy --config worker/wrangler.toml`). Guards on: per-client 4/min, global 6/min per location, Turnstile, fail-closed.
- Page: Worker `plainstamp-web` (static assets) at https://plainstamp.razadetechnologies.com. Rebuild and redeploy: `npm run build && npx wrangler deploy --config worker/wrangler.web.toml`. The build reads `web/.env.production` (gitignored: `VITE_TURNSTILE_SITEKEY`, `VITE_API_URL`). Security headers and CSP are in `web/public/_headers`.
- Data: Neon `plainstamp` (Frankfurt) holds the pilot corpus only (42 pages, 463 chunks). Refresh with `load-pg` per source, pointing `DATABASE_URL` at the unpooled owner URL; the Worker uses the read-only URL.
- Cloudflare resources created: two Workers with custom domains (DNS records in the razadetechnologies.com zone), two rate-limit namespaces, Turnstile widget `Plainstamp`. Google: AI Studio project and key `Plainstamp`. Neon: project `plainstamp`.
- To take the site down: `npx wrangler delete --config worker/wrangler.web.toml` and the same for `worker/wrangler.toml`.

## Public-flip checklist (private -> public)
Audited 2026-10-20 (regex scan, tests, code read). `[x]` done, `[~]` partly, `[ ]` open.
- [x] Secret scan of full git history: 2026-10-20 gitleaks 8.30.1 (`gitleaks git .` and `gitleaks dir` on an export of HEAD) scanned 67 commits and the tracked tree and found no leaks; it also runs in CI on every push and pull request (`.github/workflows/gitleaks.yml`, full history, pinned version with checksum check). Earlier the same day a regex scan of the working tree and 66 commits (Gemini, NVIDIA, Neon, Turnstile, GitHub, AWS, Slack and `sk-` key shapes, private keys, Postgres URLs with passwords, quoted key/secret/token assignments) found nothing. Every value in the local `.env`, `worker/.dev.vars` and `web/.env.production` was also searched for in the tree and in history: the only matches are non-secret config (model names, the localhost origin, the public API URL). Only `.env.example` was ever tracked; `.env*` and `.dev.vars` are gitignored. No account, zone or Neon project ids are committed. The NVIDIA key pasted in chat must still be rotated before the flip (it never reached git)
- [~] No personal data in repo or history: all 70 commits (author, committer and `Signed-off-by`) use the maintainer's personal identity (Muhammad Raza Master / mrazam110@gmail.com) since the 2026-10-20 history rewrite (force-pushed to the private repo; no old email or employer domain remains in any commit or file). GitHub may keep the old commits reachable by direct hash for a while. The live hostnames `*.razadetechnologies.com` are in `worker/*.toml`, ADR 0011 and docs; make them config or accept
- [~] No LLM signatures: no `Co-Authored-By` or "Generated with" in history. 8 commit subjects name providers (Gemini, NVIDIA, OpenAI-compatible) as feature names; ADR 0010 says no model names, so reword or accept. The CI check (`.github/workflows/signatures.yml`) and the commit-msg hook are in place
- [x] Licence is AGPL-3.0-only everywhere: `LICENSE` (full text), `package.json`, README, CLAUDE.md, about page, ADR 0001 (amended 2026-10-20). Per-file SPDX headers are optional and not added (0 of 85 files); add `SPDX-License-Identifier: AGPL-3.0-only` later if wanted
- [x] Content audit: no corpus, snapshots, bundles or `.env` are tracked; `data/`, `*.jsonl`, `*.bin` are ignored. Largest tracked files are source YAML lists and `package-lock.json`
- [ ] Terms recorded for every covered source: recorded (all `terms.status: not-cleared`, `allowed_public: false`) but no permission has arrived, and the live site serves that text (ADR 0011 maintainer decision). Send the requests; README lists the covered states
- [x] `PRIVACY.md` matches the code: no console calls while serving (tests in `handler.test.ts`, `guard.test.ts`), observability off, feedback stores only the vote, rate-limit key is a daily salted hash of the IP prefix
- [x] README: what it is, not legal advice, no affiliation, run locally, limitations, contributing. Self-hosting steps are in this file (link from README)
- [~] `.env.example` has no real values; Worker secrets and web build vars are now listed there as comments
- [x] Rate limiting, Turnstile and fail-closed guards active on the public endpoint (verified live 2026-10-19/20). Checked 2026-11-11: the Gemini project (Plainstamp) has no billing set up, so it cannot exceed the free tier
- [~] Name/logo checked: 2026-11-11 DPMAregister search (national, Union and international marks) for `*plainstamp*` and `plain*stamp*` returned no hits. Similar-sounding names and classes 9, 41, 42 were not reviewed individually; a trade mark attorney check is still advisable (ADR 0008)
- [~] Eval score documented (README, SPIKE-RESULTS); all 125 expected facts still say "pending human check"
- [ ] Branch protection and PR flow enabled (Phase 8 switch). The free GitHub plan only allows it on public repos, so turn it on right after the flip
