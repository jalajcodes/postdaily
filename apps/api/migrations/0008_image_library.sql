-- Your image library: AI images you've made, kept to attach to posts later.
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  style TEXT NOT NULL,
  model TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX images_user_created ON images (user_id, created_at);
