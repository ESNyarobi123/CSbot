CREATE TABLE service_heartbeats (
  name text PRIMARY KEY,
  beat_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE gateway_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,
  jid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('composing', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gateway_signals_pending ON gateway_signals (account_id, id);

CREATE TABLE media (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,
  conversation_id bigint REFERENCES conversations ON DELETE CASCADE,
  provider_id text,
  kind text NOT NULL CHECK (kind IN ('image')),
  mimetype text NOT NULL,
  bytes bytea NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 8388608),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX media_by_provider ON media (account_id, provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX media_by_conversation ON media (conversation_id, id DESC);

ALTER TABLE messages ADD COLUMN media_id bigint REFERENCES media ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN unread_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_body text,
  ADD COLUMN last_at timestamptz;

UPDATE conversations c SET
  last_body=(SELECT m.body FROM messages m WHERE m.conversation_id=c.id
    ORDER BY m.occurred_at DESC, m.id DESC LIMIT 1),
  last_at=(SELECT m.occurred_at FROM messages m WHERE m.conversation_id=c.id
    ORDER BY m.occurred_at DESC, m.id DESC LIMIT 1);

CREATE INDEX outbound_failed ON outbound (account_id, id) WHERE state = 'uncertain';
CREATE INDEX outbound_by_conversation ON outbound (conversation_id, id DESC);
