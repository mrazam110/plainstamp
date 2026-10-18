import { describe, expect, it } from "vitest";
import { streamAsk, ApiError, assertSecureBase } from "./api";
import { checklistItems, renderAnswer, reportText, safeUrl } from "./format";
import { parseSse } from "./sse";
import { createStore, DEFAULTS } from "./storage";

const cite = (n: number) => ({ n, title: "T", heading: "H", url: "https://x/" + n, crawledAt: "2026-10-18", regionId: "de", regionName: "Germany" });

describe("parseSse", () => {
  it("returns complete events and keeps the unfinished tail", () => {
    const a = parseSse('event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {"a"');
    expect(a.events).toEqual([{ event: "delta", data: { text: "Hi" } }]);
    expect(parseSse(a.rest + ':1}\n\n').events).toEqual([{ event: "done", data: { a: 1 } }]);
  });
  it("skips malformed blocks", () => {
    expect(parseSse("event: x\ndata: {bad\n\n").events).toEqual([]);
  });
});

describe("renderAnswer", () => {
  it("escapes HTML and never emits raw tags from the model", () => {
    const html = renderAnswer('<img src=x onerror=alert(1)> **bold** <script>x</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>bold</strong>");
  });
  it("links only real citations and drops others", () => {
    const html = renderAnswer("Step one [1] and [7].", [cite(1)]);
    expect(html).toContain('href="#src-1"');
    expect(html).not.toContain("[7]");
    expect(html).not.toContain("src-7");
  });
  it("builds lists and German term copy buttons", () => {
    const html = renderAnswer("Do this:\n- Register (Anmeldung) at the office\n- Bring a lease\n\n1. First\n2. Second");
    expect(html).toContain("<ul><li>Register");
    expect(html).toContain('data-copy="Anmeldung"');
    expect(html).toContain("<ol><li>First</li><li>Second</li></ol>");
  });
  it("does not treat lowercase or long brackets as German terms", () => {
    expect(renderAnswer("see (the office) or (Das ist ein sehr langer Satz mit vielen Worten drin)")).not.toContain("class=\"term\"");
  });
});

describe("helpers", () => {
  it("extracts checklist items without citations or bold", () => {
    expect(checklistItems("Intro\n- **Book** an appointment [1]\n2. Bring ID [2]\nnot a list")).toEqual(["Book an appointment", "Bring ID"]);
  });
  it("only allows http(s) links", () => {
    expect(safeUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("nope")).toBe("#");
  });
  it("builds a report with question, answer and sources", () => {
    const r = reportText("Q?", "A.", [cite(1)], new Date("2026-10-18T10:00:00Z"));
    expect(r).toContain("reported 2026-10-18");
    expect(r).toContain("remove names, addresses, ID numbers");
    expect(r).toContain("[1] Germany: T - https://x/1 (checked 2026-10-18)");
  });
});

describe("store", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it("round-trips settings with defaults for missing keys, caps history, clears everything", () => {
    const kv = mem();
    const s = createStore(kv);
    expect(s.settings()).toEqual(DEFAULTS);
    s.saveSettings({ ...DEFAULTS, mode: "state", state: "de-be" });
    expect(createStore(kv).settings().state).toBe("de-be");
    s.saveHistory(Array.from({ length: 100 }, (_, i) => ({ role: "user" as const, content: String(i) })));
    expect(s.history()).toHaveLength(60);
    s.saveChecklist([{ id: "1", text: "x", done: false }]);
    s.clearAll();
    expect(kv.m.size).toBe(0);
  });
  it("survives blocked or corrupt storage", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    const s = createStore(broken);
    expect(s.history()).toEqual([]);
    expect(() => { s.saveHistory([]); s.clearAll(); }).not.toThrow();
    const bad = { ...mem(), getItem: () => "{not json" };
    expect(createStore(bad).settings()).toEqual(DEFAULTS);
  });
});

describe("assertSecureBase", () => {
  it("allows https and localhost http only", () => {
    expect(() => assertSecureBase("https://api.example")).not.toThrow();
    expect(() => assertSecureBase("http://localhost:8787")).not.toThrow();
    expect(() => assertSecureBase("http://api.example")).toThrow(ApiError);
  });
});

describe("streamAsk", () => {
  it("yields events across chunk boundaries and sends no credentials", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('event: delta\ndata: {"te')); c.enqueue(enc.encode('xt":"a"}\n\nevent: done\ndata: {}\n\n')); c.close(); } });
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => { init = i; return new Response(body, { status: 200 }); }) as unknown as typeof fetch;
    const out = [];
    for await (const e of streamAsk("https://api.test", { question: "q", context: { mode: "germany" }, history: [] }, undefined, f)) out.push(e);
    expect(out.map((e) => e.event)).toEqual(["delta", "done"]);
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
  });
  it("throws the server's fixed error code", async () => {
    const f = (async () => new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 })) as unknown as typeof fetch;
    const err = await (async () => { try { for await (const _ of streamAsk("https://api.test", { question: "", context: { mode: "germany" }, history: [] }, undefined, f)) void _; } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("invalid_request");
  });
});
