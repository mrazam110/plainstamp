-- Plainstamp public-document store. No user tables. The Worker uses a read-only role.
-- {dim} is replaced with the embedding dimension from the bundle manifest.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS regions (
  id text PRIMARY KEY,
  parent_id text REFERENCES regions(id),
  name text NOT NULL,
  level text NOT NULL,
  coverage text NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  source_url text NOT NULL,
  title text NOT NULL,
  region_id text NOT NULL REFERENCES regions(id),
  topic_key text NOT NULL,
  leika_key text,
  language text NOT NULL,
  crawled_at date NOT NULL,
  content_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  heading_path text NOT NULL,
  text text NOT NULL,
  embedding halfvec({dim}) NOT NULL,
  tsv tsvector NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS documents_region_topic_idx ON documents (region_id, topic_key);
