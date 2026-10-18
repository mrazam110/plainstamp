# ADR 0002: Stateless server, no storage of user prompts

Status: Accepted (2026-10-16)

Context: Users ask about residence status, family and money. We want a small, flat data footprint and a privacy claim that readers of the open-source code can verify.

Decision: The server never persists or logs prompts, answers, request bodies or IPs. Chat history and context (city, situation, language) live only in the browser (localStorage, with a "clear data" button) and are resent with each request. Rate limiting uses the platform limiter only. Users get a warning not to enter personal data; no automatic detection for now. Feedback is opt-in and shows exactly what will be sent. `PRIVACY.md` documents this. A test must assert that no body/IP reaches any log or store.

Consequences: No server-side history, no per-user analytics, no account system. The LLM provider still sees prompts, so provider tier and terms must be chosen and documented (use a tier that excludes training on inputs for the public launch). Answer caching keyed on question text is not allowed unless a later ADR approves it.
