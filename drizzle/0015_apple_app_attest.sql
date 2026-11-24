CREATE TABLE IF NOT EXISTS app_attest_keys (
  key_id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL,
  app_id text NOT NULL,
  environment text NOT NULL,
  public_key_pem text NOT NULL,
  assertion_counter integer DEFAULT 0 NOT NULL,
  receipt_b64 text,
  attested_at integer NOT NULL,
  last_verified_at integer NOT NULL,
  revoked_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT app_attest_keys_environment_check CHECK (environment IN ('development', 'production')),
  CONSTRAINT app_attest_keys_counter_check CHECK (assertion_counter >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_attest_keys_player_idx ON app_attest_keys(player_id, revoked_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_attest_keys_active_idx ON app_attest_keys(app_id, environment, revoked_at, last_verified_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app_attest_challenges (
  id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL,
  attempt_id text NOT NULL,
  key_id text,
  purpose text NOT NULL,
  challenge_b64 text NOT NULL,
  request_binding_hash text,
  card_ordinal integer,
  issued_at integer NOT NULL,
  expires_at integer NOT NULL,
  consumed_at integer,
  created_at integer NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (key_id) REFERENCES app_attest_keys(key_id) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT app_attest_challenges_purpose_check CHECK (purpose IN ('registration', 'cash_answer')),
  CONSTRAINT app_attest_challenges_expiry_check CHECK (expires_at > issued_at),
  CONSTRAINT app_attest_challenges_ordinal_check CHECK (card_ordinal IS NULL OR card_ordinal > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_attest_challenges_active_idx ON app_attest_challenges(attempt_id, purpose, card_ordinal, expires_at, consumed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_attest_challenges_expiry_idx ON app_attest_challenges(expires_at, consumed_at);
