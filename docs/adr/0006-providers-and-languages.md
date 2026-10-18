# ADR 0006: Gemini for embeddings and generation behind interfaces; Python ingestion, TypeScript Worker and UI

Status: Accepted (2026-10-16); model names and free-tier limits to verify

Context: Question text already goes to the LLM provider, so using the same provider for embeddings adds no new exposure. Provider free tiers change and may use inputs for training. Embedding models must match between ingestion and query, and switching means re-embedding.

Decision:
- `core/llm/` and `core/embeddings/` interfaces, provider chosen by env var, Gemini as first implementation. Pick a smaller output dimension (384-512) if the model supports it, to meet ADR 0004.
- Store the Markdown snapshots and chunk text so re-embedding never requires re-crawling.
- Local embedding models (via fastembed/ONNX) are supported for development and self-hosting.
- Ingestion in Python (HTML cleaning, chunking, stemming, bundle build, eval). Worker and UI in TypeScript. Shared contract is the bundle format and manifest.
- For the public launch use a provider tier whose terms exclude training on inputs.

Consequences: Two languages in the repo. Bulk embedding runs offline in batches to respect rate limits. Lock-in risk is limited by the interfaces.

## Verification (2026-10-18, from ai.google.dev docs)
- Embeddings: `gemini-embedding-2` is the recommended model. Default 3072 dimensions, `outputDimensionality` 128-3072 (768, 1536, 3072 recommended), truncated outputs are auto-normalised, input limit 8,192 tokens. It has no `task_type`; the task goes into the text (`task: search result | query: ...` for queries, `title: ... | text: ...` for documents). `gemini-embedding-001` stays available (task_type field, manual normalisation below 3072, 2,048 token limit). Embeddings need re-running if the model or dimension changes; the local index still uses MiniLM 384-d.
- Generation: `gemini-3.5-flash-lite` (cheapest 3.5) is the default in `.env.example`; `gemini-3.1-flash-lite` is the budget alternative, `gemini-3.6-flash` if quality needs it. The docs page did not state free-tier limits: check the pricing and rate-limit pages before relying on a free tier, and the terms on training use of inputs (ADR 0002, PRIVACY.md).
- Interfaces: `core/llm/types.ts` and `core/embeddings/types.ts`; Gemini REST clients in the same folders (no SDK, key sent as `x-goog-api-key`, errors carry status only). Tested with a fake fetch; no live call has been made yet (needs a key).
