import math

import pytest

from plainstamp_ingest.embed import GeminiEmbedder, GeminiError, get_embedder


class Resp:
    def __init__(self, status=200, body=None, headers=None, bad_json=False):
        self.status_code, self._body, self.headers, self._bad = status, body, headers or {}, bad_json

    def json(self):
        if self._bad:
            raise ValueError("secret-text-in-error")
        return self._body


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def post(self, url, json, headers, timeout):
        self.calls.append({"url": url, "json": json, "headers": headers})
        r = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        return r(len(json["requests"])) if callable(r) else r


def ok(n, dim=128):
    return Resp(body={"embeddings": [{"values": [3.0, 4.0] + [0.0] * (dim - 2)} for _ in range(n)]})


def make(session, model="gemini-embedding-2", dim=128, **kw):
    return GeminiEmbedder("key", model, dim, session=session, base_delay=0, **kw)


def test_v2_prompt_formats_key_header_and_normalised_output():
    s = FakeSession(ok(1))
    vecs = make(s).embed_queries(["Wohnung anmelden"])
    assert math.isclose(sum(x * x for x in vecs[0]), 1.0)
    call = s.calls[0]
    assert call["url"].endswith("/models/gemini-embedding-2:batchEmbedContents") and "key=" not in call["url"]
    assert call["headers"] == {"x-goog-api-key": "key"}
    req = call["json"]["requests"][0]
    assert req["content"]["parts"][0]["text"] == "task: search result | query: Wohnung anmelden"
    assert req["outputDimensionality"] == 128 and "taskType" not in req
    s2 = FakeSession(ok(1))
    make(s2).embed_documents([("Titel", "Text")])
    assert s2.calls[0]["json"]["requests"][0]["content"]["parts"][0]["text"] == "title: Titel | text: Text"


def test_model_001_uses_task_type_and_plain_text():
    s = FakeSession(ok(1))
    make(s, "gemini-embedding-001").embed_documents([("T", "X")])
    req = s.calls[0]["json"]["requests"][0]
    assert req["taskType"] == "RETRIEVAL_DOCUMENT" and req["content"]["parts"][0]["text"] == "X"


def test_batches_of_100_and_dimension_check():
    s = FakeSession(lambda n: ok(n))  # answers with as many embeddings as were requested
    out = make(s).embed_queries([f"q{i}" for i in range(250)])
    assert len(out) == 250 and [len(c["json"]["requests"]) for c in s.calls] == [100, 100, 50]
    with pytest.raises(GeminiError, match="expected 256 dimensions, got 128"):
        make(FakeSession(ok(1, dim=128)), dim=256).embed_queries(["x"])


def test_retries_429_then_succeeds_and_gives_up_after_the_limit():
    s = FakeSession(Resp(429), Resp(503), ok(1))
    assert len(make(s).embed_queries(["x"])) == 1 and len(s.calls) == 3
    always = FakeSession(Resp(500))
    with pytest.raises(GeminiError, match="status 500"):
        make(always, retries=2).embed_queries(["x"])
    assert len(always.calls) == 3


def test_errors_never_contain_request_text_or_reply():
    for resp, text in ((Resp(400, body={"error": "echo secret-question"}), "status 400"), (Resp(bad_json=True), "malformed")):
        with pytest.raises(GeminiError) as e:
            make(FakeSession(resp)).embed_queries(["secret-question"])
        assert text in str(e.value) and "secret" not in str(e.value)


def test_factory_needs_key_and_valid_size(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        get_embedder()
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert get_embedder().name == "gemini:gemini-embedding-2:768"
    monkeypatch.setenv("EMBEDDING_DIMENSION", "64")
    with pytest.raises(ValueError, match="128 and 3072"):
        get_embedder()
