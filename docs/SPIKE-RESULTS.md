# Spike results (2026-10-16)

Throwaway scripts lived in the session scratchpad, not in this repo. No data from the crawl is committed. Test Worker has been deleted from Cloudflare.

## Stage A: vector scoring cost (Node 22, Apple M1 Pro, brute force, top-20)
| Vectors x dims | median ms |
|---|---|
| 2k x 768 | 1.5 |
| 5k x 768 | 3.8 |
| 20k x 768 | 15 |
| 50k x 768 | 37 |
| 20k x 256 | 5.2 |
| 50k x 256 | 13 |

- int8 saves memory (4x) but not time in plain JS.
- Parsing 5k x 768 vectors from JSON took ~144 ms vs ~0 ms as a binary typed array. **Vectors must be stored as raw binary.**

## Stage B: real Cloudflare Worker (static assets, synthetic vectors)
| Config | warm CPU (median / max) | cold CPU |
|---|---|---|
| 5k x 768 f32 | ~15 ms / 34 | ~46 ms |
| 20k x 768 int8 | ~60 ms / 119 | ~116 ms |
| 20k x 256 f32 | ~37 ms | ~39 ms |

- Worker CPU was roughly 3-4x slower than the laptop and noisy.
- No request was cut off, even a 2.4 s CPU burn. So this account is **not** held to the 10 ms CPU limit I remembered for the free plan. **Unresolved: confirm the plan (Workers & Pages > Plans) and current free-plan CPU limit before relying on this.** If the real limit is ~10 ms, in-Worker scoring only fits partitions of ~2-3k chunks.
- R2 was skipped (believed to require a payment method); static assets worked without one.

## Stage C: retrieval quality on real Berlin data
Data: 130 service pages from service.berlin.de (German), 1,617 chunks (1,424 Berlin-wide, 193 Spandau office entries). Embeddings: paraphrase-multilingual-MiniLM-L12-v2 (384-d, run locally). Keyword search: BM25 with the Snowball German stemmer (the same stemmer Postgres uses for `german` full-text search). 33 questions, hit = an acceptable source page in the top k.

| Setup | hit@1 | hit@3 | hit@5 | hit@10 |
|---|---|---|---|---|
| Vector, English question as asked | 0.45 | 0.61 | 0.67 | 0.79 |
| Keyword, English question as asked | 0.12 | 0.18 | 0.18 | 0.24 |
| Vector, German rewrite | 0.64 | 0.85 | 0.94 | 1.00 |
| Keyword, German rewrite | 0.73 | 1.00 | 1.00 | 1.00 |
| Hybrid (vector + keyword, German rewrite) | 0.79 | 1.00 | 1.00 | 1.00 |
| Hybrid 3-way (vector on both phrasings + keyword on rewrite) | 0.88 | 0.97 | 1.00 | 1.00 |

Findings:
1. **The German query-rewrite step is essential.** English questions make keyword search useless and cut vector hit@5 from 0.94 to 0.67.
2. **Hybrid beats either alone**, mainly on hit@1.
3. **Files are enough for quality.** Stemming in the keyword index matches what Postgres would do, so a database is not needed for German keyword quality.
4. **"No evidence" cannot rely on a similarity threshold.** Off-topic questions scored 0.61 and 0.68 cosine, inside the range of real answerable questions (min 0.57). Refusal needs an LLM judgement step or a reranker, plus the eval set.

Caveats (important):
- I wrote the German rewrites by hand knowing the page titles, so keyword and rewrite results are optimistic. Re-test with real LLM-generated rewrites.
- Questions and expected pages were chosen by the same person who read the corpus. Small sample, no human verification yet. Phase 5 eval (100 verified questions) is the real test.
- German compound words, abbreviations and tax/health-insurance topics (federal, not on this portal) were not tested.
- MiniLM truncates long chunks (128 tokens) and is weaker than Gemini/BGE-M3 embeddings.

