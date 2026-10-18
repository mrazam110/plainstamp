import { GeminiEmbedder } from "./embeddings/gemini";
import type { Embedder } from "./embeddings/types";
import { GeminiLLM } from "./llm/gemini";
import type { LLM } from "./llm/types";

/** Environment variables (Worker bindings or process.env); see .env.example. */
export interface ProviderEnv {
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSION?: string;
  GEMINI_API_KEY?: string;
}

export function createLLM(env: ProviderEnv, fetchFn?: typeof fetch): LLM {
  const provider = env.LLM_PROVIDER ?? "gemini";
  if (provider !== "gemini") throw new Error(`unknown LLM_PROVIDER ${provider}`);
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return new GeminiLLM({ apiKey: env.GEMINI_API_KEY, model: env.LLM_MODEL ?? "gemini-3.5-flash-lite", fetch: fetchFn });
}

export function createEmbedder(env: ProviderEnv, fetchFn?: typeof fetch): Embedder {
  const provider = env.EMBEDDING_PROVIDER ?? "gemini";
  if (provider !== "gemini") throw new Error(`unknown EMBEDDING_PROVIDER ${provider}`);
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return new GeminiEmbedder({
    apiKey: env.GEMINI_API_KEY,
    model: env.EMBEDDING_MODEL ?? "gemini-embedding-2",
    dimension: Number(env.EMBEDDING_DIMENSION ?? 768),
    fetch: fetchFn,
  });
}
