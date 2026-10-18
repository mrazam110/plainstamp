import { postJson, readJson, type Fetch } from "../http";
import { normalise, type Embedder } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const BATCH = 100;

export interface GeminiEmbedderOptions {
  apiKey: string;
  /** `gemini-embedding-2` (task goes into the text) or `gemini-embedding-001` (taskType field). */
  model: string;
  /** 128-3072; the index must be built with the same value. */
  dimension: number;
  fetch?: Fetch;
  baseDelayMs?: number;
}

export class GeminiEmbedder implements Embedder {
  readonly name: string;
  readonly dimension: number;
  private v2: boolean;

  constructor(private o: GeminiEmbedderOptions) {
    this.v2 = o.model === "gemini-embedding-2";
    this.dimension = o.dimension;
    this.name = `gemini:${o.model}:${o.dimension}`;
  }

  embedQueries(texts: string[]) {
    return this.run(texts.map((t) => (this.v2 ? `task: search result | query: ${t}` : t)), "RETRIEVAL_QUERY");
  }

  embedDocuments(items: { title?: string; text: string }[]) {
    return this.run(
      items.map((i) => (this.v2 ? `title: ${i.title ?? "none"} | text: ${i.text}` : i.text)),
      "RETRIEVAL_DOCUMENT",
    );
  }

  private async run(texts: string[], taskType: string): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const requests = texts.slice(i, i + BATCH).map((text) => ({
        model: `models/${this.o.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.o.dimension,
        ...(this.v2 ? {} : { taskType }),
      }));
      const res = await postJson(
        this.o.fetch ?? fetch, `${BASE}/models/${this.o.model}:batchEmbedContents`, this.o.apiKey,
        { requests }, { baseDelayMs: this.o.baseDelayMs },
      );
      const json = await readJson<{ embeddings?: { values: number[] }[] }>(res);
      if (!json.embeddings || json.embeddings.length !== requests.length) throw new Error("unexpected embedding response");
      for (const e of json.embeddings) {
        if (e.values.length !== this.o.dimension) throw new Error(`expected ${this.o.dimension} dimensions, got ${e.values.length}`);
        out.push(normalise(e.values)); // required for -001 below 3072; harmless otherwise
      }
    }
    return out;
  }
}
