-- How many AI requests each account made per day (UTC) on the server's shared keys, so other
-- accounts get a daily allowance. "text" = writing, "image" = generated images.
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

-- Named groups of hashtags you reuse ("My usual 3").
CREATE TABLE hashtag_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tags TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX hashtag_sets_user ON hashtag_sets (user_id);
