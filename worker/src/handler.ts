import { askStream, type Deps } from "../../core/pipeline/ask";
import { AskError, type AskRequest } from "../../core/pipeline/types";
import type { GuardResult } from "./guard";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT = 2000;
const MODES = new Set(["germany", "state", "move"]);

export interface HandlerOptions {
  /** Origins allowed to call /ask from a browser; empty means same-origin only. */
  allowedOrigins: string[];
  /** Rate limit and bot check; runs before the body is read. Omitted only for local fakes. */
  guard?: (request: Request) => Promise<GuardResult>;
}

function corsHeaders(req: Request, opts: HandlerOptions): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !opts.allowedOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-turnstile-token",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

/** Checks shape and size only; the pipeline validates region ids against the config. */
export function parseAskRequest(raw: unknown): AskRequest {
  const r = raw as Record<string, any> | null;
  const bad = () => new AskError("invalid request");
  if (!r || typeof r.question !== "string" || r.question.length > MAX_TEXT) throw bad();
  const c = r.context;
  if (!c || !MODES.has(c.mode)) throw bad();
  for (const k of ["state", "fromState", "toState", "situation", "language"]) {
    if (c[k] !== undefined && (typeof c[k] !== "string" || c[k].length > MAX_TEXT)) throw bad();
  }
  const history = r.history ?? [];
  if (!Array.isArray(history) || history.length > 12) throw bad();
  for (const m of history) {
    if (!m || (m.role !== "user" && m.role !== "model") || typeof m.content !== "string" || m.content.length > MAX_TEXT) throw bad();
  }
  return {
    question: r.question,
    context: { mode: c.mode, state: c.state, fromState: c.fromState, toState: c.toState, situation: c.situation, language: c.language },
    history: history.map((m: any) => ({ role: m.role, content: m.content })),
  };
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Stateless: nothing is stored, nothing is logged (no console calls in this file or in core/), and
 * errors are fixed codes. The question exists only in memory for the length of the request.
 */
export async function handle(request: Request, getDeps: () => Promise<Deps>, opts: HandlerOptions): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(request, opts);

  if (url.pathname === "/health") return json(200, { ok: true });
  if (url.pathname !== "/ask") return json(404, { error: "not_found" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { ...cors, allow: "POST, OPTIONS" });
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json(415, { error: "unsupported_media_type" }, cors);

  if (opts.guard) {
    const g = await opts.guard(request);
    if (!g.ok) return json(g.status, { error: g.error }, { ...cors, ...(g.retryAfter ? { "retry-after": String(g.retryAfter) } : {}) });
  }

  let body: AskRequest;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { error: "too_large" }, cors);
    body = parseAskRequest(JSON.parse(text));
  } catch {
    return json(400, { error: "invalid_request" }, cors);
  }

  let stream: ReturnType<typeof askStream>;
  try {
    stream = askStream(body, await getDeps());
  } catch {
    return json(502, { error: "upstream_error" }, cors);
  }

  // Run the first step (rewrite, retrieval) before committing to a stream, so request errors get a real status.
  let first: IteratorResult<any>;
  try {
    first = await stream.next();
  } catch (e) {
    return e instanceof AskError ? json(400, { error: "invalid_request" }, cors) : json(502, { error: "upstream_error" }, cors);
  }

  const enc = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(sse(event, data)));
      const emit = (v: any) => {
        if ("meta" in v) send("meta", { language: v.meta.language, needsState: v.meta.needsState, notCovered: v.meta.notCovered });
        else if ("delta" in v) send("delta", { text: v.delta });
        else send("done", v.done);
      };
      try {
        if (!first.done) emit(first.value);
        for (;;) {
          const n = await stream.next();
          if (n.done) break;
          emit(n.value);
        }
      } catch {
        send("error", { error: "upstream_error" });
      }
      try {
        controller.close();
      } catch {
        // client already disconnected
      }
    },
    cancel() {
      void stream.return(undefined); // client left: stop pulling from the model
    },
  });
  return new Response(out, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", ...cors },
  });
}
