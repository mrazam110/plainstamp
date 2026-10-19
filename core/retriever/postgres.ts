import type { Sql } from "postgres";
import { fuse, KEYWORD_WEIGHT, type RankedList } from "./fuse";
import type { Chunk, Hit, Retriever, SearchRequest } from "./types";

const COLUMNS = `c.id, d.id AS doc_id, d.title, c.heading_path, d.region_id, d.topic_key, d.leika_key,
  d.source_url, to_char(d.crawled_at, 'YYYY-MM-DD') AS crawled_at, c.text`;

type Row = {
  id: string; doc_id: string; title: string; heading_path: string; region_id: string; topic_key: string;
  leika_key: string | null; source_url: string; crawled_at: string; text: string;
};

const toChunk = (r: Row): Chunk => ({
  id: r.id, docId: r.doc_id, title: r.title, heading: r.heading_path, regionId: r.region_id,
  topicKey: r.topic_key, leikaKey: r.leika_key, url: r.source_url, crawledAt: r.crawled_at, text: r.text,
});

/** Keep letters and digits only, join with OR; Postgres drops German stop words and stems both sides. */
export function orQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].join(" | ");
}

/**
 * Postgres array literal for a text[] parameter, used with a ::text[] cast. The Workers setup turns off the
 * driver's type lookup (one round trip less), and without it the driver has no array serializer and sends
 * a JS array as plain text ("malformed array literal"). A string plus a cast works either way.
 */
export function textArray(values: string[]): string {
  const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `{${values.map(quote).join(",")}}`;
}

export class PostgresRetriever implements Retriever {
  /** `sql` should connect with a read-only role (the Worker never writes). */
  constructor(private sql: Sql) {}

  async search(req: SearchRequest): Promise<Hit[]> {
    if (req.regionIds.length === 0) return [];
    const { sql } = this;
    const pool = Math.max(50, req.k * 5);

    let topics: string[] | null = req.topicKeys?.length ? req.topicKeys : null;
    if (topics) {
      const hit = await sql`SELECT 1 FROM documents WHERE region_id = ANY(${textArray(req.regionIds)}::text[]) AND topic_key = ANY(${textArray(topics)}::text[]) LIMIT 1`;
      if (hit.length === 0) topics = null; // prefilter matched nothing: do not hide the region
    }
    const topicFilter = topics ? sql`AND d.topic_key = ANY(${textArray(topics)}::text[])` : sql``;

    const lists: RankedList[] = [];
    for (const v of req.vectors) {
      const lit = `[${Array.from(v).join(",")}]`;
      const rows = await sql<Row[]>`
        SELECT ${sql.unsafe(COLUMNS)} FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.region_id = ANY(${textArray(req.regionIds)}::text[]) ${topicFilter}
        ORDER BY c.embedding <=> ${lit}::halfvec LIMIT ${pool}`;
      lists.push({ chunks: rows.map(toChunk), weight: 1 });
    }
    const q = orQuery(req.keywordText);
    if (q) {
      const rows = await sql<Row[]>`
        SELECT ${sql.unsafe(COLUMNS)} FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.region_id = ANY(${textArray(req.regionIds)}::text[]) ${topicFilter}
          AND c.tsv @@ to_tsquery('german', ${q})
        ORDER BY ts_rank_cd(c.tsv, to_tsquery('german', ${q})) DESC LIMIT ${pool}`;
      lists.push({ chunks: rows.map(toChunk), weight: KEYWORD_WEIGHT });
    }
    return fuse(lists, req.k);
  }
}
