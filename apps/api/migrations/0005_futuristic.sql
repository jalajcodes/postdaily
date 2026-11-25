-- Futuristic look (dark neon theme, 3D background, animations). Off by default.
ALTER TABLE settings ADD COLUMN futuristic INTEGER NOT NULL DEFAULT 0;
