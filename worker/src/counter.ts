/** Storage calls the counter needs; Durable Object storage satisfies it. */
export interface CounterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Adds `by` to the count for `day`. A new day starts again at zero, so only one date and one number are ever kept. */
export async function bump(storage: CounterStorage, day: string, by: number): Promise<number> {
  const cur = await storage.get<{ day: string; n: number }>("c");
  const n = (cur?.day === day ? cur.n : 0) + by;
  if (by > 0 || cur?.day !== day) await storage.put("c", { day, n });
  return n;
}

/**
 * One instance holds the number of questions asked today: no text, IP or identifier, just a date and an integer.
 * POST ?day=YYYY-MM-DD adds one; GET reads.
 */
export class DailyCounter {
  constructor(private state: { storage: CounterStorage }) {}

  async fetch(request: Request): Promise<Response> {
    const day = new URL(request.url).searchParams.get("day") ?? "";
    if (!DAY.test(day)) return new Response("bad request", { status: 400 });
    const n = await bump(this.state.storage, day, request.method === "POST" ? 1 : 0);
    return Response.json({ n });
  }
}
