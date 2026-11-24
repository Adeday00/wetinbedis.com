CREATE TABLE IF NOT EXISTS admin_audit_log (
  id text PRIMARY KEY NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  note text,
  details_json text NOT NULL DEFAULT '{}',
  request_id text,
  changed_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admin_audit_log_changed_at_idx ON admin_audit_log (changed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admin_audit_log_resource_idx ON admin_audit_log (resource_type, resource_id, changed_at DESC);
