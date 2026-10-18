# Evaluation questions

`eval/de/<group>.yaml`: federal, berlin, brandenburg, bayern, moves (cross-state, not covered, unanswerable).
`eval/berlin-smoke.yaml` is the old hand-picked retrieval smoke set.

All entries are drafted by the `eval-writer` agent from the locally crawled pages and are marked
`verified_by: eval-writer (pending human check)`. A person who knows the state must check every expected fact
before the numbers count as a baseline.

```yaml
- id: be-anmeldung-001            # <region>-<topic>-<nnn>
  type: answerable                # answerable | move | not_covered | needs_state | unanswerable
  language: en
  question: "How do I register my new flat in Berlin?"
  context: {mode: state, state: de-be}          # mode germany | state | move (fromState, toState)
  topic_key: anmeldung            # from topics/de.yaml; omit for unanswerable
  expected_facts:                 # short, atomic, each supported by a listed page
    - "Registration is required within two weeks"
  expected_docs: [berlin-120686]  # doc ids a good answer should cite (any of them counts)
  not_covered: []                 # region ids the answer must say are not covered (type not_covered)
  source_urls: ["https://service.berlin.de/dienstleistung/120686/"]
  verified_on: 2026-10-18
  verified_by: eval-writer (pending human check)
```

Doc ids: `berlin-<service id>`, `bb-<bus id>`, `by-<id>`, `de-<slug>` (federal: rf-anmelden, rf-befreiung,
rf-umzug, bzst-idnr, ba-kindergeld). Unanswerable questions have no `expected_docs`; a good answer says the
pages do not cover it and points to the responsible office.

## Running

- `python scripts/validate_eval.py`: mechanical checks (schema, doc ids exist, topics, regions, duplicates).
- `EMBEDDING_PROVIDER=fastembed python scripts/eval_retrieval.py`: retrieval baseline, no key, no German rewrite.
- `npx tsx scripts/eval_pipeline.ts`: full pipeline with real rewrite, cited answer and an LLM judge for
  expected facts; needs GEMINI_API_KEY, DATABASE_URL and a database embedded with the same embedder as the
  query side. Thresholds in `eval/thresholds.json`.

CI runs type checks and unit tests only. The eval needs the crawled corpus (not in git, ADR 0007) and an API
key, so it is run locally for now.
