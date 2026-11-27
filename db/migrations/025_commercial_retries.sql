CREATE TABLE commercial_retries (
  conversation_id bigint PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  last_inbound_id bigint NOT NULL,
  question text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1),
  due_at timestamptz NOT NULL DEFAULT now() + interval '25 seconds',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_retries_due ON commercial_retries(due_at);
ALTER TABLE outbound ADD COLUMN reply_anchor_id bigint;
