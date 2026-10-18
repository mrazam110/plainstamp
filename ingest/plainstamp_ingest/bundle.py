"""Assemble a versioned bundle: bundle-<region>-<version>/ with manifest, vectors, chunks, keyword index."""
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

CHUNK_FIELDS = ["id", "doc_id", "title", "heading", "region_id", "topic_key", "leika_key",
                "url", "crawled_at", "text"]


def export_bundle(data: Path, source: str) -> Path:
    rows = [json.loads(line) for line in (data / "chunks" / f"{source}.jsonl").read_text("utf-8").splitlines()]
    src_dir = data / "bundles" / source
    emb = json.loads((src_dir / "manifest.json").read_text())
    regions = {r["region_id"] for r in rows}
    if len(regions) != 1:
        raise ValueError(f"{source}: expected one region, found {sorted(regions)}")
    region = regions.pop()
    h = hashlib.sha1()
    for r in rows:
        h.update(r["id"].encode())
    h.update(emb["embedding_model"].encode())
    for name in ("vectors.bin", "keyword.json"):  # version changes whenever any shipped file changes
        h.update((src_dir / name).read_bytes())
    h.update((data / "chunks" / f"{source}.jsonl").read_bytes())  # topic keys etc. live here
    version = h.hexdigest()[:10]
    out = data / "bundles" / f"bundle-{region}-{version}"
    if not out.exists():
        out.mkdir(parents=True)
        shutil.copy(src_dir / "vectors.bin", out / "vectors.bin")
        shutil.copy(src_dir / "keyword.json", out / "keyword.json")
        with (out / "chunks.jsonl").open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps({k: r[k] for k in CHUNK_FIELDS}, ensure_ascii=False) + "\n")
        manifest = {"version": version, "region_id": region, "source_id": rows[0]["source_id"],
                    "embedding_model": emb["embedding_model"], "dimension": emb["dimension"],
                    "chunk_count": len(rows), "built_at": datetime.now(timezone.utc).isoformat()}
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (data / "bundles" / f"active-{region}.json").write_text(json.dumps({"version": version, "dir": out.name}))
    return out
