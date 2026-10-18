import type { GenerateRequest, GenerateResult, LLM } from "./types";

/**
 * Scripted model for tests and the local dev Worker (never used in production wiring).
 * Rewrite calls (json) get a fixed German query; answer calls cite the first source of each region.
 */
export class FakeLLM implements LLM {
  calls: GenerateRequest[] = [];
  constructor(private rewrite: object | string = { language: "en", queries: ["Wohnung anmelden"], topic_keys: ["anmeldung"] }) {}

  private answer(req: GenerateRequest): string {
    const seen = new Set<string>();
    const cites: string[] = [];
    for (const m of req.system!.matchAll(/^\[(\d+)\] region: (.*?) \|/gm)) {
      if (!seen.has(m[2]!)) { seen.add(m[2]!); cites.push(`Schritt in ${m[2]} [${m[1]}]`); }
    }
    return cites.length ? cites.join(". ") + "." : "Dazu habe ich keine Quelle.";
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(req);
    if (req.json) return { text: typeof this.rewrite === "string" ? this.rewrite : JSON.stringify(this.rewrite) };
    return { text: this.answer(req) + " Bogus [99]." };
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    this.calls.push(req);
    for (const word of (this.answer(req) + " Bogus [99].").split(" ")) yield word + " ";
  }
}
