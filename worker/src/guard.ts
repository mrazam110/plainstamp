/**
 * Abuse protection that keeps the stateless privacy rule: no IP is stored or logged. The only per-client
 * identifier is a salted, daily-rotating hash of a coarsened IP, used as an in-memory counter key by the
 * platform rate limiter and never written anywhere by this code. Turnstile adds a bot check without accounts.
 */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface GuardEnv {
  /** Per-client limiter binding (wrangler [[ratelimits]]). */
  RATE_LIMITER?: RateLimiter;
  /** Coarse worker-wide limiter, protects the model quota. */
  GLOBAL_LIMITER?: RateLimiter;
  /** Secret mixed into the key hash; rotated implicitly every day. */
  RATE_SALT?: string;
  TURNSTILE_SECRET?: string;
  /** "1" in production: refuse to serve when a guard is not configured instead of running open. */
  REQUIRE_GUARDS?: string;
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string; retryAfter?: number };

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** IPv4 -> /24, IPv6 -> /64, so the key never identifies a single device and shared networks are tolerated. */
/** Expands "::" so compressed IPv6 forms are cut at the same /64 boundary as full ones. */
function expandIpv6(ip: string): string[] {
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const missing = ip.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array<string>(Math.max(0, missing)).fill("0"), ...t].map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
}

export function coarseIp(ip: string): string {
  if (ip.includes(":")) return expandIpv6(ip).slice(0, 4).join(":");
  const p = ip.split(".");
  return p.length === 4 ? p.slice(0, 3).join(".") : ip;
}

export async function pseudonymKey(ip: string, salt: string, day: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${salt}:${day}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(coarseIp(ip)));
  return [...new Uint8Array(sig)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True only when Cloudflare confirms the token. Any failure (network, status, shape) counts as not verified. */
export async function verifyTurnstile(token: string, secret: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  try {
    const res = await fetchFn(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }), // no remoteip: the visitor IP is not forwarded
    });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: unknown }).success === true;
  } catch {
    return false;
  }
}

export function createGuard(env: GuardEnv, fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()) {
  const run = async (request: Request): Promise<GuardResult> => {
    const required = env.REQUIRE_GUARDS === "1";
    if (required && (!env.RATE_LIMITER || !env.GLOBAL_LIMITER || !env.RATE_SALT || !env.TURNSTILE_SECRET)) {
      return { ok: false, status: 503, error: "guard_unconfigured" };
    }
    if (env.GLOBAL_LIMITER && !(await env.GLOBAL_LIMITER.limit({ key: "global" })).success) {
      return { ok: false, status: 429, error: "rate_limited", retryAfter: 60 };
    }
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      // A public fallback salt would make the key brute-forceable; only the header-less local dev case may use one.
      if (!env.RATE_SALT && ip !== "local") return { ok: false, status: 503, error: "guard_unconfigured" };
      const key = await pseudonymKey(ip, env.RATE_SALT ?? "dev-salt", now().toISOString().slice(0, 10));
      if (!(await env.RATE_LIMITER.limit({ key })).success) return { ok: false, status: 429, error: "rate_limited", retryAfter: 60 };
    }
    if (env.TURNSTILE_SECRET) {
      const token = request.headers.get("x-turnstile-token") ?? "";
      if (!(await verifyTurnstile(token, env.TURNSTILE_SECRET, fetchFn))) return { ok: false, status: 403, error: "turnstile_failed" };
    }
    return { ok: true };
  };
  // A failing limiter or verifier must never turn into an open endpoint or a raw platform error.
  return async (request: Request): Promise<GuardResult> => {
    try {
      return await run(request);
    } catch {
      return { ok: false, status: 503, error: "guard_error" };
    }
  };
}
