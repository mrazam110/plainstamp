import { describe, expect, it, vi } from "vitest";
import { streamAsk, sendVote, ApiError, assertSecureBase } from "./api";
import { checklistItems, renderAnswer, reportText, safeUrl } from "./format";
import { parseSse } from "./sse";
import { createTurnstile, type TurnstileApi } from "./turnstile";
import { chatTitle, cleanTitle, createStore, DEFAULTS, type Chat } from "./storage";

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
  it("removes backticks so German terms in them still get the copy button", () => {
    const html = renderAnswer("Go to the citizen office (`Bürgeramt`) [1].", [cite(1)]);
    expect(html).not.toContain("`");
    expect(html).toContain('data-copy="Bürgeramt"');
  });
  it("does not treat lowercase or long brackets as German terms", () => {
    expect(renderAnswer("see (the office) or (Das ist ein sehr langer Satz mit vielen Worten drin)")).not.toContain("class=\"term\"");
  });
});

describe("renderAnswer markdown", () => {
  it("turns ### lines into headings without copy buttons for region names", () => {
    const html = renderAnswer("### 2) At the old place (Brandenburg)\nText");
    expect(html).toContain("<h4>2) At the old place (Brandenburg)</h4>");
    expect(html).not.toContain("###");
    expect(html).not.toContain("class=\"term\"");
  });
  it("renders *italic* and keeps bold, and leaves list markers alone", () => {
    const html = renderAnswer("**Fee** (*Beitragskonto*) is due\n* item *one*");
    expect(html).toContain("<strong>Fee</strong>");
    expect(html).toContain("<em>Beitragskonto</em>");
    expect(html).toContain("<ul><li>item <em>one</em></li></ul>");
  });
});

