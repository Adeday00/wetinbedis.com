CREATE TABLE IF NOT EXISTS pics_pack_state (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'current'),
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_version TEXT NOT NULL,
  pack_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
