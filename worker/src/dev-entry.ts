/* Local-only entry (wrangler.dev.toml): fake model, fake embedder, three tiny in-memory regions.
 * Lets the whole request path run under `wrangler dev` without keys or a database. Not deployed. */
import type { Deps } from "../../core/pipeline/ask";
import { FakeLLM } from "../../core/llm/fake";
import { BundleRetriever } from "../../core/retriever/bundle";
import { FakeEmbedder, makeBundle } from "../../core/retriever/testing";
import type { Chunk } from "../../core/retriever/types";
import { config } from "./config";
import { createGuard, type GuardEnv } from "./guard";
import { handle } from "./handler";

const chunk = (id: string, regionId: string, topicKey: string, title: string, text: string): Chunk => ({
  id, docId: `doc-${id}`, title, heading: "Überblick", regionId, topicKey, leikaKey: null,
  url: `https://example.test/${id}`, crawledAt: "2026-10-18", text,
});
const data: Record<string, Chunk[]> = {
  de: [chunk("f1", "de", "broadcasting-fee", "Rundfunkbeitrag", "Rundfunkbeitrag Wohnung anmelden Beitragsservice")],
  "de-be": [chunk("be1", "de-be", "anmeldung", "Wohnsitz anmelden Berlin", "Wohnung anmelden Bürgeramt Berlin Frist zwei Wochen")],
  "de-bb": [chunk("bb1", "de-bb", "anmeldung", "Wohnsitz anmelden Brandenburg", "Wohnung anmelden Brandenburg Meldebehörde")],
};

let deps: Promise<Deps> | undefined;
const getDeps = () => (deps ??= (async () => {
  const embedder = new FakeEmbedder();
  const bundles = await Promise.all(Object.entries(data).map(([r, cs]) => makeBundle(r, cs, embedder)));
  return { llm: new FakeLLM(), embedder, retriever: new BundleRetriever(bundles), config };
})());

export default {
  fetch: (request: Request, env: GuardEnv) => handle(request, getDeps, { allowedOrigins: ["http://localhost:5173"], guard: createGuard(env) }),
};
