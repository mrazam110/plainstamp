# Contributing

## Ground rules
- Read [CLAUDE.md](CLAUDE.md) and [docs/WORKFLOW.md](docs/WORKFLOW.md) first.
- Privacy: nothing may store or log user prompts, answers or IPs.
- Region specifics belong in YAML under `regions/`, `topics/`, `sources/`, `eval/`, not in `core/` code.
- No secrets in git. Keep `.env.example` current.

## Commits
- Format `type(scope): summary`; types `feat fix docs test chore refactor`. Keep them small and specific.
- Sign off every commit (`git commit -s`, DCO).
- Enable the hook: `git config core.hooksPath .githooks`. It rejects tool or LLM signature lines such as `Co-Authored-By` naming a model.
- If you use an AI tool to draft code or text, you review it and you are accountable for it. Remove any tool-added trailers before pushing.

## Develop and test
- `npm install`, then `npm test` (config build and vitest, no keys) and `npm run typecheck`.
- Python ingest: `python3 -m venv .venv && .venv/bin/pip install -r ingest/requirements.txt`, then `cd ingest && ../.venv/bin/python -m pytest -q`.
- `npm run dev:fakes` runs the Worker with a fake model and data; `npm run web:dev` serves the page.
- Full-pipeline eval needs a key and a loaded database, so it is not in CI: `npx tsx --env-file=.env scripts/eval_pipeline.ts` (options in the script header). New questions go in `eval/de/` and are checked with `scripts/validate_eval.py`; every expected fact needs a person who knows that state to verify it.
- Do not commit crawled text, snapshots, bundles or `.env` (ADR 0007). A new source needs its terms recorded in `sources/` first (ADR 0011).
