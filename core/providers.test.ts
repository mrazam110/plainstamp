import { describe, expect, it } from "vitest";
import { GeminiEmbedder } from "./embeddings/gemini";
import { GeminiLLM } from "./llm/gemini";
import { ProviderError } from "./http";
import { createEmbedder, createLLM } from "./providers";

type Call = { url: string; headers: Record<string, string>; body: any };

function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return responses[Math.min(calls.length - 1, responses.length - 1)]!();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (o: unknown, status = 200) => () => new Response(JSON.stringify(o), { status });

describe("GeminiEmbedder", () => {
  it("v2: puts the task in the text, normalises, sends key as header", async () => {
    const { f, calls } = fakeFetch([json({ embeddings: [{ values: [3, 4] }] })]);
    const e = new GeminiEmbedder({ apiKey: "k", model: "gemini-embedding-2", dimension: 2, fetch: f });
    const [v] = await e.embedQueries(["Wohnung anmelden"]);
    expect(Array.from(v!)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents");
    expect(calls[0]!.url).not.toContain("key=");
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("k");
    const req = calls[0]!.body.requests[0];
    expect(req.content.parts[0].text).toBe("task: search result | query: Wohnung anmelden");
    expect(req.outputDimensionality).toBe(2);
    expect(req.taskType).toBeUndefined();
    expect(e.name).toBe("gemini:gemini-embedding-2:2");
  });

  it("v2 documents use the title|text format; 001 uses taskType and plain text", async () => {
    const a = fakeFetch([json({ embeddings: [{ values: [1, 0] }] })]);
    await new GeminiEmbedder({ apiKey: "k", model: "gemini-embedding-2", dimension: 2, fetch: a.f })
      .embedDocuments([{ title: "T", text: "X" }]);
    expect(a.calls[0]!.body.requests[0].content.parts[0].text).toBe("title: T | text: X");
    const b = fakeFetch([json({ embeddings: [{ values: [1, 0] }] })]);
    await new GeminiEmbedder({ apiKey: "k", model: "gemini-embedding-001", dimension: 2, fetch: b.f })
      .embedDocuments([{ text: "X" }]);
    expect(b.calls[0]!.body.requests[0]).toMatchObject({ taskType: "RETRIEVAL_DOCUMENT", content: { parts: [{ text: "X" }] } });
  });

  it("batches by 100 and rejects a wrong dimension", async () => {
    const mk = (n: number) => json({ embeddings: Array.from({ length: n }, () => ({ values: [1, 0] })) });
    const { f, calls } = fakeFetch([mk(100), mk(50)]);
    const e = new GeminiEmbedder({ apiKey: "k", model: "gemini-embedding-2", dimension: 2, fetch: f });
    expect(await e.embedQueries(Array.from({ length: 150 }, (_, i) => `q${i}`))).toHaveLength(150);
    expect(calls.map((c) => c.body.requests.length)).toEqual([100, 50]);
    const bad = new GeminiEmbedder({ apiKey: "k", model: "gemini-embedding-2", dimension: 3, fetch: fakeFetch([json({ embeddings: [{ values: [1, 0] }] })]).f });
    await expect(bad.embedQueries(["x"])).rejects.toThrow(/dimensions/);
  });
});

describe("GeminiLLM", () => {
  const req = { system: "sys", messages: [{ role: "user" as const, content: "Frage" }], temperature: 0.2, maxOutputTokens: 100 };

  it("builds the request body and reads the text", async () => {
    const { f, calls } = fakeFetch([json({ candidates: [{ content: { parts: [{ text: "Ant" }, { text: "wort" }] }, finishReason: "STOP" }] })]);
    const r = await new GeminiLLM({ apiKey: "k", model: "m", fetch: f }).generate({ ...req, json: { schema: { type: "OBJECT" } } });
    expect(r).toEqual({ text: "Antwort", finishReason: "STOP" });
    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m:generateContent");
    expect(calls[0]!.body).toEqual({
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [{ text: "Frage" }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 100, responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
    });
  });

  it("retries on 429, then succeeds", async () => {
    const { f, calls } = fakeFetch([json({}, 429), json({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })]);
    const r = await new GeminiLLM({ apiKey: "k", model: "m", fetch: f, baseDelayMs: 1 }).generate(req);
    expect(r.text).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("error messages never contain the prompt or the provider reply", async () => {
    const { f } = fakeFetch([() => new Response("echo: Frage secret-reply", { status: 400 })]);
    const err = await new GeminiLLM({ apiKey: "k", model: "m", fetch: f }).generate(req).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(400);
    expect(err.message).not.toMatch(/Frage|secret|echo|k$/);
  });

  it("streams text deltas from SSE, including chunks split mid-line", async () => {
    const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"Hal"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n';
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) { c.enqueue(enc.encode(sse.slice(0, 40))); c.enqueue(enc.encode(sse.slice(40))); c.close(); },
    });
    const { f, calls } = fakeFetch([() => new Response(body, { status: 200 })]);
    const out: string[] = [];
    for await (const t of new GeminiLLM({ apiKey: "k", model: "m", fetch: f }).stream(req)) out.push(t);
    expect(out).toEqual(["Hal", "lo"]);
    expect(calls[0]!.url).toContain(":streamGenerateContent?alt=sse");
  });
});

describe("malformed provider replies", () => {
  it("fail with a fixed message that does not quote the reply", async () => {
    const llm = new GeminiLLM({ apiKey: "k", model: "m", fetch: fakeFetch([() => new Response("{Frage secret", { status: 200 })]).f });
    const e1 = await llm.generate({ messages: [{ role: "user", content: "x" }] }).catch((e) => e);
    expect(e1.message).toBe("malformed provider response");
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { c.enqueue(enc.encode("data: {Frage secret\n")); c.close(); } });
    const streaming = new GeminiLLM({ apiKey: "k", model: "m", fetch: fakeFetch([() => new Response(body, { status: 200 })]).f });
    const e2 = await (async () => { try { for await (const _ of streaming.stream({ messages: [{ role: "user", content: "x" }] })) void _; } catch (e) { return e as Error; } })();
    expect(e2?.message).toBe("malformed provider response");
    const emb = new GeminiEmbedder({ apiKey: "k", model: "gemini-embedding-2", dimension: 2, fetch: fakeFetch([() => new Response("{Frage secret", { status: 200 })]).f });
    expect((await emb.embedQueries(["x"]).catch((e) => e)).message).toBe("malformed provider response");
  });
});

describe("provider factory", () => {
  it("needs a key and rejects unknown providers", () => {
    expect(() => createLLM({})).toThrow(/GEMINI_API_KEY/);
    expect(() => createEmbedder({ GEMINI_API_KEY: "k", EMBEDDING_PROVIDER: "x" })).toThrow(/unknown/);
    expect(createEmbedder({ GEMINI_API_KEY: "k" }).name).toBe("gemini:gemini-embedding-2:768");
    expect(createLLM({ GEMINI_API_KEY: "k" })).toBeDefined();
  });
});
