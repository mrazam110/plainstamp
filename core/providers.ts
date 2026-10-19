import { GeminiEmbedder } from "./embeddings/gemini";
import type { Embedder } from "./embeddings/types";
import { OpenAICompatEmbedder } from "./embeddings/openai-compat";
import { GeminiLLM } from "./llm/gemini";
import { OpenAICompatLLM } from "./llm/openai-compat";
import type { LLM } from "./llm/types";

/** Environment variables (Worker bindings or process.env); see .env.example. */
export interface ProviderEnv {
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSION?: string;
  GEMINI_API_KEY?: string;
  /** Trial providers (nvidia) stay off unless this is "1": dev and eval only, see ADR 0006. */
  ALLOW_TRIAL_PROVIDERS?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_BASE_URL?: string;
}

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_EMBED_DIMENSION = 2048; // the only size nvidia/nemotron-3-embed-1b returns

function allowTrial(env: ProviderEnv, name: string) {
  if (env.ALLOW_TRIAL_PROVIDERS !== "1") throw new Error(`${name} is a trial provider for dev and eval only: set ALLOW_TRIAL_PROVIDERS=1 to use it`);
  if (!env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not set");
}

export function createLLM(env: ProviderEnv, fetchFn?: typeof fetch): LLM {
  const provider = env.LLM_PROVIDER ?? "gemini";
  if (provider === "nvidia") {
    allowTrial(env, "nvidia");
    return new OpenAICompatLLM({
      apiKey: env.NVIDIA_API_KEY!, model: env.LLM_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
      baseUrl: env.NVIDIA_BASE_URL ?? NVIDIA_URL, fetch: fetchFn, reasoningPadding: 2000,
    });
  }
  if (provider !== "gemini") throw new Error(`unknown LLM_PROVIDER ${provider}`);
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return new GeminiLLM({ apiKey: env.GEMINI_API_KEY, model: env.LLM_MODEL ?? "gemini-3.5-flash-lite", fetch: fetchFn });
}

export function createEmbedder(env: ProviderEnv, fetchFn?: typeof fetch): Embedder {
  const provider = env.EMBEDDING_PROVIDER ?? "gemini";
  if (provider === "nvidia") {
    allowTrial(env, "nvidia");
    const dim = Number(env.EMBEDDING_DIMENSION ?? NVIDIA_EMBED_DIMENSION);
    if (dim !== NVIDIA_EMBED_DIMENSION) throw new Error(`nvidia embeddings return ${NVIDIA_EMBED_DIMENSION} dimensions only`);
    return new OpenAICompatEmbedder({
      apiKey: env.NVIDIA_API_KEY!, model: env.EMBEDDING_MODEL ?? "nvidia/nemotron-3-embed-1b",
      baseUrl: env.NVIDIA_BASE_URL ?? NVIDIA_URL, dimension: dim, label: "nvidia", fetch: fetchFn,
    });
  }
  if (provider !== "gemini") throw new Error(`unknown EMBEDDING_PROVIDER ${provider}`);
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return new GeminiEmbedder({
    apiKey: env.GEMINI_API_KEY,
    model: env.EMBEDDING_MODEL ?? "gemini-embedding-2",
    dimension: Number(env.EMBEDDING_DIMENSION ?? 768),
    fetch: fetchFn,
  });
}
