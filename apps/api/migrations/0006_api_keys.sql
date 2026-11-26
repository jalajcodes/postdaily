-- API keys you add in Settings. Encrypted with AES-GCM (key derived from the KEYS_SECRET server
-- secret); only the last 4 characters are kept in the clear, for display.
CREATE TABLE api_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, provider)
);
