# ADR 0010: Commit text and authorship policy

Status: Accepted (2026-10-18)

Context: Parts of this project are drafted with AI tools. Tools often add attribution lines to commits and PRs. The maintainer wants the history to read as the work of the people responsible for it.

Decision:
- Commit messages, PR titles and descriptions are short, specific and in a plain human voice, run through the `humanizer` skill before use.
- No LLM or tool signatures in commit messages, PR titles or bodies, issues, comments, changelogs or release notes: no `Co-Authored-By` naming a model or tool, no "Generated with ..." lines, no model names.
- The human who commits or merges is responsible for the change, whoever or whatever drafted it, and reviews AI-written code before it lands.
- Enforcement: a `commit-msg` hook in `.githooks/`, a CI check on commits and PR text, the `commit-reviewer` agent, and an item in the public-flip checklist that scans history.
- The DCO sign-off (`Signed-off-by`) is the human's own.

Consequences: Contributors using AI tools must strip any tool-added trailers before pushing. The hook can have false positives on legitimate text such as a commit about an LLM provider integration; the pattern list should target signature lines and trailers, not any mention of a model name in a code-related subject. History rewrite is needed before going public if a signature slipped in.
