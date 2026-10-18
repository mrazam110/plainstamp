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
