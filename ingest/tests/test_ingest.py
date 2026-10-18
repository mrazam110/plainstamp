from pathlib import Path

import pytest

from plainstamp_ingest.berlin import parse_service
from plainstamp_ingest.chunk import chunk_document, _split
from plainstamp_ingest.sources import load_source, ROOT

FIX = Path(__file__).parent / "fixtures"


def doc():
    return parse_service((FIX / "berlin_service.html").read_text(), 1, "anmeldung",
                         crawled_at="2026-10-18")


def test_parse_sections_and_skips_offices():
    d = doc()
    assert d.title == "Wohnsitz - Wohnung anmelden"
    assert [s.heading for s in d.sections] == ["Überblick", "Voraussetzungen", "Gebühren"]
    assert d.sections[1].text.splitlines()[0] == "- Sie haben eine neue Wohnung."
    assert d.sections[2].text == "keine"
    assert d.region_id == "de-be"


def test_chunks_carry_metadata_and_heading():
    chunks = chunk_document(doc())
    assert len(chunks) == 3
    assert all(c.region_id == "de-be" and c.topic_key == "anmeldung" for c in chunks)
    assert chunks[1].text.startswith("Wohnsitz - Wohnung anmelden\nVoraussetzungen\n")
    assert len({c.id for c in chunks}) == 3


def test_split_respects_limit_and_long_lines():
    parts = _split("a " * 700, 100)
    assert all(len(p) <= 100 for p in parts) and len(parts) > 10


def test_source_must_allow_local_dev():
    assert load_source("berlin")["id"] == "berlin-dldb"
    with pytest.raises(PermissionError):
        load_source("fim")


def test_leika_extracted_when_present():
    html = (FIX / "berlin_service.html").read_text().replace(
        "<h1", '<a href="/x?leistungId=99036020001000&amp;p=1">l</a><h1')
    assert parse_service(html, 1, "anmeldung").leika_key == "99036020001000"
    assert doc().leika_key is None


def test_keyword_search_stems_german():
    from plainstamp_ingest.keyword import build_index, search, tokenize
    assert tokenize("Wohnungen") == tokenize("Wohnung")
    idx = build_index(["Sie müssen Ihre Wohnung anmelden", "Die Gebühren für den Führerschein"])
    assert search(idx, "Wohnungen anmelden")[0][0] == 0
    assert search(idx, "Führerscheine")[0][0] == 1
    assert search(idx, "xyzzy") == []


def test_hash_embedder_normalised_and_deterministic():
    from plainstamp_ingest.embed import HashEmbedder
    e = HashEmbedder(64)
    a, b = e.embed_queries(["Wohnung anmelden"]), e.embed_documents([("T", "Wohnung anmelden")])
    assert a == b and abs(sum(x * x for x in a[0]) - 1) < 1e-9


def test_brandenburg_sections():
    from plainstamp_ingest.brandenburg import parse_service as p
    d = p((FIX / "brandenburg_service.html").read_text(), "1", "anmeldung", crawled_at="2026-10-18")
    assert d.region_id == "de-bb" and d.title == "Wohnsitz Anmeldung"
    assert [s.heading for s in d.sections] == ["Ausführliche Beschreibung", "Voraussetzung"]
    assert d.sections[1].text == "- Einzug"


def test_bayern_sections_skip_related_and_offices():
    from plainstamp_ingest.bayern import parse_service as p
    d = p((FIX / "bayern_service.html").read_text(), "0042", "anmeldung")
    assert d.region_id == "de-by" and d.doc_id == "by-0042"
    assert [(s.heading, s.text) for s in d.sections] == [
        ("Beschreibung", "Anmeldung bei der Meldebehörde."), ("Kosten", "keine")]


def test_all_sources_declare_adapter_and_seeds():
    for sid in ("berlin", "brandenburg", "bayern"):
        cfg = load_source(sid)
        assert cfg["crawl"]["adapter"] in ("berlin", "brandenburg", "bayern") and cfg["seeds"]
        assert all(isinstance(x["id"], str) for x in cfg["seeds"])


