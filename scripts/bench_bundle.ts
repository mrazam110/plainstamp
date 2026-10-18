/* Local proxy for the ADR 0004 measurement: time search on the largest Berlin bundle (tiled up if TARGET exceeds it).
 * Node numbers are a lower bound; the spike measured a Worker at 3-4x laptop CPU. Real Worker run still needed. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BundleRetriever, loadBundle, type LoadedBundle } from "../core/retriever/bundle";
import { fsSource } from "../core/retriever/node";

const TARGET = Number(process.argv[2] ?? 14000);
const root = join(import.meta.dirname, "..", "data", "bundles");
const dir = readdirSync(root)
  .filter((d) => d.startsWith("bundle-de-be-"))
  .sort((a, b) => JSON.parse(readFileSync(join(root, b, "manifest.json"), "utf8")).chunk_count - JSON.parse(readFileSync(join(root, a, "manifest.json"), "utf8")).chunk_count)[0]!;
const base = await loadBundle(fsSource(root), dir);
const n0 = base.chunks.length;
const reps = Math.max(1, Math.ceil(TARGET / n0)); // 1 = use the bundle as is
const d = base.manifest.dimension;
const n = n0 * reps;

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
const vectors = new Float32Array(n * d);
const chunks = [];
const lengths: number[] = [];
const postings: LoadedBundle["keyword"]["postings"] = {};
for (let r = 0; r < reps; r++) {
  for (let i = 0; i < n0; i++) {
    const idx = r * n0 + i;
    let norm = 0;
    for (let j = 0; j < d; j++) { const v = base.vectors[i * d + j]! + (r ? rnd() * 0.05 : 0); vectors[idx * d + j] = v; norm += v * v; }
    norm = Math.sqrt(norm);
    for (let j = 0; j < d; j++) vectors[idx * d + j]! /= norm;
    chunks.push({ ...base.chunks[i]!, id: `${base.chunks[i]!.id}-${r}` });
    lengths.push(base.keyword.lengths[i]!);
  }
}
for (const [term, plist] of Object.entries(base.keyword.postings)) {
  postings[term] = [];
  for (let r = 0; r < reps; r++) for (const [doc, tf] of plist) postings[term]!.push([r * n0 + doc, tf]);
}
const big: LoadedBundle = {
  manifest: { ...base.manifest, chunk_count: n }, chunks, vectors,
  keyword: { ...base.keyword, n, lengths, postings },
};
const retriever = new BundleRetriever([big]);
const queries = ["Wohnung anmelden Frist", "Führerschein Ausland umschreiben", "Blaue Karte Gehalt", "Rundfunkbeitrag befreien", "heiraten Ausland", "Geburtsurkunde beantragen"];

async function time(label: string, topics?: string[]) {
  const ms: number[] = [];
  for (let rep = 0; rep < 30; rep++) {
    for (let qi = 0; qi < queries.length; qi++) {
      const v = base.vectors.slice(((qi * 7) % n0) * d, ((qi * 7) % n0) * d + d);
      const t0 = performance.now();
      await retriever.search({ regionIds: ["de-be"], topicKeys: topics, keywordText: queries[qi]!, vectors: [v], k: 8 });
      ms.push(performance.now() - t0);
    }
  }
  const warm = ms.slice(6).sort((a, b) => a - b);
  const p = (q: number) => warm[Math.floor(q * (warm.length - 1))]!.toFixed(1);
  console.log(`${label.padEnd(34)} median ${p(0.5)} ms  p95 ${p(0.95)} ms`);
}
console.log(`chunks ${n}, dim ${d}, vectors ${(vectors.byteLength / 1e6).toFixed(1)} MB, keyword.json ~${(JSON.stringify(big.keyword).length / 1e6).toFixed(1)} MB`);
await time("no prefilter (1 vector + keyword)");
await time("topic prefilter (1 topic)", ["anmeldung"]);
await time("topic prefilter (2 big topics)", ["residence-permit", "car-registration"]);

// cold start: parsing what a fresh isolate must load (vectors.bin is a typed array view, ~free)
const kwText = JSON.stringify(big.keyword);
const chunkText = chunks.map((c) => JSON.stringify({ id: c.id, doc_id: c.docId, title: c.title, heading: c.heading, region_id: c.regionId, topic_key: c.topicKey, leika_key: c.leikaKey, url: c.url, crawled_at: c.crawledAt, text: c.text })).join("\n");
let t0 = performance.now(); JSON.parse(kwText); const kwMs = performance.now() - t0;
t0 = performance.now(); chunkText.split("\n").forEach((l) => JSON.parse(l)); const chMs = performance.now() - t0;
console.log(`cold parse: keyword.json ${(kwText.length / 1e6).toFixed(1)} MB ${kwMs.toFixed(0)} ms, chunks.jsonl ${(chunkText.length / 1e6).toFixed(1)} MB ${chMs.toFixed(0)} ms`);
