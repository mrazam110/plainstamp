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