def test_web_adapter_sections_skips_and_stop():
    from plainstamp_ingest.web import parse_service as p
    d = p((FIX / "federal_page.html").read_text(), "ba-kindergeld", "child-benefit",
          url="https://x/k", skip_headings=("Ist der Inhalt hilfreich?",), stop_at=("Chatbot",))
    assert d.region_id == "de" and d.doc_id == "de-ba-kindergeld" and d.url == "https://x/k"
    assert [(s.heading, s.text) for s in d.sections] == [
        ("Überblick", "Intro text."), ("Voraussetzungen", "- Kind unter 18")]


def test_classify_by_title_pattern():
    from plainstamp_ingest.classify import classify, load_patterns
    pats = load_patterns()
    assert classify("Wohnsitz - Alleinige Wohnung oder Hauptwohnung anmelden", pats) == "anmeldung"
    assert classify("Meldebescheinigung beantragen", pats) == "registration-certificate"
    assert classify("Prostitutionstätigkeit - Anmeldebescheinigung beantragen", pats) == "other"
    assert classify("Blaue Karte EU beantragen", pats) == "blue-card"
    assert classify("Baugenehmigung", pats) == "other"


def test_embed_cache_resumes_and_skips_cached_chunks(tmp_path, monkeypatch):
    import json as j
    from plainstamp_ingest import cli
    monkeypatch.setattr(cli, "DATA", tmp_path)
    (tmp_path / "chunks").mkdir()
    rows = [{"title": f"T{i}", "text": f"Wohnung anmelden {i}", "doc_id": "d", "region_id": "de", "source_id": "s"} for i in range(3)]
    (tmp_path / "chunks" / "s.jsonl").write_text("\n".join(j.dumps(r) for r in rows))
    monkeypatch.setenv("EMBEDDING_PROVIDER", "hash")
    cli.cmd_embed("s")
    first = (tmp_path / "bundles" / "s" / "vectors.bin").read_bytes()
    calls = []
    real = cli.get_embedder
    def counting():
        e = real()
        orig = e.embed_documents
        e.embed_documents = lambda items: (calls.append(len(items)), orig(items))[1]
        return e
    monkeypatch.setattr(cli, "get_embedder", counting)
    cli.cmd_embed("s")
    assert calls == [] and (tmp_path / "bundles" / "s" / "vectors.bin").read_bytes() == first


def test_embed_stops_cleanly_on_daily_quota_and_resumes(tmp_path, monkeypatch):
    import json as j
    import pytest
    from plainstamp_ingest import cli
    from plainstamp_ingest.embed import DailyQuotaExhausted, HashEmbedder
    monkeypatch.setattr(cli, "DATA", tmp_path)
    (tmp_path / "chunks").mkdir()
    rows = [{"title": f"T{i}", "text": f"Wohnung {i}", "doc_id": "d", "region_id": "de", "source_id": "s"} for i in range(250)]
    (tmp_path / "chunks" / "s.jsonl").write_text("\n".join(j.dumps(r) for r in rows))

    class Limited(HashEmbedder):
        calls = 0
        def embed_documents(self, items):
            Limited.calls += 1
            if Limited.calls == 2:  # first 100 succeed, second batch hits the daily cap
                raise DailyQuotaExhausted("daily embedding quota exhausted")
            return super().embed_documents(items)
    monkeypatch.setattr(cli, "get_embedder", lambda: Limited())
    with pytest.raises(SystemExit) as e:
        cli.cmd_embed("s")
    assert e.value.code == cli.QUOTA_EXIT
    assert not (tmp_path / "bundles" / "s" / "vectors.bin").exists()  # no half-written bundle
    cli.cmd_embed("s")  # next day: only the missing 150 are embedded
    assert (tmp_path / "bundles" / "s" / "vectors.bin").stat().st_size == 250 * 384 * 4
    assert Limited.calls == 4  # 2 before the stop (one failed) + 2 on the resume
