CREATE TABLE IF NOT EXISTS admin_roles (
  id text PRIMARY KEY NOT NULL,
  role_key text NOT NULL,
  label text NOT NULL,
  permissions_json text NOT NULL DEFAULT '[]',
  enabled integer NOT NULL DEFAULT 1,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_role_key_idx ON admin_roles (role_key);
--> statement-breakpoint
INSERT OR IGNORE INTO admin_roles (id, role_key, label, permissions_json, enabled, created_at, updated_at) VALUES
  ('admin-role-owner', 'owner', 'Owner', '["*"]', 1, 0, 0),
  ('admin-role-reviewer', 'reviewer', 'Winner reviewer', '["reviews.read","reviews.decide","fraud.read"]', 1, 0, 0),
  ('admin-role-payout-operator', 'payout_operator', 'Payout operator', '["payouts.read","payouts.create","payouts.approve","payouts.send"]', 1, 0, 0),
  ('admin-role-support', 'support', 'Support operator', '["players.read","support.read","support.update"]', 1, 0, 0),
  ('admin-role-analyst', 'analyst', 'Analyst', '["analytics.read","audit.read"]', 1, 0, 0);
