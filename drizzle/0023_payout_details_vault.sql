-- Player payout details are kept in a separate encrypted vault record. The
-- competition and payout tables retain only workflow state and transfer refs.
CREATE TABLE IF NOT EXISTS competition_payout_details (
  id text PRIMARY KEY NOT NULL,
  payout_id text NOT NULL UNIQUE,
  player_id text NOT NULL,
  competition_id text NOT NULL,
  details_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  submitted_at integer NOT NULL,
  reviewed_by text,
  reviewed_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (payout_id) REFERENCES competition_payouts(id) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT competition_payout_details_status_check CHECK (status IN ('submitted', 'verified', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS competition_payout_details_player_idx
  ON competition_payout_details(player_id, competition_id, updated_at DESC);
