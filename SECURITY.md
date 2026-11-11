# Security policy

## Reporting a vulnerability
Please report security problems privately, not in a public issue.

Use GitHub's private reporting: open the [Security tab](https://github.com/mrazam110/plainstamp/security/advisories/new) and choose "Report a vulnerability". If that is not possible, email the maintainer address in the [README](README.md).

Include what you found, how to reproduce it, and what it affects. You will get a first reply within 7 days. This is a one-person project, so fixes depend on severity and availability.

## Scope
- The Worker API (`/ask`, `/feedback`), the chat page, the ingest scripts and the CI workflows in this repository.
- The hosted pilot at https://plainstamp.razadetechnologies.com. Please do not load-test it or try to bypass its rate limit or Turnstile check beyond what is needed to show a problem.

## Out of scope
- Wrong or outdated answers (the model can be wrong; use a normal issue and link the source).
- Findings that need a leaked secret. Tell us and we will rotate it.

## Privacy
The service is built not to store questions, answers or IP addresses ([PRIVACY.md](PRIVACY.md)). Anything that breaks this is a security issue; please report it the same way.