## Source findings (service.berlin.de, for Phase 1)
- `robots.txt` allows `/dienstleistung/` pages and disallows `/pdf/` variants. Terms require an identifying User-Agent and robots compliance; access may be blocked at their discretion. An appointment API exists under `/terminvereinbarung/api` and needs prior contact.
- The portal offers **English, Russian, Ukrainian and plain-German versions** (`/dienstleistungen/en/`, `/ru/`, `/uk/`, `/de_plain/`). Not yet evaluated as a source for English answers.
- One page per service (1,140 listed) with consistent sections: Voraussetzungen, Erforderliche Unterlagen, Formulare, Gebühren, Rechtsgrundlagen, Bearbeitungszeit, plus a list of all responsible offices of all districts with contact details. The Spandau layer can be extracted by office name (Rathaus Spandau, Staaken Center, Wasserstadt, Kladow).
- Service titles use official vocabulary (Anmeldung is titled "Wohnsitz - Alleinige Wohnung oder Hauptwohnung anmelden"), which is why rewriting matters.
- Terms of reuse for storing/publishing the text are **not yet cleared** (Phase 1 ADR).

## Size estimates (rough)
- 130 services -> 1,617 chunks. Whole portal (~1,140 services) with only the Spandau office layer: ~14k chunks. With all districts' offices kept: ~35k.

## Decisions suggested by the spike
1. Retriever interface with a **file-bundle backend first** (binary vectors + prebuilt keyword index, partitioned by region); Postgres/Vectorize as a later backend.
2. **Query pipeline must include German rewriting** before retrieval, and hybrid search.
3. Refusal handled by LLM judgement over retrieved chunks, not by a score threshold alone.
4. Keep partitions at or below a few thousand chunks per Worker until the plan/CPU question is resolved.

## Implication for Germany-wide scope (added 2026-10-17)
The spike covered only Berlin (130 services, ~12 chunks per service). A whole state portal is ~1,000 services, so ~10-15k chunks per state and ~150-200k for Germany (extrapolation). That is above what in-Worker brute-force scoring handles within 10 ms, so ADR 0004 now leaves the backend to a Phase 3 measurement on the full Berlin portal. The German-rewrite and hybrid-search findings carry over, but cross-state questions, topic keys and per-state terms were not tested.

## Phase 2 smoke check (2026-10-18)
13 Berlin services, 160 chunks, MiniLM 384-d, 15 hand-written questions (`eval/berlin-smoke.yaml`, `scripts/retrieval_check.py`), hit@5 by service page: keyword 9/15, vector 14/15, RRF 15/15. Keyword misses are the English questions, which the German rewrite step (ADR 0005) should fix. Corpus is tiny and the questions easy, so this is a plumbing check, not a quality result.

## Phase 3 local bundle benchmark (2026-10-18)
`scripts/bench_bundle.ts` tiles the Berlin bundle to 14,112 chunks (384-d, one vector + keyword query, k=8) and times `BundleRetriever.search` in Node 22 on the laptop. Tiling inflates keyword postings, so BM25 cost is slightly overstated; vector cost is real.

| Case | median | p95 |
|---|---|---|
| no prefilter | 10.9 ms | 12.1 ms |
| 1-topic prefilter | 1.1 ms | 1.5 ms |
| 3-topic prefilter | 3.4 ms | 4.1 ms |

Cold parse of a state bundle: keyword.json 4.1 MB 38 ms, chunks.jsonl 12.8 MB 31 ms. Vectors 21.7 MB (typed array, no parse).

Reading it: the spike found a Worker at 3-4x laptop CPU, so no-prefilter would be roughly 35-45 ms against the documented 10 ms Free limit, and the cold parse alone roughly 200 ms. A 1-topic prefilter fits (about 4 ms) only if the topic pick is reliable, and the cold parse still has to be avoided (lazy chunk text, keyword index per topic shard, or a database). This is a laptop proxy, not the Worker measurement ADR 0004 asks for. The real run (deploy a test Worker with the bundle, same queries) and a Postgres/Neon and Vectorize comparison are still open.

## Full Berlin portal, real data (2026-10-18)
Crawl of all 1,140 services in `service.berlin.de` (2 s delay, no failures): 11,566 chunks (not the ~14k extrapolated; avg 479 chars), 134 with a LeiKa key. Embedding with fastembed MiniLM (CPU) took 3.5 min. Bundle: vectors 17.8 MB, keyword.json 3.7 MB, chunks.jsonl 9.2 MB.

Search in Node, no prefilter, 1 vector + keyword, k=8: median 8.4 ms, p95 9.6 ms (real postings, so not inflated). Cold parse about 60 ms. At the spike's 3-4x Worker factor that is roughly 25-35 ms per search, over the 10 ms limit; a topic prefilter was not measured meaningfully because 98% of chunks have topic_key `other` (only the 13 pilot services are classified). Real topic classification is needed before the prefilter idea can be judged.

