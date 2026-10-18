"""Embedder interface for ingestion. Provider chosen by EMBEDDING_PROVIDER (ADR 0006).

Vectors are L2-normalised. The query side (core/embeddings in TypeScript) must use the same model and
dimension; the bundle manifest records `embedding_model` so a mismatch can be caught.
Queries and documents are embedded differently for some models, hence two methods.
"""
import hashlib
import math
import os
import re
import time
from typing import Protocol

import requests

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_BATCH = 100


class Embedder(Protocol):
    name: str
    dimension: int

    def embed_documents(self, items: list[tuple[str, str]]) -> list[list[float]]:
        """items are (title, text) pairs."""

    def embed_queries(self, texts: list[str]) -> list[list[float]]: ...


def normalise(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class HashEmbedder:
    """Deterministic bag-of-words hashing vectors. For tests and plumbing only, not quality."""

    def __init__(self, dimension: int = 384):
        self.name, self.dimension = "hash", dimension

    def _one(self, text: str) -> list[float]:
        v = [0.0] * self.dimension
        for w in re.findall(r"[^\W_]+", text.lower()):
            h = int(hashlib.md5(w.encode()).hexdigest(), 16)
            v[h % self.dimension] += 1.0 if (h >> 64) & 1 else -1.0
        return normalise(v)

    def embed_documents(self, items):
        return [self._one(t) for _, t in items]

    def embed_queries(self, texts):
        return [self._one(t) for t in texts]


class FastEmbedEmbedder:
    """Local ONNX model via fastembed (optional dependency)."""

    DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    def __init__(self, model: str = DEFAULT_MODEL):
        from fastembed import TextEmbedding  # imported lazily so the base install stays small

        self._m = TextEmbedding(model_name=model)
        self.name = f"fastembed:{model}"
        self.dimension = len(next(iter(self._m.embed(["x"]))))

    def _run(self, texts):
        return [normalise([float(x) for x in v]) for v in self._m.embed(texts)]

    def embed_documents(self, items):
        return self._run([t for _, t in items])

    def embed_queries(self, texts):
        return self._run(texts)


def _quota_info(res) -> tuple[str, float | None]:
    """(quota id, suggested wait in seconds) from a 429 body. Reads only quota metadata, never echoes anything."""
    quota_id, delay = "", None
    try:
        for d in res.json().get("error", {}).get("details", []):
            kind = str(d.get("@type", ""))
            if kind.endswith("QuotaFailure") and d.get("violations"):
                quota_id = str(d["violations"][0].get("quotaId", ""))
            if kind.endswith("RetryInfo"):
                delay = float(str(d.get("retryDelay", "")).rstrip("s")) + 1.0
    except (ValueError, AttributeError, TypeError):
        pass
    return quota_id, delay


class GeminiError(RuntimeError):
    """Carries the HTTP status only: never the request text or the provider's reply."""


class GeminiEmbedder:
    """Gemini embeddings over REST. Mirrors core/embeddings/gemini.ts (same prompt formats, batching).

    gemini-embedding-2 has no task type: the task goes into the text. gemini-embedding-001 uses taskType.
    """

    def __init__(self, api_key: str, model: str = "gemini-embedding-2", dimension: int = 768,
                 session=None, retries: int = 8, base_delay: float = 1.0, batch_delay: float = 0.0):
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not set")
        if not 128 <= dimension <= 3072:
            raise ValueError("dimension must be between 128 and 3072")
        self.model, self.dimension = model, dimension
        self.name = f"gemini:{model}:{dimension}"
        self._v2 = model == "gemini-embedding-2"
        self._session = session or requests.Session()
        self._key, self._retries, self._base, self._batch_delay = api_key, retries, base_delay, batch_delay

    def embed_documents(self, items):
        texts = [f"title: {title or 'none'} | text: {text}" if self._v2 else text for title, text in items]
        return self._run(texts, "RETRIEVAL_DOCUMENT")

    def embed_queries(self, texts):
        return self._run([f"task: search result | query: {t}" if self._v2 else t for t in texts], "RETRIEVAL_QUERY")

    def _post(self, body: dict) -> dict:
        url = f"{GEMINI_BASE}/models/{self.model}:batchEmbedContents"
        for attempt in range(self._retries + 1):
            res = self._session.post(url, json=body, headers={"x-goog-api-key": self._key}, timeout=60)
            if res.status_code == 200:
                try:
                    return res.json()
                except ValueError:
                    raise GeminiError("malformed provider response") from None
            retryable = res.status_code == 429 or res.status_code >= 500
            wait = self._base * 2 ** attempt
            if res.status_code == 429:
                quota_id, hint = _quota_info(res)
                if "PerDay" in quota_id:  # waiting will not help until tomorrow
                    raise GeminiError("daily embedding quota exhausted")
                wait = hint if hint is not None else wait
            if not retryable or attempt == self._retries:
                raise GeminiError(f"provider request failed with status {res.status_code}")
            retry_after = res.headers.get("retry-after", "")
            if retry_after.replace(".", "", 1).isdigit():
                wait = float(retry_after)
            time.sleep(min(wait, 120.0))
        raise AssertionError("unreachable")

    def _run(self, texts: list[str], task_type: str) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), GEMINI_BATCH):
            if i and self._batch_delay:
                time.sleep(self._batch_delay)
            requests_ = [
                {"model": f"models/{self.model}", "content": {"parts": [{"text": t}]},
                 "outputDimensionality": self.dimension, **({} if self._v2 else {"taskType": task_type})}
                for t in texts[i:i + GEMINI_BATCH]
            ]
            emb = self._post({"requests": requests_}).get("embeddings")
            if not emb or len(emb) != len(requests_):
                raise GeminiError("unexpected embedding response")
            for e in emb:
                if len(e["values"]) != self.dimension:
                    raise GeminiError(f"expected {self.dimension} dimensions, got {len(e['values'])}")
                out.append(normalise(e["values"]))
        return out


def get_embedder() -> Embedder:
    provider = os.environ.get("EMBEDDING_PROVIDER", "hash")
    if provider == "hash":
        return HashEmbedder()
    if provider == "fastembed":
        return FastEmbedEmbedder(os.environ.get("EMBEDDING_MODEL", FastEmbedEmbedder.DEFAULT_MODEL))
    if provider == "gemini":
        return GeminiEmbedder(
            os.environ.get("GEMINI_API_KEY", ""),
            os.environ.get("EMBEDDING_MODEL", "gemini-embedding-2"),
            int(os.environ.get("EMBEDDING_DIMENSION", "768")),
            batch_delay=float(os.environ.get("EMBEDDING_BATCH_DELAY", "0")),
        )
    raise ValueError(f"unknown EMBEDDING_PROVIDER {provider!r}")
