import postgres from "postgres";
import { createEmbedder, createLLM, type ProviderEnv } from "../../core/providers";
import { BundleRetriever, type BundleSource } from "../../core/retriever/bundle";
import { PostgresRetriever } from "../../core/retriever/postgres";
import type { Retriever } from "../../core/retriever/types";
import { isCovered, flattenRegions } from "../../core/pipeline/config";
import type { Deps } from "../../core/pipeline/ask";
import { config } from "./config";
import type { GuardEnv } from "./guard";

export interface Env extends ProviderEnv, GuardEnv {
  ALLOWED_ORIGINS?: string;
  RETRIEVER_BACKEND?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  /** Workers Analytics Engine dataset (wrangler [[analytics_engine_datasets]]) holding vote counts only. */
  FEEDBACK?: { writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };
  /** Durable Object namespace for the daily question counter (wrangler [[durable_objects.bindings]]). */
  COUNTER?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
  };
  /** Static assets binding holding bundle folders (bundle backend only). */
  ASSETS?: { fetch(url: string): Promise<Response> };
}

/** One counter row per vote: the vote word and a 1. Analytics Engine adds a timestamp; nothing about the visitor is passed. */
export const voteRecorder = (env: Env) => env.FEEDBACK
  ? (vote: "up" | "down") => env.FEEDBACK!.writeDataPoint({ blobs: [vote], doubles: [1], indexes: [vote] })
  : undefined;

/** Calendar day in Germany's time zone, so "today" matches the visitors' day. */
const germanDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

/** Counts questions per day. Both calls fail soft: a broken counter must never break answering. */
let statsCache: { at: number; day: string; n: number } | undefined; // per isolate: keeps public /stats hits off the Durable Object

export function questionCounter(env: Env): { count: () => Promise<void>; today: () => Promise<number | null> } | undefined {
  if (!env.COUNTER) return undefined;
  const stub = () => env.COUNTER!.get(env.COUNTER!.idFromName("questions"));
  const url = () => `https://counter.invalid/?day=${germanDay()}`;
  return {
    count: async () => { try { await stub().fetch(url(), { method: "POST" }); } catch { /* counter is optional */ } },
    today: async () => {
      const day = germanDay();
      if (statsCache && statsCache.day === day && Date.now() - statsCache.at < 15_000) return statsCache.n;
      try {
        const n = ((await (await stub().fetch(url())).json()) as { n: number }).n;
        statsCache = { at: Date.now(), day, n };
        return n;
      } catch {
        return null;
      }
    },
  };
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

type Shared = Omit<Deps, "retriever">;
let shared: Shared | undefined;
let bundleRetriever: Promise<Retriever> | undefined;

/**
 * The model clients and config are built once per isolate and hold no per-request data. A Postgres
 * connection cannot be reused: Workers tie a socket to the request that opened it, so a cached one
 * fails on the next request ("Cannot perform I/O on behalf of a different request") and every second
 * question got a 502. The Postgres retriever is therefore built per request. Bundle files are plain
 * fetches, so that retriever is cached.
 */
export async function getDeps(env: Env): Promise<Deps> {
  shared ??= { llm: createLLM(env), embedder: createEmbedder(env), config };
  if ((env.RETRIEVER_BACKEND ?? "postgres") !== "bundle") return { ...shared, retriever: await createRetriever(env) };
  bundleRetriever ??= createRetriever(env).catch((e) => { bundleRetriever = undefined; throw e; });
  return { ...shared, retriever: await bundleRetriever };
}
