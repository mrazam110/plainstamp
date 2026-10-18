# ADR 0004: Retrieval behind an interface; backend chosen by measurement

Status: Revised 2026-10-17 (was: file bundles first). Backend choice pending the Phase 3 measurement.

Context: Spike (docs/SPIKE-RESULTS.md): brute-force scoring on a Worker cost about 15 ms warm for 5k x 768 vectors, 3-4x the laptop time; Cloudflare docs give 10 ms CPU per request on Free. JSON-parsed vectors are far too slow; binary typed arrays are free. Berlin gave ~12 chunks per service, so one state portal (~1,000 services) is ~10-15k chunks and Germany ~150-200k (ADR 0009). That exceeds what in-Worker scoring can do within 10 ms. Neon free tier (per pasted pricing): 1 GB per project, 100 CU-hours/month, 5 GB object storage; at ~5 KB per chunk with halfvec that is roughly 200k chunks per GB (estimate, to verify), so Germany fits only tightly.

Decision:
- Keep the `Retriever` interface with three possible backends: `bundle` (static files, in-Worker scoring), `postgres` (pgvector + German full-text), `vectorize`.
- Partitions: federal plus one per Land (city layers later). A query touches federal plus the selected state(s).
- **Provisional plan:** `postgres` for state-sized partitions, `bundle` for small partitions (federal, development, light self-hosting). Final default is set by a Phase 3 measurement on a real state-size dataset (the full Berlin portal, ~14k chunks): in-Worker scoring passes only if p95 CPU is under 8 ms with topic/region prefilter; otherwise use the database or Vectorize.
- Also evaluate topic sub-partitions (state x topic, hundreds of chunks each) for in-Worker scoring; it depends on reliable topic classification, so test the misclassification rate.
- Whatever the backend: normalised vectors of 384-512 dimensions (halfvec in Postgres), German-stemmed keyword search (Snowball, same as Postgres `german`), hard region filter, contract test that runs the same queries against every backend.

Consequences: No backend is final until measured. Ingestion builds both outputs (bundle and Postgres load). Free-tier pauses, connection limits and CU-hours become a concern if Postgres is chosen; verify before relying on them. Switching backends should cost a few days if nothing outside the retriever touches the stored format (pipeline sees only `{chunk, score}`).

Bundle format (when used): `manifest.json`, `vectors.bin` (raw float32, normalised), `chunks.jsonl`, `keyword.json` (prebuilt German-stemmed index), versioned folders with an active pointer.
