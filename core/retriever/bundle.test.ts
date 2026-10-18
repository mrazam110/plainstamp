import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BundleRetriever } from "./bundle";
import { runRetrieverContract, FIXTURE } from "./contract";
import { tokenize, type KeywordIndex } from "./keyword";
import { fsSource } from "./node";

function buildIndex(texts: string[]): KeywordIndex {
  const postings: KeywordIndex["postings"] = {};
  const lengths: number[] = [];
  texts.forEach((t, i) => {
    const toks = tokenize(t);
    lengths.push(toks.length);
    const tf = new Map<string, number>();
    toks.forEach((x) => tf.set(x, (tf.get(x) ?? 0) + 1));
    tf.forEach((c, term) => (postings[term] ??= []).push([i, c]));
  });
  return { n: texts.length, avgdl: lengths.reduce((a, b) => a + b, 0) / texts.length, lengths, postings, stems: {} };
}

async function writeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "plainstamp-bundle-"));
  for (const [region, items] of Object.entries(FIXTURE)) {
    const dir = join(root, `bundle-${region}-t`);
    await mkdir(dir);
    const chunks = items.map((c) => ({
      id: c.id, doc_id: `d-${c.id}`, title: "T", heading: "H", region_id: region, topic_key: c.topic,
      leika_key: null, url: `https://x/${c.id}`, crawled_at: "2026-10-18", text: c.text,
    }));
    await writeFile(join(dir, "chunks.jsonl"), chunks.map((c) => JSON.stringify(c)).join("\n") + "\n");
    await writeFile(join(dir, "vectors.bin"), Buffer.from(Float32Array.from(items.flatMap((c) => c.vec)).buffer));
    await writeFile(join(dir, "keyword.json"), JSON.stringify(buildIndex(items.map((c) => c.text))));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      version: "t", region_id: region, embedding_model: "test", dimension: 4, chunk_count: items.length,
    }));
  }
  return root;
}

runRetrieverContract("bundle", async () => {
  const root = await writeFixture();
  return BundleRetriever.fromDirs(fsSource(root), ["bundle-de-be-t", "bundle-de-bb-t"]);
});

describe("bundle loading", () => {
  it("rejects a vectors.bin that does not match the chunks", async () => {
    const root = await writeFixture();
    await writeFile(join(root, "bundle-de-be-t", "vectors.bin"), Buffer.alloc(8));
    await expect(BundleRetriever.fromDirs(fsSource(root), ["bundle-de-be-t"])).rejects.toThrow(/does not match/);
  });
});
