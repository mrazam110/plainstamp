import type { Config, RegionNode } from "./types";

export function flattenRegions(root: RegionNode): Map<string, RegionNode> {
  const out = new Map<string, RegionNode>();
  const walk = (n: RegionNode) => {
    out.set(n.id, n);
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

export const isCovered = (r: RegionNode) => r.coverage === "federal" || r.coverage === "pilot";

/** Narrow check for the plain objects produced from regions/de.yaml and topics/de.yaml. */
export function parseConfig(regions: unknown, topics: unknown): Config {
  const t = (topics as { topics?: Config["topics"] }).topics;
  if (!regions || typeof (regions as RegionNode).id !== "string" || !Array.isArray(t)) {
    throw new Error("invalid region or topic config");
  }
  return { regions: regions as RegionNode, topics: t };
}
