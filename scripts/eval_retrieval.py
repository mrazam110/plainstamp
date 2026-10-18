"""Retrieval-level baseline over eval/de/*.yaml, no LLM and no API key needed.

For every question with expected_docs: retrieve per selected region (federal + chosen states, k per region,
hybrid vector + BM25 with weighted RRF, question as the only query, i.e. NO German rewrite) and check that
an expected doc is among the hits. Also checks that no chunk comes from an unselected region.
Usage: python scripts/eval_retrieval.py [--k 6] [--json out.json]
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingest"))
from plainstamp_ingest.embed import get_embedder  # noqa: E402
from plainstamp_ingest.keyword import search as bm25  # noqa: E402

SOURCES = ["federal", "berlin-full", "brandenburg", "bayern"]
KW_WEIGHT = 0.5  # keep equal to KEYWORD_WEIGHT in core/retriever/fuse.ts


def load_region_data():
    data = {}
    for src in SOURCES:
        rows = [json.loads(l) for l in (ROOT / "data/chunks" / f"{src}.jsonl").read_text("utf-8").splitlines()]
        man = json.loads((ROOT / "data/bundles" / src / "manifest.json").read_text())
        vecs = np.frombuffer((ROOT / "data/bundles" / src / "vectors.bin").read_bytes(), dtype="<f4").reshape(-1, man["dimension"])
        idx = json.loads((ROOT / "data/bundles" / src / "keyword.json").read_text())
        data[rows[0]["region_id"]] = (rows, vecs, idx)
    return data


def regions_for(ctx: dict) -> list[str]:
    mode = ctx.get("mode", "germany")
    states = [] if mode == "germany" else [ctx.get("state")] if mode == "state" else [ctx.get("fromState"), ctx.get("toState")]
    return ["de"] + [s for s in states if s]


def retrieve(region_data, emb, question, regions, k):
    qv = np.array(emb.embed_queries([question])[0], dtype="f4")
    out = []
    for r in regions:
        if r not in region_data:  # not covered: never searched
            continue
        rows, vecs, idx = region_data[r]
        vec_rank = list(np.argsort(-(vecs @ qv))[:50])
        kw_rank = [i for i, _ in bm25(idx, question, 50)]
        score = defaultdict(float)
        for rank, i in enumerate(vec_rank):
            score[int(i)] += 1 / (60 + rank + 1)
        for rank, i in enumerate(kw_rank):
            score[int(i)] += KW_WEIGHT / (60 + rank + 1)
        top = sorted(score, key=score.get, reverse=True)[:k]
        out += [rows[i] for i in top]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--json")
    a = ap.parse_args()
    region_data, emb = load_region_data(), get_embedder()
    questions = []
    for f in sorted((ROOT / "eval/de").glob("*.yaml")):
        for q in yaml.safe_load(f.read_text("utf-8")) or []:
            q["_file"] = f.stem
            questions.append(q)
    stats = defaultdict(lambda: [0, 0])  # key -> [hits, total]
    leaks, misses = [], []
    for q in questions:
        regions = regions_for(q.get("context", {}))
        docs = q.get("expected_docs") or []
        hits = retrieve(region_data, emb, q["question"], regions, a.k)
        leaked = {h["region_id"] for h in hits} - set(regions)
        if leaked:
            leaks.append((q["id"], sorted(leaked)))
        if docs:
            ok = bool({h["doc_id"] for h in hits} & set(docs))
            for key in (f"all", f"type:{q.get('type')}", f"file:{q['_file']}", f"lang:{q.get('language')}"):
                stats[key][0] += ok
                stats[key][1] += 1
            if not ok:
                misses.append(q["id"])
    print(f"questions: {len(questions)}  with expected_docs: {stats['all'][1]}  k per region: {a.k}  (no German rewrite)")
    for key in sorted(stats):
        h, t = stats[key]
        print(f"hit@{a.k} {key:22} {h}/{t} = {h / t:.2f}")
    print(f"wrong-region leaks: {len(leaks)} {leaks[:5]}")
    print(f"missed ids: {misses[:40]}")
    if a.json:
        Path(a.json).write_text(json.dumps({"stats": stats, "leaks": leaks, "misses": misses}, default=list, indent=1))
    sys.exit(1 if leaks else 0)


if __name__ == "__main__":
    main()
