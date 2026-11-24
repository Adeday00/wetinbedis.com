CREATE TABLE IF NOT EXISTS username_registry (
  normalized_username text PRIMARY KEY NOT NULL,
  player_id text NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  claimed_at integer NOT NULL
);
INSERT OR IGNORE INTO username_registry (normalized_username, player_id, claimed_at)
  SELECT lower(trim(public_handle)), id, created_at FROM players;