Retrieval quality on the same 15 smoke questions (`scripts/retrieval_check.py berlin-full`), hit@5 by one expected service page: keyword 5/15, vector 10/15, RRF 9/15 (13-service corpus: 9, 14, 15). Fusion no longer beats vector alone. Causes to check: many near-duplicate service pages compete (the expected page is one of several valid ones, so the metric is too strict; Phase 5 needs acceptable-page sets), English queries get no keyword help without the German rewrite, and RRF weights keyword and vector equally. Do not rely on the 13-service numbers.

## Topic classification, acceptable pages, fusion weights (2026-10-18)
Topics are now assigned by title pattern (`title_pattern` in `topics/de.yaml`, `classify.py`): 1,315 of 11,566 chunks are classified (11%), the rest `other`. Residence permit is the biggest topic (773 chunks), car registration 248. A topic prefilter hides `other` chunks whenever it matches anything, so the topic pick must stay reliable and `other` pages will not surface for those questions; this needs the Phase 5 eval to quantify.

Smoke set redone with acceptable-page sets and a hand-written German rewrite for the English questions (optimistic, stands in for the LLM rewrite). Full portal, 15 questions, hit@5 / hit@1: vector on the original 11/6, keyword on the rewrite 12/9, weighted RRF with keyword weight 0.25: 14/8, 0.5: 14/9, 1.0: 13/9. Fusion now clearly beats either alone. Weight 0.5 is set in `core/retriever/bundle.ts`; the 0.25-1.0 range differs by one question, so this is a middle pick, not a tuned result, and it was chosen on the same 15 questions (overfit risk). Remaining misses: "Ich ziehe ins Ausland, muss ich mich abmelden?" and "Wir wollen heiraten, beide haben deutsche Papiere" at rank 1.

Node bench on the real bundle after the change: no prefilter 8.4 ms median, 1 topic 0.1 ms, two large topics (residence-permit + car-registration, about 1k chunks) 0.8 ms. Worker factor still unmeasured; the spike's 3-4x puts no-prefilter at 25-35 ms.

## Postgres backend (2026-10-18)
`core/retriever/postgres.ts` (postgres.js, pgvector halfvec cosine + German `to_tsquery` with OR terms, shared `fuse.ts`) passes the same 6-case retriever contract as the bundle backend (`DATABASE_URL=... npm test`; the contract test runs in its own schema and drops it).

Wall latency on the full Berlin portal (11,566 chunks, local Docker pgvector 17, hnsw index, `scripts/bench_pg.ts`): no prefilter median 13.9 ms / p95 37.9 ms, 1 topic 1.8 / 3.3 ms, two large topics 6.3 / 9.9 ms. This is database wall time on localhost; a hosted database adds a network round trip and possible compute wake-up, so Neon numbers will be higher. What matters for the 10 ms Worker CPU limit is that Worker CPU here is only query building, I/O waiting and a 50-row fusion, independent of corpus size, unlike the bundle backend (8.4 ms laptop CPU at 11.5k chunks, 25-35 ms estimated on a Worker). Provisional reading: Postgres is the default for state-sized partitions, bundles stay an option for small partitions or with a reliable topic prefilter. Still open: a real Worker plus Neon (or Hyperdrive) run for CPU and wall time, and Vectorize.

## Eval baseline, retrieval only (2026-10-18)
125 questions (`eval/de/`: Berlin 27, Brandenburg 21, Bavaria 27, federal 15, cross-state/not covered/unanswerable 35), drafted by the eval-writer agent from the crawled pages, expected facts NOT yet checked by a person. 94 have expected docs. `scripts/eval_retrieval.py`, k=6 per region, hybrid RRF, the question itself as the only query (no German rewrite): hit@6 0.78 overall; German questions 0.90, English 0.71; Bavaria 0.87, federal 0.92, Brandenburg 0.82, Berlin 0.70 (full 1,140-page portal), moves 0.61. Wrong-region leaks: 0. Caveat: most questions list one expected page, but near-duplicate pages exist, so this undercounts. Numbers in expected facts were checked mechanically against the snapshots (all found). Not measured yet: rewrite effect, answer facts, refusal rate, needs-state and not-covered behaviour with a real model (needs GEMINI_API_KEY and a Gemini-embedded index).

