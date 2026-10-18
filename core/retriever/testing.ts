import type { Embedder } from "../embeddings/types";
import { normalise } from "../embeddings/types";
import type { LoadedBundle } from "./bundle";
import { tokenize, type KeywordIndex } from "./keyword";
import type { Chunk } from "./types";

export function buildKeywordIndex(texts: string[]): KeywordIndex {
  const postings: KeywordIndex["postings"] = {};
  const lengths: number[] = [];
  texts.forEach((t, i) => {
    const toks = tokenize(t);
    lengths.push(toks.length);
    const tf = new Map<string, number>();
    toks.forEach((x) => tf.set(x, (tf.get(x) ?? 0) + 1));
    tf.forEach((c, term) => (postings[term] ??= []).push([i, c]));
  });
  return { n: texts.length, avgdl: lengths.reduce((a, b) => a + b, 0) / (texts.length || 1), lengths, postings, stems: {} };
}

/** Deterministic bag-of-words hashing embedder for tests: shared words give similar vectors. */
export class FakeEmbedder implements Embedder {
  readonly name = "fake:32";
  readonly dimension = 32;
  private one(text: string) {
    const v = new Array<number>(32).fill(0);
    for (const w of tokenize(text)) {
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % 32]! += 1;
    }
    return normalise(v);
  }
  async embedQueries(texts: string[]) { return texts.map((t) => this.one(t)); }
  async embedDocuments(items: { title?: string; text: string }[]) { return items.map((i) => this.one(i.text)); }
}

export async function makeBundle(regionId: string, chunks: Chunk[], embedder: Embedder): Promise<LoadedBundle> {
  const vecs = await embedder.embedDocuments(chunks.map((c) => ({ title: c.title, text: c.text })));
  const vectors = new Float32Array(chunks.length * embedder.dimension);
  vecs.forEach((v, i) => vectors.set(v, i * embedder.dimension));
  return {
    manifest: { version: "t", region_id: regionId, embedding_model: embedder.name, dimension: embedder.dimension, chunk_count: chunks.length },
    chunks, vectors, keyword: buildKeywordIndex(chunks.map((c) => c.text)),
  };
}
