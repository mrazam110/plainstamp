# ADR 0011: Source terms and what may be stored or served

Status: Accepted (2026-10-18)

Context: Phase 1 scouting found that no pilot source offers an open licence. Berlin allows copies for private use only and wants written approval for public use. BayernPortal requires consent for reproduction. Brandenburg states no terms. Federal sites state none we could find. FIM's robots.txt blocks AI crawlers.

Decision:
- Every `sources/de/*.yaml` carries `terms.status` and two flags: `crawl.allowed_local_dev` (private research and testing, within robots.txt) and `crawl.allowed_public` (serving text to other people). Ingestion for local use needs the first; a public deployment needs the second.
- Before any public deployment (including a portfolio demo that shows source text), ask each operator in writing for permission to store the text, embed it and quote short excerpts with a link and date. Contacts are in the source files. Keep the replies in `sources/permissions/` (no personal data).
- Until permission arrives, crawled data is used for local development, testing and evaluation only and is never committed or published. Answers may link to official pages without copying text.
- Fallback if permission is refused: link-only answers built from our own paraphrase of facts, or prefer sources that grant a licence (federal data via GovData, open data portals).
- Re-read each Impressum and robots.txt at crawl time. Honour crawl-delay, use an identifying User-Agent, never fetch disallowed paths.

Consequences: Phase 2 to 5 can run on real sources locally. Public launch waits for permissions. A portfolio can show code, architecture and eval results meanwhile. This is not legal advice; ask a lawyer before going public.
