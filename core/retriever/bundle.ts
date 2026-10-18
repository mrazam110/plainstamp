import { bm25, type KeywordIndex } from "./keyword";
import { fuse, KEYWORD_WEIGHT, type RankedList } from "./fuse";
import type { Chunk, Hit, Retriever, SearchRequest } from "./types";

/** Where bundle files come from: Node filesystem in tests and tools, Worker static assets in production. */
export interface BundleSource {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

export interface Manifest {
  version: string;
  region_id: string;
  embedding_model: string;
  dimension: number;
  chunk_count: number;
}

export interface LoadedBundle {
  manifest: Manifest;
  chunks: Chunk[];
  vectors: Float32Array; // N x D, L2-normalised
  keyword: KeywordIndex;
}


function parseChunks(jsonl: string): Chunk[] {
  return jsonl
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const r = JSON.parse(line);
      return {
        id: r.id, docId: r.doc_id, title: r.title, heading: r.heading, regionId: r.region_id,
        topicKey: r.topic_key, leikaKey: r.leika_key ?? null, url: r.url,
        crawledAt: r.crawled_at, text: r.text,
      };
    });
}

export async function loadBundle(source: BundleSource, dir: string): Promise<LoadedBundle> {
  const [manifestText, chunksText, keywordText, vecBuf] = await Promise.all([
    source.readText(`${dir}/manifest.json`),
    source.readText(`${dir}/chunks.jsonl`),
    source.readText(`${dir}/keyword.json`),
    source.readBinary(`${dir}/vectors.bin`),
  ]);
  const manifest = JSON.parse(manifestText) as Manifest;
  const chunks = parseChunks(chunksText);
  const vectors = new Float32Array(vecBuf);
  if (vectors.length !== chunks.length * manifest.dimension) {
    throw new Error(`${dir}: vectors.bin does not match ${chunks.length} chunks x ${manifest.dimension}`);
  }
  return { manifest, chunks, vectors, keyword: JSON.parse(keywordText) as KeywordIndex };
}

function rank(scores: Map<number, number>, n: number): number[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([i]) => i);
}

export class BundleRetriever implements Retriever {
  constructor(private bundles: LoadedBundle[]) {}

  static async fromDirs(source: BundleSource, dirs: string[]): Promise<BundleRetriever> {
    return new BundleRetriever(await Promise.all(dirs.map((d) => loadBundle(source, d))));
  }

  async search(req: SearchRequest): Promise<Hit[]> {
    const wanted = new Set(req.regionIds);
    const lists: RankedList[] = [];
    const pool = Math.max(50, req.k * 5);

    for (const b of this.bundles) {
      if (!wanted.has(b.manifest.region_id)) continue; // hard region filter
      const n = b.chunks.length;
      const allowed = new Uint8Array(n);
      const topics = req.topicKeys?.length ? new Set(req.topicKeys) : null;
      let any = 0;
      for (let i = 0; i < n; i++) {
        if (!topics || topics.has(b.chunks[i]!.topicKey)) { allowed[i] = 1; any++; }
      }
      if (any === 0) allowed.fill(1); // topic prefilter matched nothing: do not hide the region

      const d = b.manifest.dimension;
      for (const q of req.vectors) {
        const sc = new Map<number, number>();
        for (let i = 0; i < n; i++) {
          if (!allowed[i]) continue;
          let dot = 0;
          const off = i * d;
          for (let j = 0; j < d; j++) dot += q[j]! * b.vectors[off + j]!;
          sc.set(i, dot);
        }
        lists.push({ chunks: rank(sc, pool).map((i) => b.chunks[i]!), weight: 1 });
      }
      if (req.keywordText.trim()) {
        const kw = bm25(b.keyword, req.keywordText, allowed);
        lists.push({ chunks: rank(kw, pool).map((i) => b.chunks[i]!), weight: KEYWORD_WEIGHT });
      }
    }
    return fuse(lists, req.k);
  }
}
