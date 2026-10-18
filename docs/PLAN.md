# Plan

Rule: each task is one small commit on `main`. Mark `[x]` when pushed. Decisions: `docs/adr/`. Spike data: `docs/SPIKE-RESULTS.md`. Check free-tier limits on provider pages before relying on them.
Scope: Germany-wide architecture, pilot coverage federal + Berlin + Brandenburg + Bavaria (ADR 0009).

## Phase 0: Foundations
- [x] Decide stack, privacy model, licence, scope (ADRs 0001-0009), spike stages A-C
- [x] Name chosen: Plainstamp (ADR 0008)
- [ ] Name checks: trademark search (TMview, DPMA), registrar and GitHub confirmation, register domain/org
- [ ] `git init`, private GitHub repo, push `main`
- [ ] Download AGPL-3.0 text to `LICENSE` from gnu.org (needs user OK)
- [ ] `README.md` (with coverage list), `PRIVACY.md`, `CONTRIBUTING.md` (DCO, human accountability, no LLM signatures), `.gitignore` (build artifacts, data), `.env.example`
- [ ] `commit-msg` hook (`.githooks/`) and a CI check that reject LLM signatures in commit messages and PR titles/descriptions (ADR 0010)
- [ ] Folder skeleton per ARCHITECTURE.md; `regions/de.yaml` (Germany > 16 Länder, coverage flags); `topics/de.yaml` (first topics, `state_specific` flags)
Done when: private repo exists with licence, privacy docs and region/topic files.

## Phase 1: Sources (federal + 3 pilot states)
- [ ] `source-scout` per source: terms, structure, crawl method, catalogue keys. Federal (service.bund.de, BAMF, tax and health insurance basics), Berlin (service.berlin.de), Brandenburg, Bavaria
- [ ] Evaluate service.berlin.de language versions (en, ru, uk, de_plain) as answer sources; check whether other states offer English
- [ ] Choose first 10-15 procedures and the topics they map to; mark which are state-specific
- [ ] `sources/de/<source>.yaml` per source with terms note and crawl method
- [ ] ADR update: what may be served or published per source
Done when: every pilot source has a terms note and crawl method.

## Phase 2: Ingestion (Python)
- [x] Fetcher driven by `sources/*.yaml` (identified User-Agent, 1 req/s, robots.txt)
- [x] Berlin, Brandenburg, Bavaria and federal adapters (42 seed pages; federal has rundfunkbeitrag.de, BZSt, Familienkasse, no BAMF/health yet)
- [x] Cleaner to Markdown snapshots (local, not in git); section chunker keeping title + heading
- [x] Metadata: region (Land or federal), `topic_key`, `leika_key` where present
- [x] German stemming (Snowball) and keyword index
- [~] Embedder interface done (hash + fastembed; Gemini not implemented, verify first); Gemini implementation (check model, dimension options) plus local fastembed option
- [x] Loaders: bundle builder and Postgres loader (tested on pgvector/pgvector:pg17: 37 docs, 418 chunks, second run skips all)
- [x] Report script: counts per state/topic, partition sizes, no raw text
Done when: one command builds the pilot corpus and prints a short report. (Done 2026-10-18: `pilot`.)

## Phase 3: Retrieval and /ask (TypeScript Worker)
- [x] Retriever interface (`core/retriever/`); bundle backend; contract test (`contract.ts`, runs on bundle; Postgres backend must pass it too)
- [~] **Backend measurement** (ADR 0004; local Node proxy done on the real 11.5k-chunk Berlin portal, see SPIKE-RESULTS; real Worker/Neon/Vectorize runs open): full Berlin portal (~14k chunks) on real Worker with bundle (with and without topic prefilter) vs Postgres (Neon) vs Vectorize; record CPU, wall latency, limits; decide default
- [x] Postgres backend (`core/retriever/postgres.ts`, passes the contract); Vectorize not tried
- [~] LLM and embeddings interfaces; Gemini implementation written and tested with a fake fetch, no live call yet
- [x] Pipeline per ADRs 0005 and 0009 (`core/pipeline/ask.ts`, fake LLM/embedder tests; real model output untested): context modes, German rewrite + topic pick, per-region hybrid retrieval, unknown-state handling, move answers, "not covered" and "not answerable" handling
- [x] `POST /ask` (`worker/`): stateless, SSE streaming, no body/IP logging in code, CORS allow-list; runs under `wrangler dev` with fakes (`npm run dev:fakes`); not yet deployed or run against a real database/Hyperdrive
- [ ] Rate limiting and Turnstile
Done when: curl returns cited answers for single-state, Germany-only and a Brandenburg-to-Berlin move within limits.

## Phase 4: UI (TypeScript)
- [ ] Static page: centred empty state, composer at bottom, single column, own branding
- [ ] Location chip: Germany (default) | state picker (16 + not sure) | "Moving?" toggle with from/to states; coverage shown, uncovered states marked
- [ ] Context chips for situation and language; browser-only storage; clear-data button
- [ ] Streaming render, source cards with region badge and crawl date, German-term copy buttons
- [ ] Checklist view (localStorage), privacy warning, opt-in "report wrong answer"
- [ ] Mobile-first, dark/light, example questions incl. a cross-state move
Done when: usable on a phone and no request stores anything.

## Phase 5: Evaluation
- [ ] `eval-writer`: ~150 questions: ~25 per pilot state, ~20 federal, ~30 cross-state moves, "state not covered" and unanswerable cases; `eval/de/<state>.yaml`
- [ ] Human verification of every expected fact (someone who knows the state)
- [ ] Eval runner (retrieval hit rate, answer facts, refusal rate, wrong-state leakage) using real LLM rewrites
- [ ] CI runs eval on pushes; fail below threshold
Done when: baseline recorded in STATUS.md.

## Phase 6: Hardening
- [ ] No-logging test for prompts, bodies, IPs (Worker, CI)
- [ ] LLM tier excluding training on inputs; document in PRIVACY.md
- [ ] Scheduled recrawl per state, changed/dead page report
- [ ] Docker Compose / Node self-host path
- [ ] Prompt-injection and abuse checks, cost cap
- [ ] Recheck Cloudflare and database free limits (CPU, requests/day, storage, CU-hours)

## Phase 7: Go public (checklist in WORKFLOW.md)

## Phase 8: Scale
- [ ] Remaining states (adapter + terms + eval each), contributor guide for a new state
- [ ] City/district layers (e.g. Spandau offices)
- [ ] Branches + PRs, issue templates
- [ ] Other countries via country packs

## Open items
- Name checks for Plainstamp (ADR 0008): trademark and product search
- Terms for reusing crawled text, per state (Phase 1)
- Retrieval backend default (Phase 3 measurement, ADR 0004)
- Free-plan CPU enforcement discrepancy (spike); recheck with real data
- Gemini embedding model name, dimension options, free-tier limits
- Real LLM rewrites vs the hand-written ones used in the spike
- How reliably the LLM picks `topic_key` (affects prefilter and state-specific handling)
