"""Retrieval check on eval/berlin-smoke.yaml: hit@5 / hit@1 (any acceptable page) for vector, keyword
and weighted-RRF fusion. `rewrite` stands in for the LLM rewrite (ADR 0005). Local only."""
import json
import struct
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingest"))
from plainstamp_ingest.embed import get_embedder  # noqa: E402
from plainstamp_ingest.keyword import search  # noqa: E402

src = sys.argv[1] if len(sys.argv) > 1 else "berlin"
rows = [json.loads(l) for l in (ROOT / "data/chunks" / f"{src}.jsonl").read_text().splitlines()]
idx = json.loads((ROOT / "data/bundles" / src / "keyword.json").read_text())
man = json.loads((ROOT / "data/bundles" / src / "manifest.json").read_text())
d = man["dimension"]
raw = (ROOT / "data/bundles" / src / "vectors.bin").read_bytes()
import array  # noqa: E402

flat = array.array("f")
flat.frombytes(raw)
try:
    import numpy as np
    M = np.frombuffer(raw, dtype="<f4").reshape(-1, d)
except ImportError:  # slow pure-python fallback
    M = None
emb = get_embedder()
qs = yaml.safe_load((ROOT / "eval/berlin-smoke.yaml").read_text())["questions"]


def vec_rank(text, k=50):
    qv = emb.embed([text])[0]
    if M is not None:
        sc = M @ np.array(qv, dtype="f4")
        return [int(i) for i in np.argsort(-sc)[:k]]
    sc = sorted(((sum(a * b for a, b in zip(qv, struct.unpack_from(f"<{d}f", raw, i * d * 4))), i)
                 for i in range(len(rows))), reverse=True)
    return [i for _, i in sc[:k]]


def wrrf(lists_w, k=60, top=10):
    s = {}
    for lst, w in lists_w:
        for r, i in enumerate(lst):
            s[i] = s.get(i, 0) + w / (k + r + 1)
    return [i for i, _ in sorted(s.items(), key=lambda x: -x[1])[:top]]


def docs_of(ids, n):
    seen = []
    for i in ids:
        if rows[i]["doc_id"] not in seen:
            seen.append(rows[i]["doc_id"])
        if len(seen) == n:
            break
    return seen


configs = {"vector(orig)": None, "keyword(rewrite)": None}
for w in (0.25, 0.5, 1.0):
    configs[f"rrf kw*{w}"] = w
tot = {name: [0, 0] for name in configs}
print(f"model: {man['embedding_model']}  chunks: {len(rows)}  questions: {len(qs)}  (hit@5 / hit@1 by doc)")
for item in qs:
    q, rw, ok = item["q"], item.get("rewrite", item["q"]), set(item["docs"])
    v_o, v_r = vec_rank(q), vec_rank(rw) if rw != q else None
    kw = [i for i, _ in search(idx, rw, 50)]
    vecs = [(v_o, 1.0)] + ([(v_r, 1.0)] if v_r else [])
    res = {"vector(orig)": v_o, "keyword(rewrite)": kw}
    for w in (0.25, 0.5, 1.0):
        res[f"rrf kw*{w}"] = wrrf(vecs + [(kw, w)])
    flags = []
    for name, ids in res.items():
        top5 = docs_of(ids, 5)
        h5, h1 = bool(ok & set(top5)), bool(top5 and top5[0] in ok)
        tot[name][0] += h5
        tot[name][1] += h1
        flags.append("Y" if h5 else "-")
    print(" ".join(flags), q[:66])
print("columns:", ", ".join(configs))
for name, (h5, h1) in tot.items():
    print(f"{name:18} hit@5 {h5}/{len(qs)}  hit@1 {h1}/{len(qs)}")
