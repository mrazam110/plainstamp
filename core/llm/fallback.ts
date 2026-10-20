import { ProviderError } from "../http";
import type { GenerateRequest, GenerateResult, LLM } from "./types";

/** Statuses that mean the primary's quota or billing is spent (or access is blocked), so another provider should answer. */
const OUT_OF_CREDIT = new Set([402, 403, 429]);

export const isOutOfCredit = (e: unknown) => e instanceof ProviderError && OUT_OF_CREDIT.has(e.status);

/**
 * Uses the primary until it reports an exhausted quota, then the fallback. A stream can only switch
 * before its first delta; after that the error surfaces, because the reply would otherwise mix two models.
 */
export class FallbackLLM implements LLM {
  constructor(private primary: LLM, private fallback: LLM) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      return await this.primary.generate(req);
    } catch (e) {
      if (!isOutOfCredit(e)) throw e;
      return this.fallback.generate(req);
    }
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    let started = false;
    try {
      for await (const delta of this.primary.stream(req)) {
        started = true;
        yield delta;
      }
      return;
    } catch (e) {
      if (started || !isOutOfCredit(e)) throw e;
    }
    yield* this.fallback.stream(req);
  }
}
