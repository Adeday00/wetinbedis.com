CREATE TABLE IF NOT EXISTS event_packs (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  access_mode TEXT NOT NULL,
  expires_at_ms INTEGER,
  cards_json TEXT NOT NULL,
  card_count INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (status IN ('published', 'revoked')),
  CHECK (access_mode IN ('permanent', 'event_end')),
  CHECK ((access_mode = 'permanent' AND expires_at_ms IS NULL) OR (access_mode = 'event_end' AND expires_at_ms IS NOT NULL)),
  CHECK (card_count BETWEEN 5 AND 300)
);

CREATE TABLE IF NOT EXISTS event_pack_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  pack_id TEXT NOT NULL REFERENCES event_packs(id) ON DELETE CASCADE,
  max_redemptions INTEGER,
  expires_at_ms INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (max_redemptions IS NULL OR max_redemptions > 0)
);

CREATE TABLE IF NOT EXISTS event_pack_redemptions (
  code_hash TEXT NOT NULL REFERENCES event_pack_codes(code_hash) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code_hash, player_id)
);

CREATE TABLE IF NOT EXISTS event_pack_access_grants (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES event_packs(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL,
  expires_at_ms INTEGER,
  code_hash TEXT NOT NULL REFERENCES event_pack_codes(code_hash),
  PRIMARY KEY (player_id, pack_id),
  CHECK (expires_at_ms IS NULL OR expires_at_ms > granted_at)
);

CREATE INDEX IF NOT EXISTS event_pack_codes_pack_idx ON event_pack_codes(pack_id, revoked_at);
CREATE INDEX IF NOT EXISTS event_pack_grants_player_idx ON event_pack_access_grants(player_id, expires_at_ms);
