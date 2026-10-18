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
