CREATE TABLE IF NOT EXISTS owner_card_preview_tokens (
  id text PRIMARY KEY NOT NULL,
  token_hash text NOT NULL,
  created_by text NOT NULL,
  created_at integer NOT NULL,
  revoked_at integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS owner_card_preview_tokens_active_idx
  ON owner_card_preview_tokens (revoked_at, created_at DESC);
