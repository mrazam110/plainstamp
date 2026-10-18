import { describe, expect, it } from "vitest";
import { FakeLLM } from "../llm/fake";
import type { LLM } from "../llm/types";
import type { AskResponse, Citation } from "../pipeline/types";
import { effectiveFacts, checkThresholds, judgeFacts, scoreStructure, summarize, selectedRegions, type EvalQuestion, type QuestionScore } from "./score";

const cite = (docId: string, regionId: string): Citation => ({ n: 1, docId, title: "T", heading: "H", url: "u", crawledAt: "d", regionId, regionName: regionId });
const res = (o: Partial<AskResponse> = {}): AskResponse => ({ answer: "a", citations: [], answerable: false, needsState: false, notCovered: [], language: "en", ...o });
const q = (o: Partial<EvalQuestion>): EvalQuestion => ({ id: "x", type: "answerable", language: "en", question: "?", context: { mode: "state", state: "de-be" }, ...o });

describe("scoreStructure", () => {
  it("doc hit, no refusal, no leak", () => {
    const s = scoreStructure(q({ expected_docs: ["berlin-1"] }), res({ answerable: true, citations: [cite("berlin-1", "de-be"), cite("de-f", "de")] }));
    expect(s).toMatchObject({ docHit: true, falseRefusal: false, leaks: [] });
  });
  it("flags a citation from an unselected state as a leak", () => {
    const s = scoreStructure(q({ expected_docs: ["berlin-1"] }), res({ answerable: true, citations: [cite("by-9", "de-by")] }));
    expect(s.leaks).toEqual(["de-by"]);
    expect(s.docHit).toBe(false);
  });
  it("answerable question without citations is a false refusal; unanswerable without is a proper refusal", () => {
    expect(scoreStructure(q({}), res()).falseRefusal).toBe(true);
    expect(scoreStructure(q({ type: "unanswerable" }), res()).properRefusal).toBe(true);
    expect(scoreStructure(q({ type: "unanswerable" }), res({ answerable: true, citations: [cite("d", "de")] })).properRefusal).toBe(false);
  });
  it("needs_state and not_covered checks", () => {
    expect(scoreStructure(q({ type: "needs_state", context: { mode: "germany" } }), res({ needsState: true })).needsStateOk).toBe(true);
    const nc = q({ type: "not_covered", not_covered: ["de-hh"] });
    expect(scoreStructure(nc, res({ notCovered: [{ id: "de-hh", name: "Hamburg" }] })).notCoveredOk).toBe(true);
    expect(scoreStructure(nc, res()).notCoveredOk).toBe(false);
  });
  it("selected regions follow the context mode", () => {
    expect(selectedRegions({ mode: "move", fromState: "de-bb", toState: "de-be" })).toEqual(["de", "de-bb", "de-be"]);
    expect(selectedRegions({ mode: "germany" })).toEqual(["de"]);
  });
});

describe("effectiveFacts", () => {
  it("falls back to behaviour facts for refusal and ask-for-state questions only", () => {
    expect(effectiveFacts(q({ type: "unanswerable" }))).toHaveLength(2);
    expect(effectiveFacts(q({ type: "needs_state" }))[0]).toMatch(/which state/);
    expect(effectiveFacts(q({ expected_facts: ["f"] }))).toEqual(["f"]);
    expect(effectiveFacts(q({}))).toEqual([]);
  });
});

describe("judgeFacts", () => {
  it("returns the judge's booleans", async () => {
    const llm = new FakeLLM(JSON.stringify({ results: [true, false] }));
    expect(await judgeFacts(llm, "answer", ["f1", "f2"])).toEqual([true, false]);
  });
  it("counts an unreadable or wrong-length reply as not found", async () => {
    expect(await judgeFacts(new FakeLLM("nope"), "a", ["f1", "f2"])).toEqual([false, false]);
    expect(await judgeFacts(new FakeLLM(JSON.stringify({ results: [true] })), "a", ["f1", "f2"])).toEqual([false, false]);
  });
  it("skips the call when there are no facts", async () => {
    const llm: LLM = { generate: async () => { throw new Error("must not be called"); }, stream: () => { throw new Error("x"); } };
    expect(await judgeFacts(llm, "a", [])).toEqual([]);
  });
});

describe("summarize and thresholds", () => {
  const s = (o: Partial<QuestionScore>): QuestionScore => ({ id: "x", type: "answerable", docHit: null, factsFound: null, factsTotal: 0, falseRefusal: null, properRefusal: null, needsStateOk: null, notCoveredOk: null, leaks: [], ...o });
  it("aggregates rates and ignores metrics without questions", () => {
    const sum = summarize([
      s({ docHit: true, factsFound: 2, factsTotal: 2, falseRefusal: false }),
      s({ docHit: false, factsFound: 0, factsTotal: 2, falseRefusal: true, leaks: ["de-by"] }),
      s({ type: "unanswerable", properRefusal: true }),
    ]);
    expect(sum).toMatchObject({ n: 3, docHitRate: 0.5, factRecall: 0.5, falseRefusalRate: 0.5, properRefusalRate: 1, needsStateRate: null, leaks: 1 });
  });
  it("reports failed checks and treats leaks as hard", () => {
    const t = { docHitRate: 0.8, factRecall: 0.7, maxFalseRefusalRate: 0.1, properRefusalRate: 0.8, needsStateRate: 0.9, notCoveredRate: 0.9, maxLeaks: 0 };
    const sum = summarize([s({ docHit: false, falseRefusal: true, leaks: ["de-by"] })]);
    expect(checkThresholds(sum, t)).toEqual(expect.arrayContaining([expect.stringContaining("docHitRate"), expect.stringContaining("falseRefusalRate"), expect.stringContaining("leaks 1")]));
    expect(checkThresholds(summarize([]), t)).toEqual([]);
  });
});
