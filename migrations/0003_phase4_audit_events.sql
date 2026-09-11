CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('oauth_connected', 'oauth_disconnected', 'publish_attempt', 'publish_succeeded', 'publish_failed')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'started')),
  resource_id TEXT,
  error_category TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_events(occurred_at DESC);
