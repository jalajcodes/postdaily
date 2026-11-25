-- Carousel design (theme, pattern, font, accent) per post, and brand defaults per user.
ALTER TABLE posts ADD COLUMN carousel_design TEXT;
ALTER TABLE settings ADD COLUMN carousel_brand TEXT NOT NULL DEFAULT '{}';
