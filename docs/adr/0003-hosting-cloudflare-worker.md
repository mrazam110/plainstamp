# ADR 0003: Static page plus Cloudflare Worker REST API, free tier

Status: Accepted (2026-10-16)

Context: Zero hosting cost, no income. Owner's Cloudflare account is on the Free plan (confirmed 2026-10-16). R2 is believed to require a payment method, so it is not used. Documented free limits: 10 ms CPU per request, 128 MB memory per isolate, 50 subrequests per invocation, 100k requests per day (Cloudflare docs, to be rechecked before launch).

Decision: UI is a static page (TypeScript, no Next.js) on Cloudflare Pages or Worker static assets. `POST /ask` is a Worker. Bundles are served as Worker static assets (files up to 25 MB). Turnstile and platform rate limiting protect the endpoint. Self-hosters can run the same Worker code on Node.

Consequences: CPU budget of 10 ms per request drives retrieval design (ADR 0004). Daily request cap limits traffic; caching of static bundles is fine, caching of answers is not allowed (ADR 0002). A spike test on this account was not cut off at 2.4 s CPU, contrary to the docs; unexplained, so we design to the documented limit.
