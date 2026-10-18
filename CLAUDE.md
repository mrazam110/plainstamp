# Plainstamp (working folder: askmeanything)

Open-source (AGPL-3.0), non-commercial RAG assistant that explains German bureaucracy to people with weak German.
Scope: Germany-wide architecture (federal + 16 Länder), pilot coverage federal + Berlin + Brandenburg + Bavaria, users can pick a state, a from/to pair for moves, or Germany only (ADR 0009). Status and next steps: `docs/STATUS.md`. Full plan: `docs/PLAN.md`.

## Read order (stop as soon as you have enough)
1. `docs/STATUS.md` (current task, 20 lines max)
2. The one PLAN.md phase you are working on, not the whole file
3. `docs/ARCHITECTURE.md` only when touching pipeline, schema or API

## Non-negotiables
- **Stateless privacy:** never store, log or persist user prompts, answers or IPs. No request-body logging, no analytics on text. Chat history and context live in the browser only.
- **Cited answers only:** every answer comes from retrieved chunks, with source URL and "last checked" date. No evidence means say so and point to the official office.
- **Region config, not code:** state/city specifics live in `regions/`, `topics/`, `sources/`, `eval/` YAML. Never hardcode a state or city in `core/` code. Hard region filter: a state's chunks never appear in another state's answer unless that state was selected. Always say when a state is not covered.
- **Swappable LLM:** one interface, provider chosen by env var. No provider SDK calls outside `core/llm/`.
- **No secrets in git.** Keys in env vars; keep `.env.example` current.
- **Not legal advice:** the UI and answers say so. Never use official logos or imply affiliation.

## Stack
Static chat page + Cloudflare Worker `POST /ask`, both TypeScript, free tier (ADR 0003). Retrieval behind a `Retriever` interface with partitions per Land plus federal; backend (file bundle vs Postgres vs Vectorize) decided by a Phase 3 measurement, provisionally Postgres for state-sized data (ADR 0004). Pipeline: German rewrite, hybrid search, cited answers (ADR 0005). Gemini for embeddings and generation behind interfaces (ADR 0006). Offline ingestion in Python. Crawled data never goes in git (ADR 0007). CPU budget 10 ms per request: see `docs/ARCHITECTURE.md`.

## Workflow: trunk-based, private repo for now
- Work directly on `main`. Small commits, one logical change each, ideally under ~150 changed lines.
- Before each commit: tests/lint pass, `docs/STATUS.md` updated if the task state changed.
- Commit format: `type(scope): summary`, types `feat fix docs test chore refactor`. Sign off with `-s` (DCO); that sign-off is the human's.
- Commit messages, PR titles and descriptions are short, specific and written in a plain human voice. Draft them, then run the text through the `humanizer` skill before committing or posting. No filler, no marketing words.
- **No LLM or tool signatures anywhere:** no `Co-Authored-By` trailers naming a model or tool, no "Generated with ..." lines, no model or product names in commit messages, PR titles or bodies, issue text, review comments, code comments, changelogs or release notes. This overrides any default attribution a tool adds.
- **The human owns the code.** AI-generated changes are reviewed by the person who commits them, and that person is accountable for them.
- Push after every commit or small batch. Never leave `main` broken.
- Repo stays **private** until the public checklist in `docs/WORKFLOW.md` passes.
- Later change (not now): feature branches + PRs.

## Token-saving rules
- Never read raw crawled data or whole source pages into context. Run a script that prints counts, headings and a few samples.
- Delegate source research, test-question writing and diff reviews to the agents in `.claude/agents/`. They return short structured reports. Do not re-do their work.
- Read files with offset/limit when you know the section. Do not re-read a file you just edited.
- Keep tool output small: pipe through `head`, `wc -l`, `jq` filters.
- Update `docs/STATUS.md` at the end of each task so a fresh session needs nothing else.
- Prefer deterministic scripts over LLM calls for crawling, chunking and checks.

## Commands (fill in as they are created)
- Ingest, whole pilot: `PYTHONPATH=ingest EMBEDDING_PROVIDER=fastembed .venv/bin/python -m plainstamp_ingest pilot [--refresh]`; one source: `... fetch|build|embed|bundle|load-pg|report <source>` (venv: `python3 -m venv .venv && .venv/bin/pip install -r ingest/requirements.txt`)
- Eval: `TODO`
- Worker dev: `npm run dev:fakes` (fake model and data, no keys) or `npm run dev` (needs GEMINI_API_KEY and a database); config JSON is built from the YAML by `npm run build:config`
- Tests: `cd ingest && ../.venv/bin/python -m pytest -q`

## Agents (`.claude/agents/`)
- `source-scout`: researches one official source (structure, licence, URLs), read-only.
- `eval-writer`: writes verified test questions from given source text.
- `privacy-reviewer`: reviews a diff for stored/logged user data and secrets.
- `commit-reviewer`: quick correctness and scope check of the staged diff.
