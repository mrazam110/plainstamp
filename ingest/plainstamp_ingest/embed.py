"""Embedder interface for ingestion. Provider chosen by EMBEDDING_PROVIDER (ADR 0006).

Vectors must be L2-normalised and the same model must be used at query time.
"""
import hashlib
import math
import os
import re
from typing import Protocol


class Embedder(Protocol):
    name: str
    dimension: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def normalise(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class HashEmbedder:
    """Deterministic bag-of-words hashing vectors. For tests and plumbing only, not quality."""

    def __init__(self, dimension: int = 384):
        self.name, self.dimension = "hash", dimension

    def embed(self, texts):
        out = []
        for t in texts:
            v = [0.0] * self.dimension
            for w in re.findall(r"[^\W_]+", t.lower()):
                h = int(hashlib.md5(w.encode()).hexdigest(), 16)
                v[h % self.dimension] += 1.0 if (h >> 64) & 1 else -1.0
            out.append(normalise(v))
        return out


class FastEmbedEmbedder:
    """Local ONNX model via fastembed (optional dependency)."""

    def __init__(self, model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"):
        from fastembed import TextEmbedding  # imported lazily so the base install stays small

        self._m = TextEmbedding(model_name=model)
        self.name = f"fastembed:{model}"
        self.dimension = len(next(iter(self._m.embed(["x"]))))

    def embed(self, texts):
        return [normalise([float(x) for x in v]) for v in self._m.embed(texts)]


def get_embedder() -> Embedder:
    provider = os.environ.get("EMBEDDING_PROVIDER", "hash")
    if provider == "hash":
        return HashEmbedder()
    if provider == "fastembed":
        return FastEmbedEmbedder(os.environ.get("EMBEDDING_MODEL", FastEmbedEmbedder.__init__.__defaults__[0]))
    if provider == "gemini":
        raise NotImplementedError("Gemini embeddings: verify model name, output dimension and free-tier limits first (ADR 0006)")
    raise ValueError(f"unknown EMBEDDING_PROVIDER {provider!r}")
