CREATE TABLE google_review_access (
  player_id text PRIMARY KEY NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  granted_at integer NOT NULL
);
