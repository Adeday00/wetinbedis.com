CREATE TABLE IF NOT EXISTS competition_eligibility_policy_audit (
  id text PRIMARY KEY NOT NULL,
  competition_id text NOT NULL,
  eligible_countries_json text NOT NULL,
  actor text NOT NULL,
  note text NOT NULL,
  changed_at integer NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS competition_eligibility_policy_audit_competition_idx
  ON competition_eligibility_policy_audit(competition_id, changed_at);
