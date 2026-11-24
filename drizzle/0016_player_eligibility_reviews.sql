CREATE TABLE IF NOT EXISTS player_eligibility_reviews (
  id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL,
  status text NOT NULL,
  rules_version text NOT NULL,
  country_code text NOT NULL,
  note text NOT NULL,
  reviewer text NOT NULL,
  reviewed_at integer NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT player_eligibility_reviews_status_check CHECK (status IN ('eligible', 'ineligible', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS player_eligibility_reviews_player_idx
  ON player_eligibility_reviews(player_id, reviewed_at);
