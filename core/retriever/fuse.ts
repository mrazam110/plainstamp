import type { Chunk, Hit } from "./types";

export const RRF_K = 60;
/** Keyword list weight in the fusion; tuned on the Berlin smoke set (0.25-1.0 all within one question). */
export const KEYWORD_WEIGHT = 0.5;

export interface RankedList {
  chunks: Chunk[];
  weight: number;
}

/** Weighted reciprocal rank fusion over ranked lists; shared by every backend so scores are comparable. */
export function fuse(lists: RankedList[], k: number): Hit[] {
  const acc = new Map<string, Hit>();
  for (const { chunks, weight } of lists) {
    chunks.forEach((chunk, r) => {
      const cur = acc.get(chunk.id) ?? { chunk, score: 0 };
      cur.score += weight / (RRF_K + r + 1);
      acc.set(chunk.id, cur);
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
