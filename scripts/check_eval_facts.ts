/* Cross-checks every expected fact in eval/de/*.yaml against the text of its expected pages with the model
 * as judge. It flags facts the page text does not clearly support. This is a second opinion for the human
 * check, not a replacement. Usage: npx tsx --env-file=.env scripts/check_eval_facts.ts [--rpm 12]
 * Writes data/eval/fact-check.json (and prints the flagged facts). */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { judgeFacts, type EvalQuestion } from "../core/eval/score";
import { paced } from "../core/eval/paced";
import { createLLM } from "../core/providers";

const root = join(import.meta.dirname, "..");
const rpm = Number(process.argv[process.argv.indexOf("--rpm") + 1] || 12);
const llm = paced(createLLM(process.env as Record<string, string | undefined>), rpm);

const docText = new Map<string, string[]>();
for (const src of ["federal", "berlin-full", "brandenburg", "bayern"]) {
  for (const line of (await readFile(join(root, "data", "chunks", `${src}.jsonl`), "utf8")).split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as { doc_id: string; text: string };
    docText.set(r.doc_id, [...(docText.get(r.doc_id) ?? []), r.text]);
  }
}

const questions: EvalQuestion[] = [];
for (const f of (await readdir(join(root, "eval", "de"))).filter((x) => x.endsWith(".yaml"))) {
  questions.push(...((parse(await readFile(join(root, "eval", "de", f), "utf8")) as EvalQuestion[]) ?? []));
}

const flagged: { id: string; fact: string }[] = [];
let checked = 0;
for (const q of questions) {
  if (q.type === "not_covered") continue; // behaviour facts ("says X is not covered"): no page can support them
  if (!q.expected_docs?.length || !q.expected_facts?.length) continue;
  const text = q.expected_docs.flatMap((d) => docText.get(d) ?? []).join("\n---\n").slice(0, 30000);
  if (!text) { q.expected_facts.forEach((fact) => flagged.push({ id: q.id, fact: `NO SOURCE TEXT: ${fact}` })); continue; }
  const ok = await judgeFacts(llm, text, q.expected_facts);
  q.expected_facts.forEach((fact, i) => { checked++; if (!ok[i]) flagged.push({ id: q.id, fact }); });
}
await mkdir(join(root, "data", "eval"), { recursive: true });
await writeFile(join(root, "data", "eval", "fact-check.json"), JSON.stringify({ checked, flagged }, null, 1));
console.log(`checked ${checked} facts, flagged ${flagged.length}`);
for (const f of flagged) console.log(`${f.id}: ${f.fact.slice(0, 140)}`);
