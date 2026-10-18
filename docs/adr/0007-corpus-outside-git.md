# ADR 0007: Corpus stored outside git

Status: Accepted (2026-10-16); reuse terms pending (Phase 1)

Context: Official pages are copyrighted unless published under an open licence. service.berlin.de terms (robots.txt) allow automated retrieval only with an identifying User-Agent and robots compliance, and may block at their discretion; nothing found yet on republishing text. Moving files out of git does not remove the licence question, it only changes where the copy lives.

Decision: Git holds code, config, source lists (`sources/`), region trees, eval questions and the crawler. Crawled text, Markdown snapshots and built bundles are build artifacts, never committed, and are not published as dumps. Anyone rebuilds the corpus with one command. Served bundles contain only the chunks the assistant may show, each with source URL and crawl date. Per source, publish text only where the licence is recorded in `sources/*.yaml`.

Consequences: Reproducible builds depend on source sites staying stable. Phase 1 must record terms per source before the repo goes public. The English/Russian/Ukrainian versions of service.berlin.de are candidate sources for answers in the user's language and need the same terms check.

Update 2026-10-17: with Germany-wide scope (ADR 0009) each covered state's source has its own terms. Record them per source before that state is served; a state without cleared terms stays out of the served corpus and shows as not covered.
