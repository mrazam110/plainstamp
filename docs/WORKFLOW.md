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

## Deploying the Worker (setup done in Cloudflare by the maintainer)
Code, tests and config are ready; these steps need the maintainer's accounts. Never paste keys into chat or commit them.
1. **Cloudflare account, Free plan.** The Rate Limiting binding docs do not state plan availability: confirm in the dashboard before relying on it. If it is not available, the Worker still refuses to run (see step 7), so a fallback limiter must be added first.
2. **Turnstile widget** (Dashboard > Turnstile > Add widget): mode Managed, hostnames = the page's hostname (add `localhost` only for a dev widget). Copy the public site key (goes into the web build as `VITE_TURNSTILE_SITEKEY`) and the secret key.
3. **Secrets**, each with `npx wrangler secret put <NAME> --config worker/wrangler.toml`: `GEMINI_API_KEY`, `TURNSTILE_SECRET`, `RATE_SALT` (any long random string; changing it resets rate-limit keys), `DATABASE_URL` (or add a Hyperdrive binding named `HYPERDRIVE`).
4. **Variables** in `worker/wrangler.toml`: `ALLOWED_ORIGINS` = the exact origin of the web page (for example `https://plainstamp.example`).
5. **Database**: Postgres with pgvector, loaded with `load-pg` from a corpus embedded with the same embedder as `EMBEDDING_*` (Neon is the provisional choice; backend is confirmed only after the real measurement in docs/SPIKE-RESULTS.md).
6. **Web**: `VITE_API_URL=https://<worker-url> VITE_TURNSTILE_SITEKEY=<site key> npm run web:build`, then publish `web/dist/` (Cloudflare Pages or static assets).
7. **Keep `REQUIRE_GUARDS = "1"`.** With it, the Worker answers 503 until the rate limiter bindings, `RATE_SALT` and `TURNSTILE_SECRET` exist. Do not override it in the dashboard; that opens the endpoint.
8. **Cost cap**: set a spend or quota alert on the Gemini key in Google AI Studio. `GLOBAL_LIMITER` (60/min per Cloudflare location) is only a coarse brake.
Local checks: `npm run dev:fakes` (no guards), `npm run dev:guarded` (guards with Cloudflare's published dummy Turnstile secret; use the dummy token `XXXX.DUMMY.TOKEN.XXXX`).

## Public-flip checklist (private -> public)
- [ ] Secret scan of full git history (gitleaks or trufflehog); rotate any key that ever appeared
- [ ] No personal data, real user questions or private notes in repo or history
- [ ] `git log` and PR history contain no LLM signatures (grep for `Co-Authored-By`, "Generated with", model and tool names); rewrite history before the flip if any exist
- [ ] `LICENSE` is AGPL-3.0; source files carry SPDX header `AGPL-3.0-or-later` (if chosen)
- [ ] Content audit: every committed corpus file has a licence note, otherwise remove it and keep only the crawler and source list
- [ ] Terms recorded for every covered state's source; README and UI list exactly which states are covered and say others are not
- [ ] `PRIVACY.md` matches real behaviour (verified by the no-logging test)
- [ ] README: what it is, not-legal-advice, no affiliation with authorities, how to self-host, how to contribute
- [ ] `.env.example` complete, no real values
- [ ] Rate limiting, Turnstile and cost cap active on the public endpoint
- [ ] Name/logo checked for trademark or official-look conflicts
- [ ] Eval score documented, known limitations listed
- [ ] Branch protection and PR flow enabled (Phase 8 switch)
