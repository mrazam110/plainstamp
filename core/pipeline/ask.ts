import type { Embedder } from "../embeddings/types";
import type { GenerateRequest, LLM, Message } from "../llm/types";
import type { Hit, Retriever } from "../retriever/types";
import { flattenRegions, isCovered } from "./config";
import { answerSystem, REWRITE_SCHEMA, rewriteSystem, type SourceBlock } from "./prompts";
import { AskError, type AskRequest, type AskResponse, type Citation, type Config } from "./types";

export const K_PER_REGION = 6;
const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_TURNS = 6;
const MAX_SITUATION_CHARS = 300;
const LANGUAGE_CODE = /^[a-z]{2,3}$/;
const FEDERAL = "de";

export interface Deps {
  llm: LLM;
  embedder: Embedder;
  retriever: Retriever;
  config: Config;
}

interface Rewrite {
  language: string;
  queries: string[];
  topicKeys: string[];
}

/** One short line without control characters or angle brackets, so it cannot add rules or fake source blocks to the prompt. */
export function cleanSituation(s: string | undefined): string | undefined {
  const t = s?.replace(/[\p{Cc}<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SITUATION_CHARS);
  return t || undefined;
}

function parseRewrite(text: string, question: string, validTopics: Set<string>): Rewrite {
  try {
    const j = JSON.parse(text) as { language?: unknown; queries?: unknown; topic_keys?: unknown };
    const queries = Array.isArray(j.queries) ? j.queries.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, 3) : [];
    const topicKeys = Array.isArray(j.topic_keys) ? j.topic_keys.filter((k): k is string => typeof k === "string" && validTopics.has(k)).slice(0, 3) : [];
    return {
      language: typeof j.language === "string" && LANGUAGE_CODE.test(j.language) ? j.language : "en",
      queries: queries.length ? queries : [question],
      topicKeys,
    };
  } catch {
    return { language: "en", queries: [question], topicKeys: [] }; // rewrite failed: search with the question itself
  }
}

/** Regions to search: federal first, then selected states in the order given. */
function resolveRegions(req: AskRequest, config: Config) {
  const all = flattenRegions(config.regions);
  const state = (id: string | undefined) => {
    const r = id ? all.get(id) : undefined;
    if (!r || r.level !== "land") throw new AskError("unknown state");
    return r;
  };
  const c = req.context;
  const states = c.mode === "germany" ? [] : c.mode === "state" ? [state(c.state)] : [state(c.fromState), state(c.toState)];
  const covered = states.filter(isCovered);
  return {
    states,
    searched: [all.get(FEDERAL)!, ...covered],
    notCovered: states.filter((s) => !isCovered(s)).map((s) => ({ id: s.id, name: s.name })),
  };
}

export interface Prepared {
  request: GenerateRequest;
  sources: SourceBlock[];
  language: string;
  needsState: boolean;
  notCovered: { id: string; name: string }[];
}

