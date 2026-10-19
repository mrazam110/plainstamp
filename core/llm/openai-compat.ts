import { postJson, readJson, safeParse, type Fetch } from "../http";
import type { GenerateRequest, GenerateResult, LLM } from "./types";

export interface OpenAICompatLLMOptions {
  apiKey: string;
  model: string;
  /** Base URL up to and including /v1, for example https://integrate.api.nvidia.com/v1 */
  baseUrl: string;
  fetch?: Fetch;
  baseDelayMs?: number;
  /** Reasoning models spend part of max_tokens on hidden thinking; this is added on top of the caller's limit. */
  reasoningPadding?: number;
}

interface Choice {
  message?: { content?: string | null };
  delta?: { content?: string | null };
  finish_reason?: string | null;
}

const JSON_ONLY = "Reply with ONLY one JSON object that follows this schema. No prose, no code fence.";

/** First {...} block of a reply: models sometimes wrap JSON in prose or a code fence. */
export function extractJson(text: string): string {
  const m = /\{[\s\S]*\}/.exec(text);
  return m ? m[0] : text.trim();
}

/**
 * Chat client for OpenAI-compatible endpoints (NVIDIA API catalog, vLLM, ...). Plain fetch, no SDK.
 * JSON mode (response_format) is not used: it returned empty objects from the NVIDIA reasoning model,
 * so JSON is requested in the prompt and extracted from the reply.
 */
export class OpenAICompatLLM implements LLM {
  constructor(private o: OpenAICompatLLMOptions) {}

  private url() {
    return `${this.o.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private body(req: GenerateRequest, stream: boolean) {
    let system = req.system ?? "";
    if (req.json) {
      const schema = req.json.schema ? ` Schema: ${JSON.stringify(req.json.schema)}` : "";
      system = `${system}\n${JSON_ONLY}${schema}`.trim();
    }
    return {
      model: this.o.model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...req.messages.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.content })),
      ],
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      max_tokens: (req.maxOutputTokens ?? 1024) + (this.o.reasoningPadding ?? 0),
      stream,
    };
  }

  private post(req: GenerateRequest, stream: boolean) {
    return postJson(this.o.fetch ?? fetch, this.url(), "", this.body(req, stream), {
      baseDelayMs: this.o.baseDelayMs,
      headers: { authorization: `Bearer ${this.o.apiKey}` },
    });
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const res = await this.post(req, false);
    const json = await readJson<{ choices?: Choice[] }>(res);
    const c = json.choices?.[0];
    const text = c?.message?.content ?? ""; // reasoning models can return null content when the budget ran out
    return { text: req.json ? extractJson(text) : text, finishReason: c?.finish_reason ?? undefined };
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    const res = await this.post(req, true);
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
        const text = safeParse<{ choices?: Choice[] }>(payload).choices?.[0]?.delta?.content;
        if (text) yield text; // reasoning_content deltas are ignored on purpose
      }
    }
  }
}
