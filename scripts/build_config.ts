/* Builds worker/src/config.generated.json from regions/de.yaml and topics/de.yaml (run before wrangler). */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { loadConfig } from "../core/pipeline/config-fs";

const root = join(import.meta.dirname, "..");
const config = await loadConfig(root);
const topics = config.topics.map(({ key, label, state_specific }) => ({ key, label, state_specific }));
await writeFile(join(root, "worker", "src", "config.generated.json"), JSON.stringify({ regions: config.regions, topics }));
await writeFile(join(root, "web", "src", "regions.generated.json"), JSON.stringify(config.regions));

// directory page: join the entries with the topic taxonomy so the web page knows which topics differ per state
const dir = parse(await readFile(join(root, "topics", "directory.yaml"), "utf8")) as { groups: { key: string }[]; entries: { topic: string; group: string }[] };
const byKey = new Map(config.topics.map((t) => [t.key, t]));
const groupKeys = new Set(dir.groups.map((g) => g.key));
for (const e of dir.entries) {
  if (!byKey.has(e.topic)) throw new Error(`directory: unknown topic ${e.topic}`);
  if (!groupKeys.has(e.group)) throw new Error(`directory: unknown group ${e.group}`);
}
const entries = dir.entries.map((e) => ({ ...e, label: byKey.get(e.topic)!.label, state_specific: byKey.get(e.topic)!.state_specific }));
await writeFile(join(root, "web", "src", "directory.generated.json"), JSON.stringify({ groups: dir.groups, entries }));

// web/public/privacy.html is generated from PRIVACY.md so the page and the document cannot drift apart
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
let list = false;
const body: string[] = [];
for (const line of (await readFile(join(root, "PRIVACY.md"), "utf8")).split("\n")) {
  const li = /^- (.*)$/.exec(line);
  if (li) { if (!list) { body.push("<ul>"); list = true; } body.push(`<li>${inline(li[1]!)}</li>`); continue; }
  if (list) { body.push("</ul>"); list = false; }
  const h = /^# (.*)$/.exec(line);
  if (h) body.push(`<h1>${inline(h[1]!)}</h1>`);
  else if (line.trim()) body.push(`<p>${inline(line)}</p>`);
}
if (list) body.push("</ul>");
await mkdir(join(root, "web", "public"), { recursive: true });
await writeFile(join(root, "web", "public", "privacy.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Privacy - Plainstamp</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#1d2433;background:#f6f1e7}@media(prefers-color-scheme:dark){body{color:#ece8de;background:#14171f}a{color:#7ba3df}}li{margin:.5em 0}</style></head><body>${body.join("\n")}<p><a href="/">Back to Plainstamp</a></p></body></html>`);
console.log(`config: ${topics.length} topics, privacy page`);
