import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../../core/http";
import { FakeLLM } from "../../core/llm/fake";
import type { GenerateRequest, LLM } from "../../core/llm/types";
import type { Deps } from "../../core/pipeline/ask";
import { loadConfig } from "../../core/pipeline/config-fs";
import { BundleRetriever } from "../../core/retriever/bundle";
import { FakeEmbedder, makeBundle } from "../../core/retriever/testing";
import type { Chunk } from "../../core/retriever/types";
import { handle } from "./handler";

const OPTS = { allowedOrigins: ["https://app.example"] };
let deps: Deps;

const chunk = (id: string, regionId: string, topicKey: string, text: string): Chunk => ({
  id, docId: `doc-${id}`, title: `T ${id}`, heading: "H", regionId, topicKey, leikaKey: null,
  url: `https://example.test/${id}`, crawledAt: "2026-10-18", text,
});

beforeAll(async () => {
  const embedder = new FakeEmbedder();
  const config = await loadConfig(join(import.meta.dirname, "../.."));
  const bundles = await Promise.all([
    makeBundle("de", [chunk("f1", "de", "tax-id", "Steueridentifikationsnummer Brief")], embedder),
    makeBundle("de-be", [chunk("be1", "de-be", "anmeldung", "Wohnung anmelden Bürgeramt Berlin")], embedder),
    makeBundle("de-by", [chunk("by1", "de-by", "anmeldung", "Wohnung anmelden Bayern")], embedder),
  ]);
  deps = { llm: new FakeLLM(), embedder, retriever: new BundleRetriever(bundles), config };
});

const post = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  new Request("https://api.test/ask", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body),
  });
const run = (req: Request, d: Deps = deps) => handle(req, async () => d, OPTS);
const valid = { question: "How do I register my flat?", context: { mode: "state", state: "de-be" } };

function events(text: string) {
  return text.trim().split("\n\n").map((block) => {
    const [e, d] = block.split("\n");
    return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) };
  });
}

