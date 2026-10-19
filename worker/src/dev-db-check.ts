/* Dev-only (wrangler.dev-db.toml, never deployed): proves the Postgres retriever works inside the Workers
 * runtime against a real database. POST /check {vector, keywordText, regionIds} returns hit titles and timing. */
import postgres from "postgres";
import { PostgresRetriever } from "../../core/retriever/postgres";

interface Env { READONLY_DATABASE_URL?: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/check" || !env.READONLY_DATABASE_URL) return new Response("not found", { status: 404 });
    const body = (await request.json()) as { vector: number[]; keywordText: string; regionIds: string[] };
    const sql = postgres(env.READONLY_DATABASE_URL, { max: 1, fetch_types: false });
    try {
      const t0 = performance.now();
      const hits = await new PostgresRetriever(sql).search({
        regionIds: body.regionIds, keywordText: body.keywordText, vectors: [Float32Array.from(body.vector)], k: 5,
      });
      const ms = Math.round(performance.now() - t0);
      return Response.json({ ms, hits: hits.map((h) => ({ region: h.chunk.regionId, doc: h.chunk.docId, title: h.chunk.title.slice(0, 50), heading: h.chunk.heading })) });
    } finally {
      await sql.end({ timeout: 1 });
    }
  },
};
