export interface Embedder {
  /** Model id plus dimension; stored in the bundle manifest so index and queries can be checked to match. */
  readonly name: string;
  readonly dimension: number;
  /** L2-normalised vectors for search queries. */
  embedQueries(texts: string[]): Promise<Float32Array[]>;
  /** L2-normalised vectors for documents (chunks). */
  embedDocuments(items: { title?: string; text: string }[]): Promise<Float32Array[]>;
}

export function normalise(v: number[]): Float32Array {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return Float32Array.from(v, (x) => x / n);
}