/** Steps 1-4: validate, rewrite, retrieve, build the answer prompt. No answer text yet. */
export async function prepareAsk(req: AskRequest, deps: Deps): Promise<Prepared> {
  const question = req.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS) throw new AskError("question is empty or too long");
  if (req.context.language !== undefined && !LANGUAGE_CODE.test(req.context.language)) throw new AskError("invalid language");
  const situation = cleanSituation(req.context.situation);
  const { config, llm, embedder, retriever } = deps;
  const { states, searched, notCovered } = resolveRegions(req, config);
  const history: Message[] = (req.history ?? []).slice(-MAX_HISTORY_TURNS);

  // 1. German rewrite and topic pick
  let rewrite: Rewrite;
  const valid = new Set(config.topics.map((t) => t.key));
  try {
    const r = await llm.generate({
      system: rewriteSystem(config.topics),
      messages: [...history, { role: "user", content: situation ? `${question}\n(situation: ${situation})` : question }],
      temperature: 0,
      maxOutputTokens: 300,
      json: { schema: REWRITE_SCHEMA },
    });
    rewrite = parseRewrite(r.text, question, valid);
  } catch {
    rewrite = parseRewrite("", question, valid);
  }
  const language = req.context.language ?? rewrite.language;

  // 2. unknown state on a state-specific topic: federal overview, ask which state
  const specific = new Set(config.topics.filter((t) => t.state_specific).map((t) => t.key));
  const needsState = req.context.mode === "germany" && rewrite.topicKeys.some((k) => specific.has(k));

  // 3. hybrid retrieval per region, hard region filter, k per region
  const vectors = await embedder.embedQueries([question, ...rewrite.queries]);
  const keywordText = rewrite.queries.join(" ");
  const perRegion: { regionName: string; hits: Hit[] }[] = [];
  for (const region of searched) {
    const hits = await retriever.search({
      regionIds: [region.id],
      topicKeys: rewrite.topicKeys,
      keywordText,
      vectors,
      k: K_PER_REGION,
    });
    // Hard region filter. With no state chosen on a state-specific topic, a "federal overview" must be about
    // that topic: the retriever drops a topic filter that matches nothing, which would surface unrelated
    // federal pages (a broadcasting-fee page answering "where do I register my flat?"), so enforce it here.
    const onTopic = needsState && rewrite.topicKeys.length ? (h: Hit) => rewrite.topicKeys.includes(h.chunk.topicKey) : () => true;
    perRegion.push({ regionName: region.name, hits: hits.filter((h) => h.chunk.regionId === region.id && onTopic(h)) });
  }

  // 4. numbered sources, federal first
  const sources: SourceBlock[] = [];
  for (const { regionName, hits } of perRegion) {
    for (const h of hits) sources.push({ n: sources.length + 1, regionName, chunk: h.chunk });
  }

  // 5. answer prompt
  const byName = (i: number) => states[i]?.name;
  const request: GenerateRequest = {
    system: answerSystem({
      language,
      selected: searched.map((r) => ({ id: r.id, name: r.name })),
      notCovered,
      mode: req.context.mode,
      fromName: byName(0),
      toName: byName(1),
      askState: needsState,
      situation,
      sources,
    }),
    messages: [...history, { role: "user", content: question }],
    temperature: 0.2,
    maxOutputTokens: 1200,
  };
  return { request, sources, language, needsState, notCovered };
}

/** Step 6: keep only citations that point at real sources. */
export function finishAnswer(text: string, p: Prepared): AskResponse {
  const used = new Set<number>();
  // models sometimes write [8, 12] or [8][12]: normalise to single [n] markers first
  // some models use their own style, e.g. 【7†L1-L2】: turn it into [7]
  const plain = text.replace(/【\s*(\d+)[^】]*】/g, "[$1]");
  const flat = plain.replace(/\[(\d+(?:\s*[,;]\s*\d+)+)\]/g, (_m, list: string) => list.split(/[,;]/).map((n) => `[${n.trim()}]`).join(""));
  const answer = flat.replace(/\[(\d+)\]/g, (m, d: string) => {
    const n = Number(d);
    if (n >= 1 && n <= p.sources.length) {
      used.add(n);
      return m;
    }
    return "";
  }).trim();
  const citations: Citation[] = p.sources
    .filter((s) => used.has(s.n))
    .map((s) => ({
      n: s.n, docId: s.chunk.docId, title: s.chunk.title, heading: s.chunk.heading, url: s.chunk.url,
      crawledAt: s.chunk.crawledAt, regionId: s.chunk.regionId, regionName: s.regionName,
    }));
  return { answer, citations, answerable: citations.length > 0, needsState: p.needsState, notCovered: p.notCovered, language: p.language };
}

export async function ask(req: AskRequest, deps: Deps): Promise<AskResponse> {
  const prepared = await prepareAsk(req, deps);
  const result = await deps.llm.generate(prepared.request);
  return finishAnswer(result.text, prepared);
}

/** Same as ask() but yields text deltas first; the final response (with cleaned citations) comes last. */
export async function* askStream(req: AskRequest, deps: Deps): AsyncGenerator<{ delta: string } | { done: AskResponse } | { meta: Omit<Prepared, "request"> }> {
  const prepared = await prepareAsk(req, deps);
  yield { meta: { sources: prepared.sources, language: prepared.language, needsState: prepared.needsState, notCovered: prepared.notCovered } };
  let text = "";
  for await (const delta of deps.llm.stream(prepared.request)) {
    text += delta;
    yield { delta };
  }
  yield { done: finishAnswer(text, prepared) };
}
