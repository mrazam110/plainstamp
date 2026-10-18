import snowball from "snowball-stemmers";

const stemmer = snowball.newStemmer("german");

const STOP = new Set(
  `der die das den dem des ein eine einen einem einer eines und oder aber auch
in im ins an am auf aus bei mit nach von vom zu zum zur fuer für über ueber unter um als
ist sind war wird werden wurde wurden hat haben sie ihr ihre ihren ihrem es sich nicht
wenn dann dass daß so wie wo was wer kann können muss müssen`.split(/\s+/),
);

const K1 = 1.5;
const B = 0.75;

export interface KeywordIndex {
  n: number;
  avgdl: number;
  lengths: number[];
  postings: Record<string, [number, number][]>;
  /** word -> stem table built at ingestion; the stemmer here is only the fallback. */
  stems: Record<string, string>;
}

export function tokenize(text: string, stems: Record<string, string> = {}): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => stems[w] ?? stemmer.stem(w));
}

/** BM25 scores for chunk indices where `allowed` is set. */
export function bm25(index: KeywordIndex, query: string, allowed: Uint8Array): Map<number, number> {
  const scores = new Map<number, number>();
  const avgdl = index.avgdl || 1;
  for (const term of new Set(tokenize(query, index.stems))) {
    const plist = index.postings[term];
    if (!plist) continue;
    const idf = Math.log(1 + (index.n - plist.length + 0.5) / (plist.length + 0.5));
    for (const [doc, tf] of plist) {
      if (!allowed[doc]) continue;
      const dl = index.lengths[doc] ?? avgdl;
      const s = (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / avgdl));
      scores.set(doc, (scores.get(doc) ?? 0) + s);
    }
  }
  return scores;
}
