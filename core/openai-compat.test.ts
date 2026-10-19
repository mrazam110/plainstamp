import { describe, expect, it } from "vitest";
import { OpenAICompatEmbedder } from "./embeddings/openai-compat";
import { ProviderError } from "./http";
import { OpenAICompatLLM, extractJson } from "./llm/openai-compat";
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
const llm = (f: typeof fetch, extra = {}) => new OpenAICompatLLM({ apiKey: "k", model: "m", baseUrl: "https://nim.test/v1/", fetch: f, baseDelayMs: 1, ...extra });
const req = { system: "sys", messages: [{ role: "user" as const, content: "Frage" }, { role: "model" as const, content: "Antwort" }, { role: "user" as const, content: "Und?" }], temperature: 0.2, maxOutputTokens: 100 };

describe("OpenAICompatLLM", () => {
  it("builds an OpenAI chat request: bearer auth, roles mapped, reasoning padding on max_tokens", async () => {
    const { f, calls } = fakeFetch([json({ choices: [{ message: { content: "Hallo" }, finish_reason: "stop" }] })]);
    const r = await llm(f, { reasoningPadding: 2000 }).generate(req);
    expect(r).toEqual({ text: "Hallo", finishReason: "stop" });
    expect(calls[0]!.url).toBe("https://nim.test/v1/chat/completions");
    expect(calls[0]!.headers.authorization).toBe("Bearer k");
    expect(calls[0]!.headers["x-goog-api-key"]).toBeUndefined();
    expect(calls[0]!.body).toMatchObject({ model: "m", temperature: 0.2, max_tokens: 2100, stream: false });
    expect(calls[0]!.body.messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("treats null content (reasoning budget spent) as empty text", async () => {
    const { f } = fakeFetch([json({ choices: [{ message: { content: null }, finish_reason: "length" }] })]);
    expect(await llm(f).generate(req)).toEqual({ text: "", finishReason: "length" });
  });

  it("asks for JSON in the prompt, not via response_format, and extracts the object from the reply", async () => {
    const { f, calls } = fakeFetch([json({ choices: [{ message: { content: 'Sure!\n```json\n{"language":"en","queries":["a"]}\n```' } }] })]);
    const r = await llm(f).generate({ ...req, json: { schema: { type: "OBJECT" } } });
    expect(JSON.parse(r.text)).toEqual({ language: "en", queries: ["a"] });
    expect(calls[0]!.body.response_format).toBeUndefined();
    expect(calls[0]!.body.messages[0].content).toContain("ONLY one JSON object");
    expect(extractJson("no json here")).toBe("no json here");
  });

  it("streams content deltas and ignores reasoning deltas, across split chunks", async () => {
    const sse = 'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\ndata: {"choices":[{"delta":{"content":"Hal"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { c.enqueue(enc.encode(sse.slice(0, 50))); c.enqueue(enc.encode(sse.slice(50))); c.close(); } });
    const { f, calls } = fakeFetch([() => new Response(body, { status: 200 })]);
    const out: string[] = [];
    for await (const t of llm(f).stream(req)) out.push(t);
    expect(out).toEqual(["Hal", "lo"]);
    expect(calls[0]!.body.stream).toBe(true);
  });

  it("errors carry the status only, never the prompt or reply", async () => {
    const { f } = fakeFetch([() => new Response("echo Frage secret", { status: 401 })]);
    const err = await llm(f).generate(req).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.message).not.toMatch(/Frage|secret|echo|Bearer/);
  });
});

describe("OpenAICompatEmbedder", () => {
  const emb = (f: typeof fetch, dim = 4) => new OpenAICompatEmbedder({ apiKey: "k", model: "e", baseUrl: "https://nim.test/v1", dimension: dim, label: "nvidia", fetch: f, baseDelayMs: 1 });
  const vec = (n: number, dim = 4) => Array.from({ length: n }, (_, i) => ({ index: i, embedding: [3, 4, ...Array(dim - 2).fill(0)] }));

  it("sends input_type query or passage, normalises, and names the model and size", async () => {
    const a = fakeFetch([json({ data: vec(1) })]);
    const [v] = await emb(a.f).embedQueries(["Wohnung anmelden"]);
    expect(Array.from(v!).map((x) => +x.toFixed(2))).toEqual([0.6, 0.8, 0, 0]);
    expect(a.calls[0]!.body).toMatchObject({ model: "e", input_type: "query", encoding_format: "float", truncate: "END" });
    expect(a.calls[0]!.headers.authorization).toBe("Bearer k");
    const b = fakeFetch([json({ data: vec(1) })]);
    await emb(b.f).embedDocuments([{ title: "T", text: "X" }]);
    expect(b.calls[0]!.body).toMatchObject({ input_type: "passage", input: ["T\nX"] });
    expect(emb(a.f).name).toBe("nvidia:e:4");
  });

  it("batches by 50, restores order by index, and rejects a wrong size", async () => {
    const mk = (n: number) => json({ data: vec(n).reverse() });
    const { f, calls } = fakeFetch([mk(50), mk(10)]);
    expect(await emb(f).embedQueries(Array.from({ length: 60 }, (_, i) => `q${i}`))).toHaveLength(60);
    expect(calls.map((c) => c.body.input.length)).toEqual([50, 10]);
    await expect(emb(fakeFetch([json({ data: vec(1, 3) })]).f).embedQueries(["x"])).rejects.toThrow(/dimensions/);
  });
});

describe("nvidia provider guard", () => {
  const base = { LLM_PROVIDER: "nvidia", EMBEDDING_PROVIDER: "nvidia", NVIDIA_API_KEY: "k" };
  it("refuses to run unless trial providers are explicitly allowed", () => {
    expect(() => createLLM(base)).toThrow(/ALLOW_TRIAL_PROVIDERS/);
    expect(() => createEmbedder(base)).toThrow(/ALLOW_TRIAL_PROVIDERS/);
  });
  it("needs a key, defaults to the verified models, and fixes the embedding size", () => {
    expect(() => createLLM({ ...base, ALLOW_TRIAL_PROVIDERS: "1", NVIDIA_API_KEY: "" })).toThrow(/NVIDIA_API_KEY/);
    expect(createEmbedder({ ...base, ALLOW_TRIAL_PROVIDERS: "1" }).name).toBe("nvidia:nvidia/nemotron-3-embed-1b:2048");
    expect(() => createEmbedder({ ...base, ALLOW_TRIAL_PROVIDERS: "1", EMBEDDING_DIMENSION: "768" })).toThrow(/2048/);
    expect(createLLM({ ...base, ALLOW_TRIAL_PROVIDERS: "1" })).toBeDefined();
  });
  it("gemini stays the default", () => {
    expect(createEmbedder({ GEMINI_API_KEY: "k" }).name).toBe("gemini:gemini-embedding-2:768");
  });
});
