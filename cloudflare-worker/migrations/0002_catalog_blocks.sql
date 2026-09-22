ALTER TABLE catalog_items ADD COLUMN blocked_geography_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE catalog_items ADD COLUMN blocked_theme_ids TEXT NOT NULL DEFAULT '[]';
