CREATE TABLE IF NOT EXISTS attempt_device_bindings (
  attempt_id text PRIMARY KEY NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios-app-attest', 'android-play-integrity')),
  registered_at integer NOT NULL
);
--> statement-breakpoint
-- Preserve the first existing iPhone registration; a new platform cannot reset its clock.
INSERT OR IGNORE INTO attempt_device_bindings (attempt_id, player_id, platform, registered_at)
SELECT attempt_id, player_id, 'ios-app-attest', MIN(consumed_at)
FROM app_attest_challenges WHERE purpose = 'registration' AND consumed_at IS NOT NULL
GROUP BY attempt_id, player_id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS android_integrity_challenges (
  id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'cash_answer')),
  nonce text NOT NULL,
  request_hash text NOT NULL,
  card_ordinal integer,
  selected_option_id text,
  issued_at integer NOT NULL,
  expires_at integer NOT NULL CHECK (expires_at > issued_at),
  consumed_at integer,
  token_hash text,
  CHECK ((purpose = 'registration' AND card_ordinal IS NULL AND selected_option_id IS NULL) OR (purpose = 'cash_answer' AND card_ordinal > 0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS android_integrity_challenges_active_idx ON android_integrity_challenges(attempt_id, purpose, card_ordinal, expires_at, consumed_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS android_integrity_token_replay_idx ON android_integrity_challenges(token_hash) WHERE token_hash IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS android_integrity_verifications (
  attempt_id text PRIMARY KEY NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  package_name text NOT NULL,
  version_code text NOT NULL,
  certificates_json text NOT NULL,
  registered_at integer NOT NULL,
  last_verified_at integer NOT NULL
);
