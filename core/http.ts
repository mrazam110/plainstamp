export type Fetch = typeof fetch;

export class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * POST JSON with a small retry on 429 and 5xx. Error messages carry the status only, never the
 * request body or the provider's reply, so prompts cannot end up in logs (stateless privacy rule).
 */
export async function postJson(
  fetchFn: Fetch, url: string, apiKey: string, body: unknown, opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 300;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new ProviderError(res.status, `provider request failed with status ${res.status}`);
    await new Promise((r) => setTimeout(r, base * 2 ** attempt));
  }
}
