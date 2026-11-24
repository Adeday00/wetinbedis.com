CREATE TABLE IF NOT EXISTS cash_launch_gates (
  gate_key text PRIMARY KEY NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  evidence_reference text,
  note text,
  reviewed_by text,
  reviewed_at integer,
  updated_at integer NOT NULL,
  CONSTRAINT cash_launch_gates_status_check CHECK (status IN ('pending', 'passed', 'failed'))
);
