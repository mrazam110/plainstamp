import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE, runRetrieverContract } from "./contract";
import { PostgresRetriever, orQuery, textArray } from "./postgres";

/** A throwaway database (local Docker); never the production URL. */
const url = process.env.TEST_DATABASE_URL;
const SCHEMA = "contract_test";

async function setup() {
  // fetch_types: false is what the Worker uses, so the tests cover array parameters the same way
  const sql = postgres(url!, { fetch_types: false, onnotice: () => {}, connection: { search_path: `${SCHEMA},public` } });
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

describe("textArray", () => {
  it("builds a quoted, escaped Postgres array literal", () => {
    expect(textArray(["de-be", "de-bb"])).toBe('{"de-be","de-bb"}');
    expect(textArray([])).toBe("{}");
    expect(textArray(['a"b', "c\\d"])).toBe('{"a\\"b","c\\\\d"}');
  });
});

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
  describe("Retriever contract: postgres", () => it.skip("needs TEST_DATABASE_URL", () => expect(true).toBe(true)));
}
