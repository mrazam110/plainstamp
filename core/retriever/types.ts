export interface Chunk {
  id: string;
  docId: string;
  title: string;
  heading: string;
  regionId: string;
  topicKey: string;
  leikaKey: string | null;
  url: string;
  crawledAt: string;
  text: string;
}

export interface SearchRequest {
  /** Hard filter: only chunks of these regions are ever returned (ids from regions/de.yaml). */
  regionIds: string[];
  /** Optional prefilter; ignored when it matches nothing in the selected regions. */
  topicKeys?: string[];
  /** German keyword query (the LLM rewrite). */
  keywordText: string;
  /** Query embeddings (original question and rewrites), L2-normalised, same model as the index. */
  vectors: Float32Array[];
  k: number;
}

export interface Hit {
  chunk: Chunk;
  score: number;
}

/** The pipeline only ever sees this; backends (bundle, postgres, vectorize) hide behind it. */
export interface Retriever {
  search(req: SearchRequest): Promise<Hit[]>;
}
