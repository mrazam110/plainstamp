import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BundleSource } from "./bundle";

export function fsSource(root: string): BundleSource {
  return {
    readText: (p) => readFile(join(root, p), "utf8"),
    async readBinary(p) {
      const b = await readFile(join(root, p));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  };
}
