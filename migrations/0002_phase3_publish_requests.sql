CREATE TABLE IF NOT EXISTS publish_requests (
  request_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'published', 'failed')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publish_requests_updated_at ON publish_requests(updated_at);
