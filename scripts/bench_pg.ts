/* Wall latency of PostgresRetriever on the loaded Berlin portal (local Docker, so no network hop to
 * a hosted database: add that on top for Neon). Queries use stored chunk vectors + real keywords. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { PostgresRetriever } from "../core/retriever/postgres";

const root = join(import.meta.dirname, "..", "data", "bundles");
const dir = readdirSync(root)
  .filter((d) => d.startsWith("bundle-de-be-"))
  .sort((a, b) => JSON.parse(readFileSync(join(root, b, "manifest.json"), "utf8")).chunk_count - JSON.parse(readFileSync(join(root, a, "manifest.json"), "utf8")).chunk_count)[0]!;
const buf = readFileSync(join(root, dir, "vectors.bin"));
const vecs = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const d = 384;
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
const r = new PostgresRetriever(sql);
const queries = ["Wohnung anmelden Frist", "Führerschein Ausland umschreiben", "Blaue Karte Gehalt", "Rundfunkbeitrag befreien", "heiraten Ausland", "Geburtsurkunde beantragen"];
const [{ n }] = await sql`SELECT count(*)::int AS n FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.region_id = 'de-be'`;

async function time(label: string, topics?: string[]) {
  const ms: number[] = [];
  for (let rep = 0; rep < 20; rep++)
    for (let qi = 0; qi < queries.length; qi++) {
      const i = (qi * 977 + rep * 13) % (vecs.length / d);
      const t0 = performance.now();
      await r.search({ regionIds: ["de-be"], topicKeys: topics, keywordText: queries[qi]!, vectors: [vecs.slice(i * d, i * d + d)], k: 8 });
      ms.push(performance.now() - t0);
    }
  const w = ms.slice(6).sort((a, b) => a - b);
  const p = (q: number) => w[Math.floor(q * (w.length - 1))]!.toFixed(1);
  console.log(`${label.padEnd(30)} median ${p(0.5)} ms  p95 ${p(0.95)} ms`);
}
console.log(`de-be chunks in database: ${n}`);
await time("no prefilter");
await time("1 topic", ["anmeldung"]);
await time("2 big topics", ["residence-permit", "car-registration"]);
await sql.end();