describe("helpers", () => {
  it("extracts checklist items without citations or bold", () => {
    expect(checklistItems("Intro\n- **Book** an appointment [1]\n2. Bring ID [2]\nnot a list")).toEqual(["Book an appointment", "Bring ID"]);
  });
  it("handles italic inside bold", () => {
    expect(renderAnswer("* **Fee (*Rundfunkbeitrag*):** due")).toContain("<strong>Fee (<em>Rundfunkbeitrag</em>):</strong>");
  });
  it("strips italic markers from checklist items", () => {
    expect(checklistItems("- Get the *Wohnungsgeberbestätigung* [1]")).toEqual(["Get the Wohnungsgeberbestätigung"]);
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
  const chat = (id: string, updatedAt: number, n: number): Chat => ({ id, title: id, updatedAt, messages: Array.from({ length: n }, (_, i) => ({ role: "user" as const, content: String(i) })) });
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
    s.saveChats([chat("a", 1, 100)]);
    expect(s.chats()[0]!.messages).toHaveLength(60);
    s.saveChecklist([{ id: "1", text: "x", done: false }]);
    s.clearAll();
    expect(kv.m.size).toBe(0);
  });
  it("keeps several chats newest first, caps them, and remembers the active one", () => {
    const kv = mem();
    const s = createStore(kv);
    s.saveChats(Array.from({ length: 30 }, (_, i) => chat(String(i), i, 1)));
    s.saveActiveId("7");
    const back = createStore(kv);
    expect(back.chats()).toHaveLength(20);
    expect(back.chats()[0]!.updatedAt).toBeGreaterThan(back.chats()[1]!.updatedAt);
    expect(back.activeId()).toBe("7");
  });
  it("turns the old single history into the first chat and drops the old key", () => {
    const kv = mem();
    kv.setItem("plainstamp.v1.history", JSON.stringify([{ role: "user", content: "How do I register?" }, { role: "model", content: "..." }]));
    const s = createStore(kv);
    const [first] = s.chats();
    expect(first!.title).toBe("How do I register?");
    expect(first!.messages).toHaveLength(2);
    s.saveChats(s.chats());
    expect(kv.getItem("plainstamp.v1.history")).toBeNull();
  });
  it("drops the oldest chats when the browser quota is hit", () => {
    const kv = mem();
    let calls = 0;
    const tight = { ...kv, setItem: (k: string, v: string) => { if (k.endsWith("chats") && calls++ < 2) throw new Error("quota"); kv.setItem(k, v); } };
    createStore(tight).saveChats([chat("a", 3, 1), chat("b", 2, 1), chat("c", 1, 1)]);
    expect(createStore(kv).chats().map((c) => c.id)).toEqual(["a"]);
  });
  it("titles a chat by its first question", () => {
    expect(chatTitle([])).toBe("New chat");
    expect(chatTitle([{ role: "user", content: "  Hello\n  there " }])).toBe("Hello there");
    expect(chatTitle([{ role: "user", content: "x".repeat(80) }])).toHaveLength(48);
  });
  it("cleans a typed chat name", () => {
    expect(cleanTitle("  My   move \n to Berlin ")).toBe("My move to Berlin");
    expect(cleanTitle("   ")).toBe("");
    expect(cleanTitle("y".repeat(90))).toHaveLength(60);
  });
  it("keeps the renamed flag through a save", () => {
    const kv = mem();
    createStore(kv).saveChats([{ ...chat("a", 1, 1), renamed: true, title: "Mine" }]);
    expect(createStore(kv).chats()[0]).toMatchObject({ renamed: true, title: "Mine" });
  });
  it("survives blocked or corrupt storage", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    const s = createStore(broken);
    expect(s.chats()).toEqual([]);
    expect(s.activeId()).toBeNull();
    expect(() => { s.saveChats([]); s.saveActiveId("x"); s.clearAll(); }).not.toThrow();
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

describe("turnstile", () => {
  const fakeApi = () => {
    const calls: string[] = [];
    let opts: any;
    const api: TurnstileApi = {
      render: (_c, o) => { opts = o; calls.push("render"); return "w1"; },
      execute: () => { calls.push("execute"); },
      reset: () => { calls.push("reset"); },
    };
    return { api, calls, opts: () => opts };
  };
  it("renders once, resets for later questions and resolves with the token", async () => {
    const f = fakeApi();
    const ts = createTurnstile("site", { load: async () => f.api, container: "#t" });
    const p1 = ts.getToken();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.opts()).toMatchObject({ sitekey: "site", execution: "execute", appearance: "interaction-only" });
    f.opts().callback("tok1");
    expect(await p1).toBe("tok1");
    const p2 = ts.getToken();
    await new Promise((r) => setTimeout(r, 0));
    f.opts().callback("tok2");
    expect(await p2).toBe("tok2");
    expect(f.calls).toEqual(["render", "execute", "reset", "execute"]);
  });
  it("rejects on widget error and on timeout", async () => {
    const f = fakeApi();
    const ts = createTurnstile("site", { load: async () => f.api, container: "#t" });
    const p = ts.getToken();
    await new Promise((r) => setTimeout(r, 0));
    f.opts()["error-callback"]();
    await expect(p).rejects.toThrow("turnstile_failed");
    await expect(createTurnstile("s", { load: async () => fakeApi().api, container: "#t" }).getToken(20)).rejects.toThrow("turnstile_failed");
  });
  it("sends the token as a header only when there is one", async () => {
    const seen: Record<string, string>[] = [];
    const f = (async (_u: string, i: RequestInit) => { seen.push(i.headers as Record<string, string>); return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }); }) as unknown as typeof fetch;
    const body = { question: "q", context: { mode: "germany" as const }, history: [] };
    for await (const _ of streamAsk("https://api.test", body, undefined, f, "tok")) void _;
    for await (const _ of streamAsk("https://api.test", body, undefined, f)) void _;
    expect(seen[0]!["x-turnstile-token"]).toBe("tok");
    expect(seen[1]!["x-turnstile-token"]).toBeUndefined();
  });
});

describe("directory config", () => {
  it("only links to https pages and every entry has an ask question", async () => {
    const d = (await import("./directory.generated.json")).default as { entries: { ask: string; link?: string }[] };
    expect(d.entries.length).toBeGreaterThan(0);
    for (const e of d.entries) {
      expect(e.ask.length).toBeGreaterThan(5);
      if (e.link) expect(safeUrl(e.link)).toMatch(/^https:\/\//);
    }
  });
});

describe("sendVote", () => {
  it("posts only the vote word, without credentials", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendVote("https://api.test", "up", f as any, "tok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/feedback");
    expect(init.body).toBe('{"vote":"up"}');
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>)["x-turnstile-token"]).toBe("tok");
  });
  it("throws when the server refuses", async () => {
    await expect(sendVote("https://api.test", "down", (async () => new Response("{}", { status: 429 })) as any)).rejects.toBeInstanceOf(ApiError);
  });
});
