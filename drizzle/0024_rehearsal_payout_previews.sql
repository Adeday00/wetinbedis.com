-- Internal League rehearsal only. This queue can never enter the payout
-- workflow: it retains a test name, test bank label and account-number last
-- four only, and it has no foreign key to competition_payouts.
CREATE TABLE IF NOT EXISTS rehearsal_payout_previews (
  id text PRIMARY KEY NOT NULL,
  competition_id text NOT NULL,
  player_id text NOT NULL,
  rank_at_submission integer NOT NULL,
  display_name text NOT NULL,
  bank_label text NOT NULL,
  account_last4 text NOT NULL,
  country_code text NOT NULL,
  submitted_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT rehearsal_payout_previews_player_unique UNIQUE (competition_id, player_id),
  CONSTRAINT rehearsal_payout_previews_rank_check CHECK (rank_at_submission BETWEEN 1 AND 3),
  CONSTRAINT rehearsal_payout_previews_last4_check CHECK (length(account_last4) = 4)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rehearsal_payout_previews_queue_idx
  ON rehearsal_payout_previews (competition_id, rank_at_submission, submitted_at);
