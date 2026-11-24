CREATE TABLE IF NOT EXISTS privacy_requests (
  id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL,
  request_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  statement text NOT NULL,
  operator_note text,
  handled_by text,
  handled_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT privacy_requests_type_check CHECK (request_type IN ('access', 'correction', 'deletion')),
  CONSTRAINT privacy_requests_status_check CHECK (status IN ('queued', 'in_review', 'completed', 'denied', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS privacy_requests_player_idx
  ON privacy_requests(player_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx
  ON privacy_requests(status, created_at);
