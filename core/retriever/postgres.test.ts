import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE, runRetrieverContract } from "./contract";
import { PostgresRetriever, orQuery } from "./postgres";

const url = process.env.DATABASE_URL;
const SCHEMA = "contract_test";

async function setup() {
  const sql = postgres(url!, { onnotice: () => {}, connection: { search_path: `${SCHEMA},public` } });
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
  const ddl = readFileSync(join(import.meta.dirname, "../../ingest/sql/schema.sql"), "utf8").replaceAll("{dim}", "4");
  await sql.unsafe(ddl);
  for (const id of Object.keys(FIXTURE))
    await sql`INSERT INTO regions (id, parent_id, name, level, coverage) VALUES (${id}, NULL, ${id}, 'land', 'pilot')`;
  for (const [region, items] of Object.entries(FIXTURE)) {
    for (const c of items) {
      await sql`INSERT INTO documents (id, source_url, title, region_id, topic_key, leika_key, language, crawled_at, content_hash)
                VALUES (${"d-" + c.id}, ${"https://x/" + c.id}, 'T', ${region}, ${c.topic}, NULL, 'de', '2026-10-18', 'h')`;
      await sql`INSERT INTO chunks (id, document_id, heading_path, text, embedding, tsv)
                VALUES (${c.id}, ${"d-" + c.id}, 'H', ${c.text}, ${`[${c.vec.join(",")}]`}::halfvec, to_tsvector('german', ${c.text}))`;
    }
  }
  return sql;
}

describe("orQuery", () => {
  it("joins words with OR and drops punctuation", () => {
    expect(orQuery("Wohnung, anmelden! Frist (2 Wochen)")).toBe("wohnung | anmelden | frist | 2 | wochen");
  });
});

if (url) {
  let sql: ReturnType<typeof postgres> | undefined;
  runRetrieverContract("postgres", async () => {
    sql ??= await setup();
    return new PostgresRetriever(sql);
  });
  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await sql.end();
    }
  });
} else {
  describe("Retriever contract: postgres", () => it.skip("needs DATABASE_URL", () => expect(true).toBe(true)));
}
