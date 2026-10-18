import postgres from "postgres";
import { createEmbedder, createLLM, type ProviderEnv } from "../../core/providers";
import { BundleRetriever, type BundleSource } from "../../core/retriever/bundle";
import { PostgresRetriever } from "../../core/retriever/postgres";
import type { Retriever } from "../../core/retriever/types";
import { isCovered, flattenRegions } from "../../core/pipeline/config";
import type { Deps } from "../../core/pipeline/ask";
import { config } from "./config";

export interface Env extends ProviderEnv {
  ALLOWED_ORIGINS?: string;
  RETRIEVER_BACKEND?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  /** Static assets binding holding bundle folders (bundle backend only). */
  ASSETS?: { fetch(url: string): Promise<Response> };
}

export const allowedOrigins = (env: Env) => (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function assetsSource(assets: NonNullable<Env["ASSETS"]>): BundleSource {
  const get = async (path: string) => {
    const res = await assets.fetch(`https://assets.invalid/${path}`);
    if (!res.ok) throw new Error(`bundle file missing: ${path}`);
    return res;
  };
  return { readText: async (p) => (await get(p)).text(), readBinary: async (p) => (await get(p)).arrayBuffer() };
}

async function createRetriever(env: Env): Promise<Retriever> {
  if ((env.RETRIEVER_BACKEND ?? "postgres") === "bundle") {
    if (!env.ASSETS) throw new Error("ASSETS binding missing");
    const source = assetsSource(env.ASSETS);
    const regions = [...flattenRegions(config.regions).values()].filter(isCovered);
    const dirs = await Promise.all(regions.map(async (r) => (JSON.parse(await source.readText(`active-${r.id}.json`)) as { dir: string }).dir));
    return BundleRetriever.fromDirs(source, dirs);
  }
  const conn = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!conn) throw new Error("no database connection configured");
  return new PostgresRetriever(postgres(conn, { max: 1, fetch_types: false }));
}

let cached: Promise<Deps> | undefined;

/** Built once per isolate; holds no per-request data. */
export function getDeps(env: Env): Promise<Deps> {
  cached ??= (async () => ({
    llm: createLLM(env),
    embedder: createEmbedder(env),
    retriever: await createRetriever(env),
    config,
  }))().catch((e) => { cached = undefined; throw e; });
  return cached;
}
