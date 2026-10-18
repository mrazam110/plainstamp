import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FakeLLM } from "../../core/llm/fake";
import type { Deps } from "../../core/pipeline/ask";
import { loadConfig } from "../../core/pipeline/config-fs";
import { BundleRetriever } from "../../core/retriever/bundle";
import { FakeEmbedder, makeBundle } from "../../core/retriever/testing";
import { coarseIp, createGuard, pseudonymKey, verifyTurnstile, type RateLimiter } from "./guard";
import { handle } from "./handler";

const limiter = (allow: () => boolean, seen: string[] = []): RateLimiter => ({
  async limit({ key }) { seen.push(key); return { success: allow() }; },
});
const siteverify = (success: boolean | "throw" | "http500") => vi.fn(async () => {
  if (success === "throw") throw new Error("network");
  if (success === "http500") return new Response("x", { status: 500 });
  return new Response(JSON.stringify({ success }), { status: 200 });
}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const req = (headers: Record<string, string> = {}) => new Request("https://api.test/ask", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
const full = { RATE_SALT: "salt", TURNSTILE_SECRET: "sec", REQUIRE_GUARDS: "1" };

describe("pseudonymous key", () => {
  it("coarsens addresses", () => {
    expect(coarseIp("203.0.113.77")).toBe("203.0.113");
    expect(coarseIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2");
    expect(coarseIp("2001:db8::1")).toBe("2001:db8:0:0");
    expect(coarseIp("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8:0:0");
    expect(coarseIp("2001:db8:5::7")).toBe("2001:db8:5:0");
    expect(coarseIp("::1")).toBe("0:0:0:0");
  });
  it("is stable within a day, changes with salt and day, and does not contain the IP", async () => {
    const a = await pseudonymKey("203.0.113.5", "s", "2026-10-18");
    expect(await pseudonymKey("203.0.113.9", "s", "2026-10-18")).toBe(a); // same /24
    expect(await pseudonymKey("203.0.113.5", "s", "2026-10-19")).not.toBe(a);
    expect(await pseudonymKey("203.0.113.5", "t", "2026-10-18")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain("203");
  });
});

describe("verifyTurnstile", () => {
  it("accepts only an explicit success and never forwards the visitor IP", async () => {
    const f = siteverify(true);
    expect(await verifyTurnstile("tok", "sec", f)).toBe(true);
    const [, init] = (f as any).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ secret: "sec", response: "tok" });
  });
  it("fails closed on rejection, network error, bad status, empty or oversized token", async () => {
    expect(await verifyTurnstile("tok", "sec", siteverify(false))).toBe(false);
    expect(await verifyTurnstile("tok", "sec", siteverify("throw"))).toBe(false);
    expect(await verifyTurnstile("tok", "sec", siteverify("http500"))).toBe(false);
    expect(await verifyTurnstile("", "sec", siteverify(true))).toBe(false);
    expect(await verifyTurnstile("x".repeat(3000), "sec", siteverify(true))).toBe(false);
  });
});

describe("createGuard", () => {
  it("passes when limits hold and the token verifies; key is the pseudonym, not the IP", async () => {
    const seen: string[] = [];
    const g = createGuard({ ...full, RATE_LIMITER: limiter(() => true, seen), GLOBAL_LIMITER: limiter(() => true, seen) }, siteverify(true), () => new Date("2026-10-18T10:00:00Z"));
    expect(await g(req({ "cf-connecting-ip": "198.51.100.23", "x-turnstile-token": "t" }))).toEqual({ ok: true });
    expect(seen[0]).toBe("global");
    expect(seen[1]).toMatch(/^[0-9a-f]{16}$/);
    expect(seen.join()).not.toContain("198.51");
  });
  it("returns 429 with retry-after data when the client or the global limiter says no, before calling Turnstile", async () => {
    const f = siteverify(true);
    const g1 = createGuard({ ...full, RATE_LIMITER: limiter(() => false), GLOBAL_LIMITER: limiter(() => true) }, f);
    expect(await g1(req({ "x-turnstile-token": "t" }))).toEqual({ ok: false, status: 429, error: "rate_limited", retryAfter: 60 });
    const g2 = createGuard({ ...full, RATE_LIMITER: limiter(() => true), GLOBAL_LIMITER: limiter(() => false) }, f);
    expect((await g2(req())).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("returns 403 for a missing or rejected token", async () => {
    const ok = { ...full, RATE_LIMITER: limiter(() => true), GLOBAL_LIMITER: limiter(() => true) };
    expect(await createGuard(ok, siteverify(true))(req())).toMatchObject({ ok: false, status: 403, error: "turnstile_failed" });
    expect(await createGuard(ok, siteverify(false))(req({ "x-turnstile-token": "t" }))).toMatchObject({ status: 403 });
  });
  it("fails closed when a limiter throws, and refuses a missing salt for real client addresses", async () => {
    const boom: RateLimiter = { limit: async () => { throw new Error("binding down"); } };
    expect(await createGuard({ RATE_LIMITER: boom, RATE_SALT: "s" })(req({ "cf-connecting-ip": "203.0.113.1" }))).toEqual({ ok: false, status: 503, error: "guard_error" });
    expect(await createGuard({ RATE_LIMITER: limiter(() => true) })(req({ "cf-connecting-ip": "203.0.113.1" }))).toEqual({ ok: false, status: 503, error: "guard_unconfigured" });
    expect(await createGuard({ RATE_LIMITER: limiter(() => true) })(req())).toEqual({ ok: true }); // local dev, no client address
  });
  it("fails closed with 503 when production guards are not configured, open only when not required", async () => {
    expect(await createGuard({ REQUIRE_GUARDS: "1" })(req())).toEqual({ ok: false, status: 503, error: "guard_unconfigured" });
    expect(await createGuard({ ...full, RATE_LIMITER: limiter(() => true) })(req())).toMatchObject({ status: 503 });
    expect(await createGuard({})(req())).toEqual({ ok: true });
  });
});

describe("handler with guard", () => {
  let deps: Deps;
  beforeAll(async () => {
    const embedder = new FakeEmbedder();
    const config = await loadConfig(join(import.meta.dirname, "../.."));
    const c = { id: "be1", docId: "d", title: "T", heading: "H", regionId: "de-be", topicKey: "anmeldung", leikaKey: null, url: "https://x/1", crawledAt: "2026-10-18", text: "Wohnung anmelden" };
    deps = { llm: new FakeLLM(), embedder, retriever: new BundleRetriever([await makeBundle("de-be", [c], embedder)]), config };
  });
  const body = JSON.stringify({ question: "register flat", context: { mode: "state", state: "de-be" } });
  const call = (guard: ReturnType<typeof createGuard>, headers: Record<string, string> = {}) =>
    handle(new Request("https://api.test/ask", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example", ...headers }, body }), async () => deps, { allowedOrigins: ["https://app.example"], guard });

  it("answers 429 and 403 with fixed codes, CORS headers and retry-after", async () => {
    const limited = await call(createGuard({ ...full, RATE_LIMITER: limiter(() => false), GLOBAL_LIMITER: limiter(() => true) }, siteverify(true)));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(limited.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    const blocked = await call(createGuard({ ...full, RATE_LIMITER: limiter(() => true), GLOBAL_LIMITER: limiter(() => true) }, siteverify(false)), { "x-turnstile-token": "bad" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "turnstile_failed" });
  });
  it("serves the stream when the guard passes, and never logs or echoes the IP", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const g = createGuard({ ...full, RATE_LIMITER: limiter(() => true), GLOBAL_LIMITER: limiter(() => true) }, siteverify(true));
    const res = await call(g, { "x-turnstile-token": "ok", "cf-connecting-ip": "198.51.100.23" });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("198.51");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
  it("preflight allows the Turnstile header", async () => {
    const pre = await handle(new Request("https://api.test/ask", { method: "OPTIONS", headers: { origin: "https://app.example" } }), async () => deps, { allowedOrigins: ["https://app.example"] });
    expect(pre.headers.get("access-control-allow-headers")).toContain("x-turnstile-token");
  });
});
