import type { LLM } from "../llm/types";
import type { AskContext, AskResponse } from "../pipeline/types";

export interface EvalQuestion {
  id: string;
  type: "answerable" | "move" | "not_covered" | "needs_state" | "unanswerable";
  language: string;
  question: string;
  context: AskContext;
  topic_key?: string;
  expected_facts?: string[];
  expected_docs?: string[];
  not_covered?: string[];
}

export interface QuestionScore {
  id: string;
  type: EvalQuestion["type"];
  /** An expected doc was cited (null when the question has no expected docs). */
  docHit: boolean | null;
  factsFound: number | null;
  factsTotal: number;
  /** Answerable question but the response says it has no supporting source. */
  falseRefusal: boolean | null;
  /** Unanswerable question and the response cited nothing. */
  properRefusal: boolean | null;
  needsStateOk: boolean | null;
  notCoveredOk: boolean | null;
  /** Cited regions outside federal + the selected states. Must stay empty. */
  leaks: string[];
}

/** Behaviour facts used when a question lists none (refusal and ask-for-state questions). */
export function effectiveFacts(q: EvalQuestion): string[] {
  if (q.expected_facts?.length) return q.expected_facts;
  if (q.type === "unanswerable") return ["Says the official pages do not answer this question", "Points to the responsible office"];
  if (q.type === "needs_state") return ["Asks which state applies", "Says the procedure differs by state"];
  return [];
}

export function selectedRegions(ctx: AskContext): string[] {
  const states = ctx.mode === "germany" ? [] : ctx.mode === "state" ? [ctx.state] : [ctx.fromState, ctx.toState];
  return ["de", ...states.filter((s): s is string => !!s)];
}

/** Everything that can be scored without a judge model. */
export function scoreStructure(q: EvalQuestion, res: AskResponse): Omit<QuestionScore, "factsFound"> {
  const allowed = new Set(selectedRegions(q.context));
  const cited = new Set(res.citations.map((c) => c.docId));
  const hasDocs = !!q.expected_docs?.length;
  return {
    id: q.id,
    type: q.type,
    docHit: hasDocs ? q.expected_docs!.some((d) => cited.has(d)) : null,
    factsTotal: effectiveFacts(q).length,
    falseRefusal: q.type === "answerable" || q.type === "move" ? !res.answerable : null,
    properRefusal: q.type === "unanswerable" ? !res.answerable : null,
    needsStateOk: q.type === "needs_state" ? res.needsState : null,
    notCoveredOk: q.type === "not_covered" ? (q.not_covered ?? []).every((id) => res.notCovered.some((n) => n.id === id)) : null,
    leaks: [...new Set(res.citations.map((c) => c.regionId))].filter((r) => !allowed.has(r)),
  };
}

const JUDGE_SCHEMA = { type: "OBJECT", properties: { results: { type: "ARRAY", items: { type: "BOOLEAN" } } }, required: ["results"] };

/** LLM judge: which expected facts does the answer clearly state? Answer language may differ from the fact. */
export async function judgeFacts(llm: LLM, answer: string, facts: string[]): Promise<boolean[]> {
  if (!facts.length) return [];
  const r = await llm.generate({
    system: [
      "You grade an answer against expected facts. For each numbered fact return true only if the answer clearly",
      "states it (any language, paraphrase is fine, exact wording is not needed). Return false if it is missing,",
      "contradicted or only implied. Return JSON {results: boolean[]} in the same order as the facts.",
    ].join(" "),
    messages: [{ role: "user", content: `ANSWER:\n${answer}\n\nFACTS:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}` }],
    temperature: 0,
    maxOutputTokens: 200,
    json: { schema: JUDGE_SCHEMA },
  });
  try {
    const out = (JSON.parse(r.text) as { results?: unknown }).results;
    if (Array.isArray(out) && out.length === facts.length) return out.map((x) => x === true);
  } catch { /* fall through */ }
  return facts.map(() => false); // an unreadable judge reply counts against the answer, never for it
}

export interface Summary {
  n: number;
  docHitRate: number | null;
  factRecall: number | null;
  falseRefusalRate: number | null;
  properRefusalRate: number | null;
  needsStateRate: number | null;
  notCoveredRate: number | null;
  leaks: number;
}

const rate = (xs: (boolean | null)[]): number | null => {
  const v = xs.filter((x): x is boolean => x !== null);
  return v.length ? v.filter(Boolean).length / v.length : null;
};

export function summarize(scores: QuestionScore[]): Summary {
  const withFacts = scores.filter((s) => s.factsTotal > 0 && s.factsFound !== null);
  const totalFacts = withFacts.reduce((a, s) => a + s.factsTotal, 0);
  return {
    n: scores.length,
    docHitRate: rate(scores.map((s) => s.docHit)),
    factRecall: totalFacts ? withFacts.reduce((a, s) => a + (s.factsFound ?? 0), 0) / totalFacts : null,
    falseRefusalRate: rate(scores.map((s) => s.falseRefusal)),
    properRefusalRate: rate(scores.map((s) => s.properRefusal)),
    needsStateRate: rate(scores.map((s) => s.needsStateOk)),
    notCoveredRate: rate(scores.map((s) => s.notCoveredOk)),
    leaks: scores.reduce((a, s) => a + s.leaks.length, 0),
  };
}

export interface Thresholds {
  docHitRate: number;
  factRecall: number;
  maxFalseRefusalRate: number;
  properRefusalRate: number;
  needsStateRate: number;
  notCoveredRate: number;
  maxLeaks: number;
}

/** Returns the list of failed checks (empty means pass). A metric with no questions is skipped. */
export function checkThresholds(s: Summary, t: Thresholds): string[] {
  const fails: string[] = [];
  const min = (name: string, v: number | null, limit: number) => { if (v !== null && v < limit) fails.push(`${name} ${v.toFixed(2)} < ${limit}`); };
  min("docHitRate", s.docHitRate, t.docHitRate);
  min("factRecall", s.factRecall, t.factRecall);
  min("properRefusalRate", s.properRefusalRate, t.properRefusalRate);
  min("needsStateRate", s.needsStateRate, t.needsStateRate);
  min("notCoveredRate", s.notCoveredRate, t.notCoveredRate);
  if (s.falseRefusalRate !== null && s.falseRefusalRate > t.maxFalseRefusalRate) fails.push(`falseRefusalRate ${s.falseRefusalRate.toFixed(2)} > ${t.maxFalseRefusalRate}`);
  if (s.leaks > t.maxLeaks) fails.push(`leaks ${s.leaks} > ${t.maxLeaks}`);
  return fails;
}
