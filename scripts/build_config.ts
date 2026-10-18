/* Builds worker/src/config.generated.json from regions/de.yaml and topics/de.yaml (run before wrangler). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/pipeline/config-fs";

const root = join(import.meta.dirname, "..");
const config = await loadConfig(root);
const topics = config.topics.map(({ key, label, state_specific }) => ({ key, label, state_specific }));
await writeFile(join(root, "worker", "src", "config.generated.json"), JSON.stringify({ regions: config.regions, topics }));
console.log(`config: ${topics.length} topics`);
