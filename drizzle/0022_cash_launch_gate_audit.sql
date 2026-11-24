CREATE TABLE IF NOT EXISTS cash_launch_gate_audit (
  id text PRIMARY KEY NOT NULL,
  gate_key text NOT NULL,
  status text NOT NULL,
  evidence_reference text,
  note text NOT NULL,
  reviewed_by text NOT NULL,
  changed_at integer NOT NULL,
  CONSTRAINT cash_launch_gate_audit_status_check CHECK (status IN ('pending', 'passed', 'failed'))
);

CREATE INDEX IF NOT EXISTS cash_launch_gate_audit_gate_changed_idx
  ON cash_launch_gate_audit(gate_key, changed_at DESC);
