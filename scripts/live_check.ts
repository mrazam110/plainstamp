/* One cheap live call each to the embedder and the model (needs GEMINI_API_KEY; run with --env-file=.env). */
import { createEmbedder, createLLM } from "../core/providers";

const env = process.env as Record<string, string | undefined>;
const emb = createEmbedder(env);
const v = await emb.embedQueries(["Wie melde ich meine Wohnung an?"]);
console.log("embedder", emb.name, "dim", v[0]!.length);
const llm = createLLM(env);
try {
  const r = await llm.generate({ messages: [{ role: "user", content: "Antworte nur mit dem Wort OK." }], maxOutputTokens: 20, temperature: 0 });
  console.log("llm", env.LLM_MODEL ?? "default", "->", JSON.stringify(r.text.trim().slice(0, 20)), r.finishReason);
} catch (e) {
  console.log("llm failed:", (e as Error).message);
}
