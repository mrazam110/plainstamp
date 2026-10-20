# Plainstamp

An open-source assistant that explains German bureaucracy in plain language to people who don't read German well. You ask a question, it answers from official pages and links the source with the date it was last checked.

It is a RAG (retrieval-augmented generation) system. The model does not answer from memory. For each question it rewrites the question into German search queries, retrieves matching chunks of official pages (vector plus keyword search, limited to the states you picked), and writes the answer only from those chunks. Every claim carries a citation. If no chunk supports an answer, the system says so and points to the responsible office. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Licence: [AGPL-3.0-only](LICENSE). Non-commercial. Not legal advice, and not affiliated with any authority.

Try it: https://plainstamp.razadetechnologies.com (pilot, free tier, may hit its daily quota).

## How it behaves
- Answers come only from retrieved official pages. If nothing relevant is found, it says so and points to the responsible office.
- You can pick a state, a from/to pair for a move, or Germany only.
- It never stores your questions, answers or IP. See [PRIVACY.md](PRIVACY.md).

## Coverage
Defined in [regions/de.yaml](regions/de.yaml).

| Area | Status |
|---|---|
| Federal | pilot |
| Berlin, Brandenburg, Bavaria | pilot |
| Other 13 states | not yet covered; the app says so |

## Status
Working pilot: a static chat page plus a Cloudflare Worker (`POST /ask`, `POST /feedback`) that rewrites the question into German, searches Postgres (pgvector plus German full text), and answers only from the retrieved pages with a source link and the date it was checked. If nothing relevant is found it says so. The Worker is stateless and fails closed without its rate limiter and Turnstile check. Current task and open items: [docs/STATUS.md](docs/STATUS.md). Plan: [docs/PLAN.md](docs/PLAN.md).

## Known limitations
- Coverage is the pilot only (federal, Berlin, Brandenburg, Bavaria), about 40 pages loaded in the hosted database.
- No source has granted written permission for public reuse yet ([ADR 0011](docs/adr/0011-source-terms-and-reuse.md)). The crawled text is not in this repository; you crawl it yourself.
- Eval on 121 questions (Gemini, pilot corpus): right page cited 0.93, expected-fact recall 0.71, false refusals 0.05, no wrong-state leaks. A person who knows each state still has to check the expected facts, so treat these as a baseline, not a guarantee ([docs/SPIKE-RESULTS.md](docs/SPIKE-RESULTS.md)).
- Answers are written by a language model from official pages. They can be wrong or out of date. Always check the linked source.
- The hosted instance sends questions to Google's free Gemini tier. See [PRIVACY.md](PRIVACY.md).

## Run it locally
```bash
npm install
npm test                     # build config + vitest (no keys needed)
npm run dev:fakes            # Worker with a fake model and data, no keys
npm run web:dev              # chat page on :5173, talks to http://localhost:8787
```
Real data and models: copy `.env.example` to `.env`, set `GEMINI_API_KEY` and `DATABASE_URL`, then crawl and load a source (commands in [CLAUDE.md](CLAUDE.md)). Deploying your own copy: [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Documentation
| File | What is in it |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | current task and open items |
| [docs/PLAN.md](docs/PLAN.md) | phased plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | pipeline, retrieval backends, Worker, repo layout |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | deploying your own copy, public-flip checklist |
| [docs/SPIKE-RESULTS.md](docs/SPIKE-RESULTS.md) | measurements and eval runs |
| [docs/adr/](docs/adr/) | decisions and why |
| [eval/README.md](eval/README.md) | test question format |
| [PRIVACY.md](PRIVACY.md) | what is and is not stored |

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). Commits are signed off (DCO) by the person who makes them.

## Maintainer
Muhammad Raza Master, mrazam110@gmail.com.
