CREATE TABLE IF NOT EXISTS cloudflare_oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloudflare_oauth_states_expires_at
  ON cloudflare_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS cloudflare_oauth_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at TEXT,
  granted_scope TEXT,
  account_id TEXT,
  account_name TEXT,
  project_name TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
