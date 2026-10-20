import { describe, expect, it } from "vitest";
import { bump, type CounterStorage } from "./counter";

const mem = (): CounterStorage => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) as any, put: async (k, v) => { m.set(k, v); } };
};

describe("bump", () => {
  it("adds within a day, restarts on a new day, and reads without writing a count", async () => {
    const s = mem();
    expect(await bump(s, "2026-10-20", 1)).toBe(1);
    expect(await bump(s, "2026-10-20", 1)).toBe(2);
    expect(await bump(s, "2026-10-20", 0)).toBe(2);
    expect(await bump(s, "2026-10-21", 0)).toBe(0);
    expect(await bump(s, "2026-10-21", 1)).toBe(1);
  });
});
