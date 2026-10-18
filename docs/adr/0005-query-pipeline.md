# ADR 0005: Query pipeline with German rewrite and hybrid search

Status: Accepted (2026-10-16)

Context: Spike on 130 Berlin service pages: English questions as asked gave keyword hit@5 of 0.18 and vector hit@5 of 0.67. With a German rewrite, vector reached 0.94 and hybrid 1.00 (hand-written rewrites, so optimistic). Similarity scores of off-topic questions (0.61-0.68) overlapped answerable ones (min 0.57), so a score threshold cannot decide "no evidence".

Decision: Pipeline per question: (1) detect language, ask a clarifying question if region or situation is missing and needed; (2) LLM rewrites the question into German search queries; (3) hybrid retrieval (vector on original and rewrite, keyword on rewrite, reciprocal rank fusion) filtered by region ancestors; (4) optional rerank; (5) LLM answers only from retrieved chunks, as a checklist with German terms beside translations, citing source URL and crawl date; (6) the LLM must say when the chunks do not answer the question. Retrieved text is marked as untrusted data in the prompt.

Consequences: Two LLM calls per question (rewrite, answer), which matters for free-tier rate limits. Refusal quality must be measured in the eval set (include unanswerable questions). Rewrite quality must be re-tested with real LLM output.