## First real-model eval, pilot corpus (2026-10-18)
Pipeline `scripts/eval_pipeline.ts`: real `gemini-3.5-flash-lite` for rewrite, answer and fact judge, `gemini-embedding-2` at 768 dimensions, local Postgres with the 42 pilot pages (463 chunks; the full Berlin portal could not be embedded, see quotas). 121 of 125 questions (4 Berlin questions need pages outside the pilot). Expected facts are unchecked by a person and the judge is the same model family, so treat as indicative.

| Type | n | right page cited | fact recall | false refusal | other |
|---|---|---|---|---|---|
| all | 121 | 0.93 | 0.71 | 0.05 | wrong-state leaks 0 |
| answerable | 72 | 0.94 | 0.82 | 0.06 | |
| move | 15 | 1.00 | 0.64 | 0.00 | |
| needs_state | 12 | - | 0.36 | - | asked for a state 12/12 |
| unanswerable | 14 | - | 0.43 | - | cited nothing 14/14 |
| not_covered | 8 | 0.33 | 0.40 | - | named the uncovered state 8/8 |

All thresholds in `eval/thresholds.json` pass. Reading the low fact scores: for needs_state and unanswerable the "facts" are behaviours (asks which state, points to an office) and the judge is strict. A real defect found by reading answers: with no state chosen, a federal "overview" for registering a flat was the broadcasting-fee page. Fixed in `core/pipeline/ask.ts` (federal pages must match the picked topic, otherwise just ask which state); the re-run is blocked by the quota below.

## Free-tier quotas observed (Gemini API, new project, 2026-10-18)
- `gemini-embedding-2`: 100 embeddings per minute, and a **daily cap that was reached after about 1,000 embeddings** (463 corpus chunks, probes, eval queries); reset about five hours later. Full Berlin portal (11.4k chunks) would take about 12 days at that rate, so it needs billing or a smaller corpus.
- `gemini-3.5-flash-lite`: about 15 requests per minute; no daily cap hit after about 400 calls.
- Each user question costs 3-4 embeddings (question plus rewrites) and 2 text calls, so the free tier serves on the order of 250 questions a day. Public use needs a paid tier or a stricter global limit.

## Corpus decision under the free embedding cap (2026-10-18)
The maintainer will not enable billing, so the Gemini-embedded corpus is the 42 pilot pages plus the Berlin pages whose title maps to a topic in `topics/de.yaml`: source `berlin-topical`, 98 pages, 1,293 chunks (168 already embedded), reusing the HTML crawled for `berlin-full`. 1,125 chunks remain, about one day of free quota; each eval run of 121 questions needs about 450 embeddings of its own, so embedding and eval runs alternate by day. `berlin-full` stays crawled on disk but is not embedded (`embed: false`). Consequence for users: Berlin questions outside the 13 classified topics get "no evidence" answers until more pages are added to the topic list. `scripts/embed_daily.sh` continues the run (exit 3 means the cap was hit; run again after the reset).

## Neon and the Workers runtime (2026-10-19)
Neon project in AWS eu-central-1 (Frankfurt), branch `production`, pgvector 0.8.6, loaded with the 42 pilot pages (463 chunks, 768-d). A read-only role `plainstamp_ro` (SELECT only, writes blocked) is what the Worker should connect with. `worker/src/dev-db-check.ts` under `wrangler dev` (workerd, not the Node driver) ran the real retriever against Neon: 5 hits from the right page, about 420 ms including a new TCP/TLS connection per request from a laptop. This surfaced a bug the Node tests could not: with the driver's type lookup off (as in the Worker), arrays were sent as plain text; `core/retriever/postgres.ts` now sends array literals with a `::text[]` cast and the tests run with the Worker settings. A full `/ask` through the real Worker config with real Gemini and Neon returned a streamed, cited Berlin answer (Bürgeramt, 14 days, Wohnungsgeberbestätigung). CPU time on Cloudflare's 10 ms limit is still unmeasured: local workerd does not enforce it.

## Eval fact cross-check (2026-10-19)
`scripts/check_eval_facts.ts` asked the text model, per question, whether each expected fact is clearly supported by the text of its expected pages. 294 facts checked, 10 flagged: 6 are behaviour facts on not-covered questions (no page can support them; the script now skips them), 3 were judge misses on facts that are in the pages (Brandenburg two-week deadline, Bavaria fine up to 1,000 EUR), and 1 was a real error (a Brandenburg ID-document fact the page does not contain), removed from `eval/de/moves.yaml`. Numbers in facts had been matched against the pages earlier. This lowers the chance of wrong facts but does not replace the check by someone who knows the states; the judge is the same model family that answers.
