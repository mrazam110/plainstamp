import { ProviderError } from "../http";
import type { GenerateRequest, LLM } from "../llm/types";

/** Keeps under the per-minute quota and waits out a 429 instead of failing the question. */
export function paced(inner: LLM, perMinute: number): LLM {
  const gap = 60000 / perMinute;
  let next = 0;
  const wait = async () => { const d = next - Date.now(); next = Math.max(next, Date.now()) + gap; if (d > 0) await new Promise((r) => setTimeout(r, d)); };
  return {
    async generate(req: GenerateRequest) {
      for (let attempt = 0; ; attempt++) {
        await wait();
        try { return await inner.generate(req); } catch (e) {
          if (!(e instanceof ProviderError) || e.status !== 429 || attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 30000));
        }
      }
    },
    stream: (req) => inner.stream(req),
  };
}
