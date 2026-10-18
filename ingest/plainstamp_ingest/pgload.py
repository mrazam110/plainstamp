"""Idempotent loader: public documents and chunks into Postgres (pgvector + German full-text).

A document is reloaded only when its content hash changed. Documents that disappeared from the
source are not deleted here (do that with an explicit prune step once crawling is incremental).
"""
import hashlib
import json
import struct
from collections import defaultdict
from pathlib import Path

import yaml

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def schema_sql(dim: int) -> str:
    return (SQL_DIR / "schema.sql").read_text().replace("{dim}", str(int(dim)))


def region_rows(tree: dict, parent=None):
    yield (tree["id"], parent, tree["name"], tree["level"], tree.get("coverage", "none"))
    for child in tree.get("children", []):
        yield from region_rows(child, tree["id"])


def doc_hash(texts: list[str], *meta: str) -> str:
    """Hash of text and metadata, so a changed topic or title also reloads the document."""
    return hashlib.sha256("\n".join([*meta, *texts]).encode()).hexdigest()[:16]


def vector_literal(v) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def check_dimension(cur, dim: int) -> None:
    """Refuse to mix vector sizes: CREATE TABLE IF NOT EXISTS would keep the old column size."""
    cur.execute("SELECT atttypmod FROM pg_attribute WHERE attrelid = to_regclass('chunks') AND attname = 'embedding'")
    row = cur.fetchone()
    if row and row[0] not in (None, -1, dim):
        raise RuntimeError(
            f"chunks.embedding is halfvec({row[0]}) but the bundle has {dim} dimensions. "
            "Re-embedding changed the model or size: drop the chunks and documents tables, then load again.")


def load_bundle(conn, bundle: Path, regions_yaml: Path) -> dict:
    manifest = json.loads((bundle / "manifest.json").read_text())
    dim = manifest["dimension"]
    rows = [json.loads(line) for line in (bundle / "chunks.jsonl").read_text("utf-8").splitlines()]
    raw = (bundle / "vectors.bin").read_bytes()
    vecs = [struct.unpack_from(f"<{dim}f", raw, i * dim * 4) for i in range(len(rows))]
    by_doc = defaultdict(list)
    for r, v in zip(rows, vecs):
        by_doc[r["doc_id"]].append((r, v))
    stats = {"loaded": 0, "skipped": 0, "chunks": 0}
    with conn.cursor() as cur:
        check_dimension(cur, dim)
        cur.execute(schema_sql(dim))
        for rid in region_rows(yaml.safe_load(regions_yaml.read_text(encoding="utf-8"))):
            cur.execute("INSERT INTO regions (id, parent_id, name, level, coverage) VALUES (%s,%s,%s,%s,%s) "
                        "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, level=EXCLUDED.level, "
                        "coverage=EXCLUDED.coverage", rid)
        for doc_id, items in by_doc.items():
            first = items[0][0]
            h = doc_hash([r["text"] for r, _ in items], first["title"], first["topic_key"], str(first["leika_key"]), first["url"], manifest["embedding_model"])
            cur.execute("SELECT content_hash FROM documents WHERE id = %s", (doc_id,))
            existing = cur.fetchone()
            if existing and existing[0] == h:
                stats["skipped"] += 1
                continue
            cur.execute(
                "INSERT INTO documents (id, source_url, title, region_id, topic_key, leika_key, language, "
                "crawled_at, content_hash) VALUES (%s,%s,%s,%s,%s,%s,'de',%s,%s) ON CONFLICT (id) DO UPDATE "
                "SET source_url=EXCLUDED.source_url, title=EXCLUDED.title, region_id=EXCLUDED.region_id, "
                "topic_key=EXCLUDED.topic_key, leika_key=EXCLUDED.leika_key, "
                "crawled_at=EXCLUDED.crawled_at, content_hash=EXCLUDED.content_hash",
                (doc_id, first["url"], first["title"], first["region_id"], first["topic_key"],
                 first["leika_key"], first["crawled_at"], h))
            cur.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
            for r, v in items:
                cur.execute(
                    "INSERT INTO chunks (id, document_id, heading_path, text, embedding, tsv) "
                    "VALUES (%s,%s,%s,%s,%s::halfvec,to_tsvector('german', %s))",
                    (r["id"], doc_id, r["heading"], r["text"], vector_literal(v), r["text"]))
                stats["chunks"] += 1
            stats["loaded"] += 1
    conn.commit()
    return stats
