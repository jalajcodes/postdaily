-- Retries, first comment, images, push notifications, LinkedIn expiry warnings, style learning.

ALTER TABLE posts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN first_comment TEXT;
ALTER TABLE posts ADD COLUMN comment_urn TEXT;
ALTER TABLE posts ADD COLUMN comment_error TEXT;
ALTER TABLE posts ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN image_alt TEXT;

-- One image per post, stored as a base64 data URL (resized to < ~1 MB in the browser).
CREATE TABLE IF NOT EXISTS post_images (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  data_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Last LinkedIn expiry warning sent ('7d', '1d' or 'expired'), so each is sent once.
ALTER TABLE settings ADD COLUMN linkedin_warning TEXT;

-- Recently published posts (JSON array) used as voice examples, and a flag to re-learn the style.
ALTER TABLE profiles ADD COLUMN learned_posts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN style_refresh_due INTEGER NOT NULL DEFAULT 0;
