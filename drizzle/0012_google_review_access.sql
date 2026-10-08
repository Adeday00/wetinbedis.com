CREATE TABLE IF NOT EXISTS google_review_access (
  player_id text PRIMARY KEY NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  granted_at integer NOT NULL
);
