CREATE TABLE support_diagnostic_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  system text NOT NULL CHECK (system IN ('wotefy','lubfy')),
  ticket_hash text NOT NULL UNIQUE,
  account_proof text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
