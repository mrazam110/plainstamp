"""Assign topic_key to documents by title pattern (topics/de.yaml `title_pattern`, first match wins)."""
import re

import yaml

from .sources import ROOT


def load_patterns(root=ROOT) -> list[tuple[str, re.Pattern]]:
    topics = yaml.safe_load((root / "topics" / "de.yaml").read_text(encoding="utf-8"))["topics"]
    return [(t["key"], re.compile(t["title_pattern"], re.I)) for t in topics if t.get("title_pattern")]


def classify(title: str, patterns: list[tuple[str, re.Pattern]], default: str = "other") -> str:
    for key, pat in patterns:
        if pat.search(title):
            return key
    return default
