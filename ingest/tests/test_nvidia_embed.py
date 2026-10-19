import math

import pytest

from plainstamp_ingest.embed import EmbeddingProviderError, NvidiaEmbedder, get_embedder


class Resp:
    def __init__(self, status=200, body=None, headers=None, bad_json=False):
        self.status_code, self._body, self.headers, self._bad = status, body, headers or {}, bad_json

    def json(self):
        if self._bad:
            raise ValueError("secret-in-error")
        return self._body


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def post(self, url, json, headers, timeout):
        self.calls.append({"url": url, "json": json, "headers": headers})
        r = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        return r(len(json["input"])) if callable(r) else r


def ok(n, dim=2048):
    return Resp(body={"data": [{"index": i, "embedding": [3.0, 4.0] + [0.0] * (dim - 2)} for i in range(n)][::-1]})


def make(session, **kw):
    return NvidiaEmbedder("key", session=session, base_delay=0, **kw)


def test_request_shape_auth_normalisation_and_name():
    s = FakeSession(ok(1))
    v = make(s).embed_queries(["Wohnung anmelden"])[0]
    assert math.isclose(sum(x * x for x in v), 1.0) and len(v) == 2048
    call = s.calls[0]
    assert call["url"] == "https://integrate.api.nvidia.com/v1/embeddings"
    assert call["headers"] == {"authorization": "Bearer key"}
    assert call["json"] == {"model": "nvidia/nemotron-3-embed-1b", "input": ["Wohnung anmelden"], "input_type": "query",
                            "encoding_format": "float", "truncate": "END"}
    assert make(s).name == "nvidia:nvidia/nemotron-3-embed-1b:2048"
    d = FakeSession(ok(1))
    make(d).embed_documents([("Titel", "Text")])
    assert d.calls[0]["json"]["input"] == ["Titel\nText"] and d.calls[0]["json"]["input_type"] == "passage"


def test_batches_of_50_order_restored_and_dimension_checked():
    s = FakeSession(lambda n: ok(n))
    assert len(make(s).embed_queries([f"q{i}" for i in range(120)])) == 120
    assert [len(c["json"]["input"]) for c in s.calls] == [50, 50, 20]
    with pytest.raises(EmbeddingProviderError, match="expected 2048 dimensions, got 4"):
        make(FakeSession(ok(1, dim=4))).embed_queries(["x"])


def test_retry_then_fixed_errors(monkeypatch):
    monkeypatch.setattr("plainstamp_ingest.embed.time.sleep", lambda s: None)
    assert len(make(FakeSession(Resp(429), Resp(503), ok(1))).embed_queries(["x"])) == 1
    with pytest.raises(EmbeddingProviderError, match="status 401") as e:
        make(FakeSession(Resp(401, body={"echo": "secret-question"}))).embed_queries(["secret-question"])
    assert "secret" not in str(e.value)
    with pytest.raises(EmbeddingProviderError, match="malformed") as e2:
        make(FakeSession(Resp(bad_json=True))).embed_queries(["x"])
    assert "secret" not in str(e2.value)


def test_provider_is_opt_in_and_fixed_size(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "nvidia")
    monkeypatch.setenv("NVIDIA_API_KEY", "k")
    monkeypatch.delenv("ALLOW_TRIAL_PROVIDERS", raising=False)
    with pytest.raises(ValueError, match="ALLOW_TRIAL_PROVIDERS"):
        get_embedder()
    monkeypatch.setenv("ALLOW_TRIAL_PROVIDERS", "1")
    assert get_embedder().name == "nvidia:nvidia/nemotron-3-embed-1b:2048"
    monkeypatch.setenv("EMBEDDING_DIMENSION", "768")
    with pytest.raises(ValueError, match="2048"):
        get_embedder()
    monkeypatch.setenv("EMBEDDING_DIMENSION", "2048")
    monkeypatch.delenv("NVIDIA_API_KEY")
    with pytest.raises(ValueError, match="NVIDIA_API_KEY"):
        get_embedder()
