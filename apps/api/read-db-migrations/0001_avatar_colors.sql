-- Gauge colours extracted from profile pictures
-- (apps/api/src/read-models/avatar-colors). Lives in matchbox-read-models
-- (READ_DB) beside the matchbox-jobs tables; its own migrations directory
-- keeps the two histories apart. Written only by the API's gauge publish,
-- and only when an avatar URL or its profile's updated_at is new.
CREATE TABLE IF NOT EXISTS avatar_colors (
  url TEXT NOT NULL,
  profile_updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  -- Upper-case #RRGGBB, adjusted to read on every theme preset; null when
  -- the image failed.
  color TEXT,
  -- 'brand' or 'dominant' when ok, the failure reason when failed.
  detail TEXT NOT NULL,
  -- Unix seconds.
  extracted_at INTEGER NOT NULL,
  PRIMARY KEY (url, profile_updated_at)
);
