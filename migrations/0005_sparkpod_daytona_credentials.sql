CREATE TABLE IF NOT EXISTS sparkpod_daytona_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_api_key TEXT NOT NULL,
  api_url TEXT NOT NULL DEFAULT 'https://app.daytona.io/api',
  target TEXT NOT NULL DEFAULT 'us',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
