-- matchbox-feedback: one row per report sent from the feedback widget.
--
-- Only what the panel listed for the user is stored. The client IP is used
-- for the rate limit and never written here. A screenshot lives in R2 under
-- an unguessable key; after 90 days the R2 lifecycle rule deletes it and the
-- scheduled sweep marks the row 'expired' and forgets the key.

CREATE TABLE feedback_reports (
  -- 32 lower-case hex characters, random.
  id TEXT PRIMARY KEY,
  -- What people quote: FB- and six Crockford base32 characters.
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
  message TEXT NOT NULL,
  -- The allow-listed page origin the report came from, e.g.
  -- https://pro.matchbox.markets.
  origin TEXT NOT NULL,
  surface TEXT NOT NULL,
  -- Path only: the widget drops the query string and fragment. Null when
  -- the user removed the page from the report.
  route TEXT,
  build TEXT,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER NOT NULL,
  theme_mode TEXT NOT NULL CHECK (theme_mode IN ('light', 'dark')),
  theme_preset TEXT,
  user_agent TEXT NOT NULL,
  wallet_browser TEXT,
  chain_id INTEGER,
  -- Only when the user ticked "Include my wallet address".
  wallet TEXT,
  -- Only when the user typed one.
  contact TEXT,
  -- none: no screenshot (or one announced that never arrived). pending:
  -- announced, not uploaded yet. stored: in R2. expired: deleted after 90
  -- days, key forgotten.
  screenshot_status TEXT NOT NULL
    CHECK (screenshot_status IN ('none', 'pending', 'stored', 'expired')),
  screenshot_key TEXT,
  screenshot_type TEXT,
  screenshot_bytes INTEGER,
  screenshot_stored_at TEXT,
  -- SHA-256 of the one-time upload token; cleared once used or closed.
  upload_token_hash TEXT,
  -- waiting: not posted yet (held while a screenshot is pending). posted,
  -- skipped (no bot configured), failed (retried by the sweep).
  discord_status TEXT NOT NULL
    CHECK (discord_status IN ('waiting', 'posted', 'skipped', 'failed')),
  discord_message_id TEXT,
  discord_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX feedback_reports_created_at ON feedback_reports (created_at);

CREATE INDEX feedback_reports_discord
  ON feedback_reports (discord_status, created_at);

CREATE INDEX feedback_reports_screenshot
  ON feedback_reports (screenshot_status, screenshot_stored_at);
