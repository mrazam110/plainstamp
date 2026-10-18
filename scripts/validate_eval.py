"""Mechanical checks of eval/de/*.yaml: schema, known doc ids, topics, regions, duplicate ids, source urls.
Does NOT verify facts (that is the human check). Exit 1 on any problem."""
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
TYPES = {"answerable", "move", "not_covered", "needs_state", "unanswerable"}
MODES = {"germany", "state", "move"}

docs, urls = {}, set()
for src in ["federal", "berlin-full", "brandenburg", "bayern"]:
    for line in (ROOT / "data/chunks" / f"{src}.jsonl").read_text("utf-8").splitlines():
        r = json.loads(line)
        docs[r["doc_id"]] = r["url"]
topics = {t["key"] for t in yaml.safe_load((ROOT / "topics/de.yaml").read_text("utf-8"))["topics"]}
regions = {"de"}
def walk(n):
    regions.add(n["id"])
    for c in n.get("children", []):
        walk(c)
walk(yaml.safe_load((ROOT / "regions/de.yaml").read_text("utf-8")))
covered = {"de", "de-be", "de-bb", "de-by"}

problems, seen, counts = [], set(), Counter()
for f in sorted((ROOT / "eval/de").glob("*.yaml")):
    items = yaml.safe_load(f.read_text("utf-8")) or []
    for q in items:
        qid = q.get("id", "?")
        def bad(msg): problems.append(f"{f.stem}:{qid}: {msg}")
        if qid in seen: bad("duplicate id")
        seen.add(qid)
        counts[(f.stem, q.get("type"))] += 1
        if q.get("type") not in TYPES: bad(f"type {q.get('type')}")
        if not q.get("question"): bad("no question")
        ctx = q.get("context") or {}
        if ctx.get("mode") not in MODES: bad(f"context.mode {ctx.get('mode')}")
        for k in ("state", "fromState", "toState"):
            if ctx.get(k) and ctx[k] not in regions: bad(f"unknown region {ctx[k]}")
        if ctx.get("mode") == "move" and not (ctx.get("fromState") and ctx.get("toState")): bad("move without from/to")
        if q.get("topic_key") and q["topic_key"] not in topics: bad(f"unknown topic {q['topic_key']}")
        for d in q.get("expected_docs") or []:
            if d not in docs: bad(f"unknown doc id {d}")
        for u in q.get("source_urls") or []:
            if not str(u).startswith("http"): bad(f"bad url {u}")
        t = q.get("type")
        if t in ("answerable", "move") and not q.get("expected_docs"): bad("answerable without expected_docs")
        if t in ("answerable", "move") and not q.get("expected_facts"): bad("answerable without expected_facts")
        if t == "unanswerable" and q.get("expected_docs"): bad("unanswerable with expected_docs")
        if t == "not_covered":
            nc = q.get("not_covered") or []
            if not nc or any(r in covered for r in nc) or any(r not in regions for r in nc): bad(f"not_covered must list uncovered known regions: {nc}")
        if not str(q.get("verified_by", "")).startswith("eval-writer"): bad("verified_by missing")
total = sum(counts.values())
print(f"{total} questions")
for k in sorted(counts, key=str): print(f"  {k[0]:12} {str(k[1]):12} {counts[k]}")
print(f"{len(problems)} problems")
for p in problems[:60]: print(" -", p)
sys.exit(1 if problems else 0)
