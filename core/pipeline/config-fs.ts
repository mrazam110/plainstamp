import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseConfig } from "./config";
import type { Config } from "./types";

/** Node-side loader (tests, tools). The Worker gets the same objects from a build-time JSON copy. */
export async function loadConfig(root: string): Promise<Config> {
  const [r, t] = await Promise.all([
    readFile(join(root, "regions", "de.yaml"), "utf8"),
    readFile(join(root, "topics", "de.yaml"), "utf8"),
  ]);
  return parseConfig(parse(r), parse(t));
}
