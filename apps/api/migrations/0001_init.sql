-- PostDaily schema. Used by Cloudflare D1 (`wrangler d1 migrations apply`) and by the
-- local Node server, which runs every file in this folder on start (statements are idempotent).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  picture TEXT,
  linkedin_sub TEXT UNIQUE,
  linkedin_token TEXT,
  linkedin_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- `token` holds a SHA-256 hash of the bearer token, never the token itself.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- LinkedIn OAuth "state" values, kept in the database so sign-in works across server instances.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  redirect TEXT NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ai_provider TEXT NOT NULL DEFAULT 'claude-code',
  ai_model TEXT NOT NULL DEFAULT 'claude-opus-5-5',
  default_length TEXT NOT NULL DEFAULT 'medium',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reminder_enabled INTEGER NOT NULL DEFAULT 1,
  reminder_time TEXT NOT NULL DEFAULT '18:00',
  weekly_goal INTEGER NOT NULL DEFAULT 5,
  daily_ideas INTEGER NOT NULL DEFAULT 1,
  last_reminder_date TEXT,
  last_ideas_date TEXT,
  jitter_enabled INTEGER NOT NULL DEFAULT 1,
  jitter_minutes INTEGER NOT NULL DEFAULT 7
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  niche TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  topics TEXT NOT NULL DEFAULT '[]',
  sample_posts TEXT NOT NULL DEFAULT '',
  style_guide TEXT NOT NULL DEFAULT '',
  banned_phrases TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  for_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  publish_at TEXT,
  jitter_minutes INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  linkedin_urn TEXT,
  error TEXT,
  idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS posts_user_status ON posts(user_id, status);
CREATE INDEX IF NOT EXISTS posts_status ON posts(status);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
