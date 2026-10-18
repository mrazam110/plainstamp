import { describe, expect, it } from "vitest";
import type { Retriever } from "./types";

/** Fixture the contract is written against: regions de-be and de-bb, 3 chunks each, 4-d vectors. */
export const FIXTURE = {
  "de-be": [
    { id: "be1", topic: "anmeldung", text: "Wohnung anmelden Bürgeramt Frist zwei Wochen", vec: [1, 0, 0, 0] },
    { id: "be2", topic: "tax-id", text: "Steueridentifikationsnummer Bundeszentralamt", vec: [0, 1, 0, 0] },
    { id: "be3", topic: "kita", text: "Kita Gutschein Jugendamt", vec: [0, 0, 1, 0] },
  ],
  "de-bb": [
    { id: "bb1", topic: "anmeldung", text: "Wohnsitz Anmeldung Meldebehörde Brandenburg", vec: [0.9, 0.1, 0, 0] },
    { id: "bb2", topic: "tax-id", text: "Steuer Identifikationsnummer Finanzamt", vec: [0, 0.9, 0.1, 0] },
    { id: "bb3", topic: "kita", text: "Kindertagesstätte Platz Landkreis", vec: [0, 0, 0.9, 0.1] },
  ],
} as const;

const q = (...v: number[]) => Float32Array.from(v);

export function runRetrieverContract(name: string, make: () => Promise<Retriever>) {
  describe(`Retriever contract: ${name}`, () => {
    it("never returns chunks outside the selected regions", async () => {
      const r = await make();
      const hits = await r.search({ regionIds: ["de-be"], keywordText: "Wohnung", vectors: [q(1, 0, 0, 0)], k: 10 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.chunk.regionId === "de-be")).toBe(true);
    });

    it("returns nothing for a region that is not loaded", async () => {
      const r = await make();
      expect(await r.search({ regionIds: ["de-xx"], keywordText: "Wohnung", vectors: [q(1, 0, 0, 0)], k: 5 })).toEqual([]);
    });

    it("ranks the nearest vector first", async () => {
      const r = await make();
      const hits = await r.search({ regionIds: ["de-be", "de-bb"], keywordText: "", vectors: [q(0, 0, 1, 0)], k: 3 });
      expect(hits[0]?.chunk.id).toBe("be3");
    });

    it("finds a chunk by stemmed keyword", async () => {
      const r = await make();
      const hits = await r.search({ regionIds: ["de-be"], keywordText: "Wohnungen", vectors: [], k: 3 });
      expect(hits[0]?.chunk.id).toBe("be1");
    });

    it("applies the topic prefilter but does not hide a region when it matches nothing", async () => {
      const r = await make();
      const only = await r.search({ regionIds: ["de-be", "de-bb"], topicKeys: ["tax-id"], keywordText: "", vectors: [q(1, 0, 0, 0)], k: 10 });
      expect(only.every((h) => h.chunk.topicKey === "tax-id")).toBe(true);
      const none = await r.search({ regionIds: ["de-be"], topicKeys: ["nonexistent"], keywordText: "", vectors: [q(1, 0, 0, 0)], k: 10 });
      expect(none.length).toBeGreaterThan(0);
    });

    it("respects k and orders by score", async () => {
      const r = await make();
      const hits = await r.search({ regionIds: ["de-be", "de-bb"], keywordText: "Wohnung", vectors: [q(1, 0, 0, 0)], k: 2 });
      expect(hits).toHaveLength(2);
      expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    });
  });
}
