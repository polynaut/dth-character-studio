-- The raw, append-only submission store — phase 1's ONLY table. Rows are never
-- updated or deleted; aggregation (phase 2+) is a separate read-only pass over
-- them, so improved merge logic can always be re-run against the full corpus.
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  -- SHA-256 of the canonical body; UNIQUE = exact duplicates (the same library
  -- rescanned) never grow the table.
  body_hash TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL
);
