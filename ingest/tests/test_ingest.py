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
    a, b = e.embed(["Wohnung anmelden"]), e.embed(["Wohnung anmelden"])
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
