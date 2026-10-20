import { describe, expect, it } from "vitest";
import { ProviderError } from "../http";
import { FallbackLLM } from "./fallback";
import type { GenerateRequest, LLM } from "./types";

const req: GenerateRequest = { messages: [{ role: "user", content: "hi" }] };

function stub(name: string, opts: { fail?: number; deltas?: string[]; failAfter?: number } = {}) {
  const calls = { n: 0 };
  const llm: LLM = {
    async generate() {
      calls.n++;
      if (opts.fail) throw new ProviderError(opts.fail, "x");
      return { text: name };
    },
    async *stream() {
      calls.n++;
      let i = 0;
      for (const d of opts.deltas ?? [name]) {
        if (opts.fail && i === (opts.failAfter ?? 0)) throw new ProviderError(opts.fail, "x");
        i++;
        yield d;
      }
    },
  };
  return { llm, calls };
}

const collect = async (it: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
};

describe("FallbackLLM", () => {
  it("uses the primary while it works", async () => {
    const p = stub("primary"), f = stub("fallback");
    expect((await new FallbackLLM(p.llm, f.llm).generate(req)).text).toBe("primary");
    expect(f.calls.n).toBe(0);
  });

  it.each([402, 403, 429])("generate switches on status %i", async (status) => {
    const p = stub("primary", { fail: status }), f = stub("fallback");
    expect((await new FallbackLLM(p.llm, f.llm).generate(req)).text).toBe("fallback");
  });

  it("does not switch on other errors", async () => {
    const p = stub("primary", { fail: 400 }), f = stub("fallback");
    await expect(new FallbackLLM(p.llm, f.llm).generate(req)).rejects.toThrow();
    expect(f.calls.n).toBe(0);
  });

  it("stream switches when the primary fails before its first delta", async () => {
    const p = stub("primary", { fail: 429 }), f = stub("fallback", { deltas: ["a", "b"] });
    expect(await collect(new FallbackLLM(p.llm, f.llm).stream(req))).toEqual(["a", "b"]);
  });

  it("stream does not switch mid-reply", async () => {
    const p = stub("primary", { fail: 429, deltas: ["a", "b"], failAfter: 1 }), f = stub("fallback");
    await expect(collect(new FallbackLLM(p.llm, f.llm).stream(req))).rejects.toThrow();
    expect(f.calls.n).toBe(0);
  });
});
