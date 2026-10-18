"""Usage: python -m plainstamp_ingest {fetch|build|embed|bundle|load-pg|report} <source> | pilot berlin|brandenburg|bayern|federal [--refresh]

Output goes to data/ (git-ignored): raw HTML, Markdown snapshots, chunks.jsonl.
"""
import argparse
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path

import os
import struct

from . import bayern, berlin, brandenburg, web
from .bundle import export_bundle
from .chunk import chunk_document
from .classify import classify, load_patterns
from .embed import get_embedder
from .keyword import build_index
from .fetch import Fetcher
from .sources import ROOT, load_source

DATA = ROOT / "data"
ADAPTERS = {"berlin": berlin, "brandenburg": brandenburg, "bayern": bayern, "web": web}


def _paths(source: str):
    return DATA / "raw" / source, DATA / "snapshots" / source, DATA / "chunks" / f"{source}.jsonl"


def cmd_fetch(source: str, refresh: bool) -> None:
    cfg = load_source(source)
    raw, _, _ = _paths(source)
    fetcher = Fetcher(raw, delay=float(cfg["crawl"].get("delay_seconds", 2)))
    adapter = ADAPTERS[cfg["crawl"]["adapter"]]
    failed: list[str] = []
    for seed in cfg["seeds"]:
        try:
            fetcher.get(seed.get("url") or adapter.service_url(seed["id"]), f"{seed['id']}.html", refresh)
            print(f"fetched {seed['id']}", flush=True)
        except Exception as e:  # keep crawling; failures are listed at the end
            failed.append(seed["id"])
            print(f"FAILED {seed['id']}: {type(e).__name__}", flush=True)
    if failed:
        print(f"{len(failed)} failed: {failed[:20]}")


def snapshot_md(doc) -> str:
    head = f"# {doc.title}\n\nSource: {doc.url}\nChecked: {doc.crawled_at}\n"
    return head + "".join(f"\n## {s.heading}\n\n{s.text}\n" for s in doc.sections)


def cmd_build(source: str) -> None:
    cfg = load_source(source)
    raw, snaps, out = _paths(source)
    snaps.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    patterns = load_patterns()
    with out.open("w", encoding="utf-8") as f:
        for seed in cfg["seeds"]:
            html = (raw / f"{seed['id']}.html").read_text(encoding="utf-8")
            extra = {k: seed[k] for k in ("url", "stop_at", "skip_headings") if k in seed}
            doc = ADAPTERS[cfg["crawl"]["adapter"]].parse_service(
                html, seed["id"], seed["topic_key"], cfg["id"], **extra)
            if doc.topic_key == "other":  # unmapped seed: classify by title (topics/de.yaml)
                doc.topic_key = classify(doc.title, patterns)
            (snaps / f"{seed['id']}.md").write_text(snapshot_md(doc), encoding="utf-8")
            for c in chunk_document(doc):
                f.write(json.dumps(asdict(c), ensure_ascii=False) + "\n")
                n += 1
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    kw = DATA / "bundles" / source / "keyword.json"
    kw.parent.mkdir(parents=True, exist_ok=True)
    kw.write_text(json.dumps(build_index([r["text"] for r in rows]), ensure_ascii=False), encoding="utf-8")
    print(f"built {n} chunks and keyword index")


def cmd_embed(source: str) -> None:
    """Write vectors.bin (raw float32, L2-normalised, N x D) and manifest.json."""
    _, _, out = _paths(source)
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    emb = get_embedder()
    vecs = []
    for i in range(0, len(rows), 64):
        vecs += emb.embed([r["text"] for r in rows[i:i + 64]])
    d = DATA / "bundles" / source
    d.mkdir(parents=True, exist_ok=True)
    (d / "vectors.bin").write_bytes(b"".join(struct.pack(f"<{emb.dimension}f", *v) for v in vecs))
    (d / "manifest.json").write_text(json.dumps(
        {"embedding_model": emb.name, "dimension": emb.dimension, "chunk_count": len(rows),
         "built_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}))
    print(f"embedded {len(rows)} chunks with {emb.name} ({emb.dimension}-d)")


def cmd_bundle(source: str) -> None:
    print(f"bundle: {export_bundle(DATA, source)}")


def cmd_load_pg(source: str) -> None:
    import psycopg  # optional dependency, only needed for this command

    from .pgload import load_bundle

    active = json.loads((DATA / "bundles" / f"active-{_region_of(source)}.json").read_text())
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        print(load_bundle(conn, DATA / "bundles" / active["dir"], ROOT / "regions" / "de.yaml"))


def _region_of(source: str) -> str:
    return load_source(source)["region_id"]


def cmd_report(source: str) -> None:
    """Counts only, never raw text."""
    _, _, out = _paths(source)
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    sizes = [len(r["text"]) for r in rows]
    print(f"chunks: {len(rows)}  documents: {len({r['doc_id'] for r in rows})}")
    print(f"chars per chunk: min {min(sizes)}  max {max(sizes)}  avg {sum(sizes) // len(sizes)}")
    for name in ("region_id", "topic_key"):
        print(f"by {name}:", dict(Counter(r[name] for r in rows)))
    print("with leika_key:", sum(1 for r in rows if r["leika_key"]))


def pilot_sources() -> list[str]:
    """Every source file in sources/de/ that is cleared for local work (others are skipped)."""
    ok = []
    for path in sorted((ROOT / "sources" / "de").glob("*.yaml")):
        try:
            if load_source(path.stem)["crawl"].get("pilot", True):
                ok.append(path.stem)
        except PermissionError as e:
            print(f"skip {e}")
    return ok


def cmd_pilot(refresh: bool) -> None:
    """fetch (cached unless --refresh), build, embed, bundle for every cleared source, then report."""
    sources = pilot_sources()
    for src in sources:
        print(f"== {src}")
        cmd_fetch(src, refresh)
        cmd_build(src)
        cmd_embed(src)
        cmd_bundle(src)
    rows = []
    for src in sources:
        rows += [json.loads(l) for l in _paths(src)[2].read_text(encoding="utf-8").splitlines()]
    regions = sorted({r["region_id"] for r in rows})
    print(f"\nPILOT: {len(rows)} chunks, {len({r['doc_id'] for r in rows})} documents, "
          f"embedder {os.environ.get('EMBEDDING_PROVIDER', 'hash')}")
    print("chunks by topic x region (0 = gap):")
    print(f"{'topic':28}" + "".join(f"{r:>7}" for r in regions))
    count = Counter((r["topic_key"], r["region_id"]) for r in rows)
    for topic in sorted({r["topic_key"] for r in rows}):
        print(f"{topic:28}" + "".join(f"{count[(topic, r)]:>7}" for r in regions))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="plainstamp_ingest")
    ap.add_argument("command", choices=["fetch", "build", "embed", "bundle", "load-pg", "report", "pilot"])
    ap.add_argument("source", nargs="?", default="")
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args(argv)
    {"fetch": lambda: cmd_fetch(a.source, a.refresh), "build": lambda: cmd_build(a.source), "embed": lambda: cmd_embed(a.source), "bundle": lambda: cmd_bundle(a.source),
     "load-pg": lambda: cmd_load_pg(a.source), "pilot": lambda: cmd_pilot(a.refresh),
     "report": lambda: cmd_report(a.source)}[a.command]()


if __name__ == "__main__":
    main()
