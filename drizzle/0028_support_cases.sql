CREATE TABLE IF NOT EXISTS support_cases (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  internal_note TEXT,
  assigned_to TEXT,
  competition_id TEXT,
  review_id TEXT,
  payout_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS support_cases_status_idx ON support_cases(status, priority, updated_at);
CREATE INDEX IF NOT EXISTS support_cases_player_idx ON support_cases(player_id, created_at);
