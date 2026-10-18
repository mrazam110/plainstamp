"""German-stemmed BM25 keyword index (Snowball, same stemmer family as Postgres `german`)."""
import math
import re
from collections import Counter

import snowballstemmer

_stem = snowballstemmer.stemmer("german")
STOP = set("""der die das den dem des ein eine einen einem einer eines und oder aber auch
in im ins an am auf aus bei mit nach von vom zu zum zur fuer für über ueber unter um als
ist sind war wird werden wurde wurden hat haben sie ihr ihre ihren ihrem es sich nicht
wenn dann dass daß so wie wo was wer kann können muss müssen""".split())
K1, B = 1.5, 0.75


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[^\W_]+", text.lower()) if w not in STOP and len(w) > 1]


def tokenize(text: str) -> list[str]:
    return _stem.stemWords(words(text))


def build_index(texts: list[str]) -> dict:
    postings: dict[str, list[list[int]]] = {}
    lengths = []
    surface: set[str] = set()
    for i, t in enumerate(texts):
        ws = words(t)
        surface.update(ws)
        toks = _stem.stemWords(ws)
        lengths.append(len(toks))
        for term, tf in Counter(toks).items():
            postings.setdefault(term, []).append([i, tf])
    n = len(texts)
    # word -> stem table: other-language stemmers differ slightly from this one, so the
    # Worker looks query words up here first and only falls back to its own stemmer.
    vocab = sorted(surface)
    stems = dict(zip(vocab, _stem.stemWords(vocab)))
    return {"n": n, "avgdl": (sum(lengths) / n) if n else 0.0, "lengths": lengths,
            "postings": postings, "stems": stems}


def search(index: dict, query: str, k: int = 5) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    n, avgdl = index["n"], index["avgdl"] or 1.0
    for term in set(tokenize(query)):
        plist = index["postings"].get(term, [])
        if not plist:
            continue
        idf = math.log(1 + (n - len(plist) + 0.5) / (len(plist) + 0.5))
        for doc, tf in plist:
            dl = index["lengths"][doc]
            scores[doc] = scores.get(doc, 0.0) + idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * dl / avgdl))
    return sorted(scores.items(), key=lambda x: -x[1])[:k]
