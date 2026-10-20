import { parseSse, type SseEvent } from "./sse";

export interface AskBody {
  question: string;
  context: { mode: "germany" | "state" | "move"; state?: string; fromState?: string; toState?: string; situation?: string; language?: string };
  history: { role: "user" | "model"; content: string }[];
}

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Plain http is only allowed for local development; anything else must be https so questions are not sent in clear. */
export function assertSecureBase(base: string): void {
  const u = new URL(base);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !local) throw new ApiError("insecure_api_url");
}

/** POSTs the question and yields SSE events. Nothing is cached or stored by the page except what the caller keeps. */
export async function* streamAsk(base: string, body: AskBody, signal?: AbortSignal, fetchFn: typeof fetch = fetch, turnstileToken?: string): AsyncGenerator<SseEvent> {
  assertSecureBase(base);
  const res = await fetchFn(`${base}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(turnstileToken ? { "x-turnstile-token": turnstileToken } : {}) },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok || !res.body) {
    let code = "network";
    try {
      code = ((await res.json()) as { error?: string }).error ?? `status_${res.status}`;
    } catch { /* keep default */ }
    throw new ApiError(code);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    const { events, rest } = parseSse(buf);
    buf = rest;
    yield* events;
  }
}

/** Counts one Helpful / Not helpful vote. The body is the vote word only: no question, answer or id. */
export async function sendVote(base: string, vote: "up" | "down", fetchFn: typeof fetch = fetch, turnstileToken?: string): Promise<void> {
  assertSecureBase(base);
  const res = await fetchFn(`${base}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(turnstileToken ? { "x-turnstile-token": turnstileToken } : {}) },
    body: JSON.stringify({ vote }),
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok) throw new ApiError(`status_${res.status}`);
}

/** Questions asked today across all visitors, or null when the server has no count. Sends nothing about the visitor. */
export async function fetchQuestionsToday(base: string, fetchFn: typeof fetch = fetch): Promise<number | null> {
  assertSecureBase(base);
  const res = await fetchFn(`${base}/stats`, { cache: "no-store", credentials: "omit" });
  if (!res.ok) return null;
  const n = ((await res.json()) as { today?: unknown }).today;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
