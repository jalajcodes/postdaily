-- Engagement nudge, content pillars, PDF carousels.

-- Nudge to reply to comments ~40 minutes after a post goes live (on by default).
ALTER TABLE settings ADD COLUMN engagement_nudge INTEGER NOT NULL DEFAULT 1;
ALTER TABLE posts ADD COLUMN nudge_sent INTEGER NOT NULL DEFAULT 0;
-- Don't nudge about posts that were published before this feature existed.
UPDATE posts SET nudge_sent = 1 WHERE status = 'published';

-- Content pillars (JSON array of themes) used by "Plan my week".
ALTER TABLE profiles ADD COLUMN pillars TEXT NOT NULL DEFAULT '[]';

-- Media: 'image' or 'document' (PDF carousel). The bytes stay in post_images.
ALTER TABLE posts ADD COLUMN media_type TEXT;
UPDATE posts SET media_type = 'image' WHERE has_image = 1;
ALTER TABLE posts ADD COLUMN document_title TEXT;
-- Carousel slides as JSON, so the editor can show and re-edit them.
ALTER TABLE posts ADD COLUMN carousel_slides TEXT;
