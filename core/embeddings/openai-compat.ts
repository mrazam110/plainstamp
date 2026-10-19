import { postJson, readJson, type Fetch } from "../http";
import { normalise, type Embedder } from "./types";

const BATCH = 50;

export interface OpenAICompatEmbedderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Output size the model returns (checked on every response). */
  dimension: number;
  /** Prefix for Embedder.name, for example "nvidia". */
  label: string;
  fetch?: Fetch;
  baseDelayMs?: number;
}

/** OpenAI-compatible /embeddings with the NIM extras (input_type, truncate). Vectors are L2-normalised. */
export class OpenAICompatEmbedder implements Embedder {
  readonly name: string;
  readonly dimension: number;

  constructor(private o: OpenAICompatEmbedderOptions) {
    this.dimension = o.dimension;
    this.name = `${o.label}:${o.model}:${o.dimension}`;
  }

  embedQueries(texts: string[]) {
    return this.run(texts, "query");
  }

  embedDocuments(items: { title?: string; text: string }[]) {
    return this.run(items.map((i) => (i.title ? `${i.title}\n${i.text}` : i.text)), "passage");
  }

  private async run(texts: string[], inputType: "query" | "passage"): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    const url = `${this.o.baseUrl.replace(/\/+$/, "")}/embeddings`;
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH);
      const res = await postJson(
        this.o.fetch ?? fetch, url, "",
        { model: this.o.model, input, input_type: inputType, encoding_format: "float", truncate: "END" },
        { baseDelayMs: this.o.baseDelayMs, headers: { authorization: `Bearer ${this.o.apiKey}` } },
      );
      const json = await readJson<{ data?: { index?: number; embedding: number[] }[] }>(res);
      if (!json.data || json.data.length !== input.length) throw new Error("unexpected embedding response");
      const rows = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const r of rows) {
        if (r.embedding.length !== this.dimension) throw new Error(`expected ${this.dimension} dimensions, got ${r.embedding.length}`);
        out.push(normalise(r.embedding));
      }
    }
    return out;
  }
}
