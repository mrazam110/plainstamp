import { postJson, readJson, safeParse, type Fetch } from "../http";
import type { GenerateRequest, GenerateResult, LLM } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiLLMOptions {
  apiKey: string;
  model: string;
  fetch?: Fetch;
  baseDelayMs?: number;
}

interface Candidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

const textOf = (c?: Candidate) => (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");

export class GeminiLLM implements LLM {
  constructor(private o: GeminiLLMOptions) {}

  private body(req: GenerateRequest) {
    return {
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      contents: req.messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] })),
      generationConfig: {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
        ...(req.json ? { responseMimeType: "application/json", ...(req.json.schema ? { responseSchema: req.json.schema } : {}) } : {}),
      },
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const res = await postJson(
      this.o.fetch ?? fetch, `${BASE}/models/${this.o.model}:generateContent`, this.o.apiKey, this.body(req),
      { baseDelayMs: this.o.baseDelayMs },
    );
    const json = await readJson<{ candidates?: Candidate[] }>(res);
    const c = json.candidates?.[0];
    return { text: textOf(c), finishReason: c?.finishReason };
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    const res = await postJson(
      this.o.fetch ?? fetch, `${BASE}/models/${this.o.model}:streamGenerateContent?alt=sse`, this.o.apiKey,
      this.body(req), { baseDelayMs: this.o.baseDelayMs },
    );
    if (!res.body) throw new Error("streaming response has no body");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const text = textOf(safeParse<{ candidates?: Candidate[] }>(payload).candidates?.[0]);
        if (text) yield text;
      }
    }
  }
}
