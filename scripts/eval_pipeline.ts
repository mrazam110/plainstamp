/* Full-pipeline eval: real rewrite, retrieval, cited answer and an LLM judge for expected facts.
 * Needs GEMINI_API_KEY, DATABASE_URL, and a database whose chunks were embedded with the SAME embedder
 * as EMBEDDING_PROVIDER/EMBEDDING_MODEL/EMBEDDING_DIMENSION (the local MiniLM index will not match Gemini queries).
 * Usage: npx tsx scripts/eval_pipeline.ts [--limit N] [--file moves] [--no-judge]
 * Writes data/eval/pipeline-<timestamp>.json (answers stay out of git) and exits 1 below eval/thresholds.json. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { parse } from "yaml";
import { checkThresholds, effectiveFacts, judgeFacts, scoreStructure, summarize, type EvalQuestion, type QuestionScore } from "../core/eval/score";
import { ask } from "../core/pipeline/ask";
import { loadConfig } from "../core/pipeline/config-fs";
import { createEmbedder, createLLM } from "../core/providers";
import { PostgresRetriever } from "../core/retriever/postgres";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const limit = Number(flag("limit") ?? Infinity);
const only = flag("file");
const judge = !args.includes("--no-judge");

const env = process.env as Record<string, string | undefined>;
if (!env.GEMINI_API_KEY || !env.DATABASE_URL) {
  console.error("GEMINI_API_KEY and DATABASE_URL are required (see .env.example).");
  process.exit(2);
}
const llm = createLLM(env);
const embedder = createEmbedder(env);
const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
const deps = { llm, embedder, retriever: new PostgresRetriever(sql), config: await loadConfig(root) };

const files = (await readdir(join(root, "eval", "de"))).filter((f) => f.endsWith(".yaml") && (!only || f === `${only}.yaml`));
const questions: EvalQuestion[] = [];
for (const f of files) questions.push(...((parse(await readFile(join(root, "eval", "de", f), "utf8")) as EvalQuestion[]) ?? []));

const scores: QuestionScore[] = [];
const detail: unknown[] = [];
for (const q of questions.slice(0, limit)) {
  try {
    const res = await ask({ question: q.question, context: q.context }, deps);
    const base = scoreStructure(q, res);
    const facts = effectiveFacts(q);
    const found = judge && facts.length ? (await judgeFacts(llm, res.answer, facts)).filter(Boolean).length : null;
    scores.push({ ...base, factsFound: found });
    detail.push({ id: q.id, answer: res.answer, cited: res.citations.map((c) => c.docId), score: scores.at(-1) });
  } catch (e) {
    console.error(`${q.id}: ${(e as Error).message}`);
    scores.push({ id: q.id, type: q.type, docHit: q.expected_docs?.length ? false : null, factsFound: 0, factsTotal: effectiveFacts(q).length, falseRefusal: null, properRefusal: null, needsStateOk: null, notCoveredOk: null, leaks: [] });
  }
}
await sql.end();

const byType = new Map<string, QuestionScore[]>();
for (const s of scores) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);
const overall = summarize(scores);
console.log("overall", overall);
for (const [t, ss] of byType) console.log(t, summarize(ss));
await mkdir(join(root, "data", "eval"), { recursive: true });
await writeFile(join(root, "data", "eval", `pipeline-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ overall, detail }, null, 1));
const thresholds = JSON.parse(await readFile(join(root, "eval", "thresholds.json"), "utf8"));
const fails = checkThresholds(overall, thresholds);
console.log(fails.length ? `FAIL: ${fails.join("; ")}` : "PASS");
process.exit(fails.length ? 1 : 0);
