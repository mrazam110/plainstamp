# ADR 0001: License AGPL-3.0-only for code

Status: Accepted (2026-10-16); amended 2026-10-20: "or later" dropped, the licence is AGPL-3.0-only

Context: Non-commercial civic project that should stay open. Anyone may self-host. We do not want a closed hosted fork built on volunteer work.

Decision: Code under AGPL-3.0-only (SPDX `AGPL-3.0-only`: version 3 of the licence, no "or any later version" option). `LICENSE` holds the full text and `package.json` carries the same identifier. Per-file SPDX headers are optional and not added for now. Corpus-derived data, region configs and eval questions are licensed separately (CC-BY or CC0 where the source terms allow). Contributions use a DCO sign-off, no CLA. Name and logo are not covered by the code licence.

Consequences: Hosted modified versions must publish their changes. Some companies and government IT departments avoid AGPL, which may limit adoption. Relicensing later needs consent of all contributors, which DCO does not provide, so keep the contributor list small until this is final.
