ALTER TABLE players ADD COLUMN firebase_uid text;
ALTER TABLE players ADD COLUMN country_code text;
ALTER TABLE players ADD COLUMN payout_consent_at integer;
CREATE UNIQUE INDEX IF NOT EXISTS players_firebase_uid_unique ON players(firebase_uid);
