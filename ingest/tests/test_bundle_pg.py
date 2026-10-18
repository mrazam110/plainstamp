import json
import struct
from pathlib import Path

from plainstamp_ingest.bundle import export_bundle
from plainstamp_ingest.pgload import load_bundle, region_rows, schema_sql, vector_literal

ROW = {"id": "c1", "doc_id": "d1", "source_id": "s", "region_id": "de-be", "topic_key": "anmeldung",
       "leika_key": None, "url": "https://x/1", "title": "T", "heading": "H", "crawled_at": "2026-10-18",
       "text": "T\nH\nText"}


def make_data(tmp_path: Path, dim=4) -> Path:
    (tmp_path / "chunks").mkdir()
    (tmp_path / "bundles" / "s").mkdir(parents=True)
    (tmp_path / "chunks" / "s.jsonl").write_text(json.dumps(ROW) + "\n")
    (tmp_path / "bundles" / "s" / "vectors.bin").write_bytes(struct.pack(f"<{dim}f", 1, 0, 0, 0))
    (tmp_path / "bundles" / "s" / "keyword.json").write_text("{}")
    (tmp_path / "bundles" / "s" / "manifest.json").write_text(
        json.dumps({"embedding_model": "m", "dimension": dim, "chunk_count": 1}))
    return tmp_path


def test_export_bundle_is_stable_and_complete(tmp_path):
    data = make_data(tmp_path)
    a = export_bundle(data, "s")
    b = export_bundle(data, "s")
    assert a == b and a.name.startswith("bundle-de-be-")
    assert {p.name for p in a.iterdir()} == {"manifest.json", "vectors.bin", "chunks.jsonl", "keyword.json"}
    assert "source_id" not in json.loads((a / "chunks.jsonl").read_text())
    assert json.loads((data / "bundles" / "active-de-be.json").read_text())["dir"] == a.name


class FakeCursor:
    def __init__(self, db):
        self.db, self._one = db, None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.db.log.append((sql.split()[0], params))
        if sql.startswith("SELECT atttypmod"):
            self._one = self.db.typmod
        if sql.startswith("SELECT content_hash"):
            h = self.db.hashes.get(params[0])
            self._one = (h,) if h else None
        if sql.startswith("INSERT INTO documents"):
            self.db.hashes[params[0]] = params[-1]

    def fetchone(self):
        return self._one


class FakeConn:
    def __init__(self):
        self.log, self.hashes, self.commits, self.typmod = [], {}, 0, None

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1


def test_loader_is_idempotent(tmp_path):
    bundle = export_bundle(make_data(tmp_path), "s")
    regions = Path(__file__).resolve().parents[2] / "regions" / "de.yaml"
    conn = FakeConn()
    assert load_bundle(conn, bundle, regions) == {"loaded": 1, "skipped": 0, "chunks": 1}
    inserts = [p for k, p in conn.log if k == "INSERT"]
    assert len(inserts) >= 17 + 2  # 17 regions + document + chunk
    assert load_bundle(conn, bundle, regions) == {"loaded": 0, "skipped": 1, "chunks": 0}


def test_helpers():
    assert "halfvec(384)" in schema_sql(384)
    assert len(list(region_rows({"id": "de", "name": "G", "level": "country",
                                 "children": [{"id": "de-be", "name": "B", "level": "land"}]}))) == 2
    assert vector_literal([1, 0.5]) == "[1.000000,0.500000]"


def test_loader_refuses_a_different_vector_size_and_reloads_when_the_model_changes(tmp_path):
    import pytest

    bundle = export_bundle(make_data(tmp_path), "s")
    regions = Path(__file__).resolve().parents[2] / "regions" / "de.yaml"
    conn = FakeConn()
    conn.typmod = (384,)  # existing table was created for 384 dimensions, bundle has 4
    with pytest.raises(RuntimeError, match="drop the chunks"):
        load_bundle(conn, bundle, regions)
    conn.typmod = (4,)
    assert load_bundle(conn, bundle, regions)["loaded"] == 1
    manifest = json.loads((bundle / "manifest.json").read_text())
    manifest["embedding_model"] = "another-model"
    (bundle / "manifest.json").write_text(json.dumps(manifest))
    assert load_bundle(conn, bundle, regions)["loaded"] == 1  # same text, new model: must not be skipped
