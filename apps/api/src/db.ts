import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const dbPath = path.resolve(process.env.DATABASE_PATH ?? "./data/postdaily.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
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
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  last_ideas_date TEXT
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
  published_at TEXT,
  linkedin_urn TEXT,
  error TEXT,
  idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS posts_due ON posts(status, scheduled_at);
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
`);

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();
