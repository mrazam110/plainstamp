# Architecture

Decisions live in `docs/adr/`. Measurements in `docs/SPIKE-RESULTS.md`. Scope: Germany-wide architecture, staged coverage (ADR 0009).

## Two pipelines
```
OFFLINE (laptop / GitHub Actions / self-hoster's machine)
  sources/de/<state>.yaml -> fetch (polite, identified) -> clean to Markdown -> chunk by section
    -> tag metadata (region, topic_key, leika_key) -> embed -> load backend (bundle and/or Postgres)

ONLINE (Cloudflare Worker, stateless)
  question + context {mode: germany|state|move, state | from_state,to_state, situation, language}
  + recent turns, all sent by the browser
   1 detect language; resolve regions from context
   2 if topic is state_specific and no state chosen: federal overview + say what varies + ask which state
   3 LLM rewrites the question into German search queries and picks topic_key(s)
   4 retrieve per region (federal, each selected state), hybrid (vector on original + rewrite, keyword on rewrite, RRF),
     hard region filter, k per region, then merge
   5 optional rerank
   6 LLM answers only from retrieved chunks, attributing each rule to its state:
     federal steps / steps at old place / steps at new place; checklist, German terms, citations, crawl dates
   7 LLM states when the chunks do not answer it, or when a state is not covered
```

## Region tree and coverage
Germany > Land (16). Optional later layer: city/district (e.g. Spandau offices). Each chunk has `region_id`. Pilot coverage: federal + Berlin + Brandenburg + Bavaria; other states show as "not yet covered" in the UI and in answers. Coverage list is data (`regions/de.yaml`), shown in the README and UI.

## Cross-state key
Every chunk has `topic_key` (our slug) and `leika_key` when the source offers it. `topics/de.yaml` lists topics, labels, a `state_specific` flag and known catalogue keys. Used to fetch the same procedure for two states in a move and to decide when to ask which state applies.

## Retrieval backends (ADR 0004)
`Retriever.search(query, region_ids, k)` returns `{chunk, score}`. Backends: `bundle` (static files, in-Worker scoring), `postgres` (pgvector + German full-text), `vectorize`. Provisional: Postgres for state-sized partitions (~10-15k chunks each), bundles for small partitions. Final choice after the Phase 3 measurement on the full Berlin portal.

### Bundle format (when used)
```
bundle-<region>-<version>/
  manifest.json   version, embedding model + dimension, chunk count, built_at
  vectors.bin     raw float32, L2-normalised, N x D (no JSON)
  chunks.jsonl    id, doc id, title, heading, region_id, topic_key, leika_key, url, crawled_at, text
  keyword.json    prebuilt inverted index over German-stemmed tokens (Snowball), BM25 stats
```
Served as Worker static assets (files up to 25 MB). Versioned folders with an active pointer for rollback.

### Postgres schema (sketch)
`regions(id, parent_id, name, level, coverage)`, `documents(id, source_url, title, region_id, topic_key, leika_key, language, crawled_at, content_hash)`, `chunks(id, document_id, heading_path, text, embedding halfvec, tsv tsvector)`. No user tables. Worker uses a read-only role.

## CPU budget (Cloudflare Free: 10 ms per request, documented)
Spike: 5k x 768 float32 cost ~15 ms warm on a Worker; cold start adds 30-60 ms. A state-size partition does not fit in-Worker without prefilter. Rules if `bundle` is used: 384-512 dimensions, topic/region prefilter, binary typed arrays, bundle kept in isolate memory. Database or Vectorize otherwise. Unexplained: the test account was not cut off at 2.4 s CPU; do not rely on that.

## Corpus handling
Crawled text, Markdown snapshots, bundles and database contents are build artifacts, not in git (ADR 0007). Re-embedding never needs re-crawling because snapshots are kept locally. Each source's terms are recorded in `sources/`.

## Privacy by construction
Worker holds no state and logs no request bodies or IPs. Browser keeps history and context (including selected states) in localStorage with a clear button. The database holds public documents only. LLM provider still sees prompts; tier and terms in PRIVACY.md (ADR 0002).

## Prompt-injection note
Crawled pages are untrusted data. Ingestion strips scripts and hidden elements; the answer prompt marks retrieved text as data.

## Repo layout
```
core/       pipeline logic, llm/ embeddings/ retriever/ interfaces, prompts/
worker/     Cloudflare Worker (/ask)
web/        static chat page (TypeScript)
ingest/     Python: per-state adapters, clean, chunk, stem, embed, load backends, report
regions/    region tree and coverage (YAML)
topics/     topic taxonomy and cross-state keys (YAML)
sources/    source lists per state (YAML, with terms notes)
eval/       test questions per state and scenario (YAML)
docs/       PLAN, STATUS, ARCHITECTURE, WORKFLOW, SPIKE-RESULTS, adr/
.claude/    agents
```

## Scaling path
Pilot states -> remaining states (one adapter + terms + eval each) -> city layers -> other countries via country packs. Limits: source maintenance, per-state evaluation, partition size per backend.