describe("POST /ask", () => {
  it("streams meta, deltas and a final done event with cleaned citations", async () => {
    const res = await run(post(valid));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = events(await res.text());
    expect(ev[0]!.event).toBe("meta");
    expect(ev[0]!.data).toMatchObject({ needsState: false, notCovered: [] });
    expect(ev.filter((e) => e.event === "delta").length).toBeGreaterThan(1);
    const done = ev.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.answerable).toBe(true);
    expect(done.data.answer).not.toContain("[99]");
    expect(new Set(done.data.citations.map((c: any) => c.regionId))).toEqual(new Set(["de", "de-be"]));
    expect(JSON.stringify(ev)).not.toContain("Bayern");
  });

  it("answers needsState for Germany-only questions on state-specific topics", async () => {
    const res = await run(post({ question: "Register my flat", context: { mode: "germany" } }));
    expect(events(await res.text())[0]!.data.needsState).toBe(true);
  });

  it.each([
    ["not json", { raw: "{nope" }, 400, "invalid_request"],
    ["bad mode", { body: { question: "x", context: { mode: "everywhere" } } }, 400, "invalid_request"],
    ["unknown state", { body: { question: "x", context: { mode: "state", state: "de-xx" } } }, 400, "invalid_request"],
    ["empty question", { body: { question: " ", context: { mode: "germany" } } }, 400, "invalid_request"],
    ["bad history", { body: { question: "x", context: { mode: "germany" }, history: [{ role: "system", content: "x" }] } }, 400, "invalid_request"],
  ])("rejects %s", async (_n, input: any, status, code) => {
    const res = await run(post(input.body, {}, input.raw));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it("rejects oversized bodies, wrong content type and wrong methods", async () => {
    expect((await run(post(null, {}, JSON.stringify({ question: "x".repeat(20000), context: { mode: "germany" } })))).status).toBe(413);
    const wrongType = new Request("https://api.test/ask", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect((await run(wrongType)).status).toBe(415);
    expect((await run(new Request("https://api.test/ask"))).status).toBe(405);
    expect((await run(new Request("https://api.test/other"))).status).toBe(404);
    expect(await (await run(new Request("https://api.test/health"))).json()).toEqual({ ok: true });
  });

  it("sets CORS only for allowed origins and answers preflight", async () => {
    const ok = await run(post(valid, { origin: "https://app.example" }));
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example");
    const other = await run(post(valid, { origin: "https://evil.example" }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await run(new Request("https://api.test/ask", { method: "OPTIONS", headers: { origin: "https://app.example" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns fixed error codes and never echoes the question when the model fails", async () => {
    const boom: LLM = {
      async generate(req: GenerateRequest) {
        if (req.json) return { text: "{}" };
        throw new Error("secret-question-echo");
      },
      stream() { throw new Error("secret-question-echo"); },
    };
    const res = await handle(post({ ...valid, question: "secret-question-echo" }), async () => ({ ...deps, llm: boom }), OPTS);
    const text = await res.text();
    expect(text).not.toContain("secret-question-echo");
    expect(res.status === 502 || text.includes('"upstream_error"')).toBe(true);
  });

  it("reports at_capacity when the provider reports a spent quota", async () => {
    const spent: LLM = {
      async generate(req: GenerateRequest) { return req.json ? { text: "{}" } : { text: "x" }; },
      async *stream() { throw new ProviderError(429, "x"); },
    };
    const res = await handle(post(valid), async () => ({ ...deps, llm: spent }), OPTS);
    const text = await res.text();
    expect(text).toContain("at_capacity");
  });

  it("stops the model stream when the client cancels", async () => {
    let finished = false;
    const slow: LLM = {
      async generate(req: GenerateRequest) { return req.json ? { text: "{}" } : { text: "x" }; },
      async *stream() { try { for (let i = 0; i < 1000; i++) { yield "w "; await new Promise((r) => setTimeout(r, 1)); } } finally { finished = true; } },
    };
    const res = await handle(post(valid), async () => ({ ...deps, llm: slow }), OPTS);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 30));
    expect(finished).toBe(true);
  });

  it("makes no console calls while serving a request", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await (await run(post(valid))).text();
    await run(post(null, {}, "{bad"));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

describe("POST /feedback", () => {
  const vote = (body: unknown, raw?: string) =>
    new Request("https://api.test/feedback", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example" }, body: raw ?? JSON.stringify(body) });
  it("counts a vote and passes nothing but the vote word", async () => {
    const rec = vi.fn();
    const res = await handle(vote({ vote: "down" }), async () => deps, { ...OPTS, recordVote: rec });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(rec).toHaveBeenCalledExactlyOnceWith("down");
  });
  it("rejects anything but exactly {vote: up|down}, so no free text gets in", async () => {
    const rec = vi.fn();
    for (const body of [{ vote: "maybe" }, { vote: "up", comment: "my address is" }, { comment: "x" }, [], null]) {
      expect((await handle(vote(body), async () => deps, { ...OPTS, recordVote: rec })).status).toBe(400);
    }
    expect((await handle(vote(null, "{not json"), async () => deps, { ...OPTS, recordVote: rec })).status).toBe(400);
    expect((await handle(vote({ vote: "up", pad: "x".repeat(100) }), async () => deps, { ...OPTS, recordVote: rec })).status).toBe(413);
    expect(rec).not.toHaveBeenCalled();
  });
  it("runs the guard first and still answers ok when the counter throws", async () => {
    const blocked = await handle(vote({ vote: "up" }), async () => deps, { ...OPTS, guard: async () => ({ ok: false, status: 429, error: "rate_limited" }) });
    expect(blocked.status).toBe(429);
    const boom = await handle(vote({ vote: "up" }), async () => deps, { ...OPTS, recordVote: () => { throw new Error("x"); } });
    expect(boom.status).toBe(200);
  });
});
