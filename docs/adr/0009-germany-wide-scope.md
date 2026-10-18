# ADR 0009: Germany-wide scope, state-level regions, cross-state scenarios

Status: Accepted (2026-10-17). Supersedes the Berlin/Spandau-first scope in earlier docs.

Context: Many users move between states (for example Brandenburg to Berlin) or do not know which state's rules apply. The spike (docs/SPIKE-RESULTS.md) covered only Berlin. Each state runs its own service portal with its own structure and terms of use.

Decision:
- **Architecture is Germany-wide from day one.** Region tree: Germany > Land (16). City/district (e.g. Spandau office layer) is an optional later layer.
- **Coverage is staged.** Pilot: federal + Berlin + Brandenburg + Bavaria. The UI and README show a coverage list. The assistant says plainly when a state is not covered and falls back to the federal overview.
- **Context model** sent by the browser: `mode` = `germany` | `state` | `move`; `state`; `from_state`/`to_state` for moves; situation; language. Default is `germany`.
- **Cross-state key.** Every chunk carries `topic_key` (our slug, e.g. `anmeldung-wohnsitz`) and `leika_key` when the source provides the official service-catalogue key. A `topics/de.yaml` file lists topics, labels and a `state_specific` flag. This lets us find the same procedure in two states.
- **Multi-region retrieval.** Retrieve separately for federal, each selected state (k per region), then merge, so one state cannot crowd out another. Region filter is hard: chunks of one state never appear in another state's answer unless that state was selected.
- **Unknown state.** If the topic is `state_specific` and no state is chosen, answer with the federal overview, say which parts vary by state, and ask which state applies.
- **Moves.** Answer sections: federal steps, steps at the old place, steps at the new place, each attributed to its state with source and crawl date.
- **One adapter per state source**, driven by `sources/de/<state>.yaml`, each with recorded terms.

Consequences:
- Phase 1 and 2 grow (a source adapter, terms check and topic mapping per state). Maintenance grows with every state.
- Chunk counts rise to roughly 10-15k per state and 150-200k for Germany (extrapolated from the Berlin spike); this triggers the retrieval backend revisit in ADR 0004.
- Prompts for moves are longer (two or three regions), costing more tokens against free-tier limits; cap chunks per region.
- Evaluation needs per-state questions, move scenarios, "state not covered" and unanswerable cases, verified by someone who knows the state.
- Wrong state-specific advice is worse than none, so coverage labels and "not covered" answers are requirements, not polish.
