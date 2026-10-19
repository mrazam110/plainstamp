/** Optional Cloudflare Turnstile bot check. Active only when a site key is configured at build time. */
export interface TurnstileApi {
  render(container: HTMLElement | string, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
}

export interface TurnstileDeps {
  load(): Promise<TurnstileApi>;
  container: HTMLElement | string;
}

/** One fresh single-use token per question (tokens expire after 5 minutes and work once). */
export function createTurnstile(sitekey: string, deps: TurnstileDeps) {
  let widget: string | undefined;
  let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  const fail = () => pending?.reject(new Error("turnstile_failed"));
  return {
    async getToken(timeoutMs = 30000): Promise<string> {
      const api = await deps.load();
      if (widget === undefined) {
        widget = api.render(deps.container, {
          sitekey,
          execution: "execute",
          appearance: "interaction-only",
          callback: (t: string) => pending?.resolve(t),
          "error-callback": fail,
          "timeout-callback": fail,
        });
      } else api.reset(widget);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("turnstile_failed")), timeoutMs);
        pending = { resolve: (t) => { clearTimeout(timer); resolve(t); }, reject: (e) => { clearTimeout(timer); reject(e); } };
        api.execute(widget!);
      });
    },
  };
}

/** Loads Cloudflare's script once. This is the only third-party request the page can make, and only with a site key. */
export function loadTurnstileScript(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  // An element with id="turnstile" would also show up as window.turnstile, so check for the real API.
  if (typeof w.turnstile?.render === "function") return Promise.resolve(w.turnstile);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.referrerPolicy = "strict-origin";
    s.onload = () => (typeof w.turnstile?.render === "function" ? resolve(w.turnstile) : reject(new Error("turnstile_failed")));
    s.onerror = () => reject(new Error("turnstile_failed"));
    document.head.append(s);
  });
}
