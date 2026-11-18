-- Customer 360, follow-ups and archives.
--
-- Until now a customer's identity was scattered across conversations.customer_*
-- and two JSON blobs, and the bot never wrote to anyone who had not written
-- first. These tables give every number one record, a consent flag, a durable
-- list of follow-ups, and somewhere to park old chats so the live tables stay
-- small.

-- One record per WhatsApp number: who they are, when we last saw them, the
-- segment the bot inferred from their site, and whether they asked to be left
-- alone.
CREATE TABLE IF NOT EXISTS customers (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  jid text NOT NULL,
  phone text,
  name text,
  email text,
  language text CHECK (language IN ('sw', 'en') OR language IS NULL),
  segment text,
  opted_out boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, jid)
);
CREATE INDEX IF NOT EXISTS customers_by_activity ON customers (account_id, last_seen DESC, jid);
CREATE INDEX IF NOT EXISTS customers_by_segment ON customers (account_id, segment) WHERE segment IS NOT NULL;

-- Backfill the record from the conversations we already have, so a customer who
-- has been talking for weeks does not look brand new. first_seen uses the
-- earliest message where one exists.
INSERT INTO customers (account_id, jid, phone, name, first_seen, last_seen)
SELECT c.account_id, c.customer_jid,
       NULLIF(c.customer_phone, ''), NULLIF(c.customer_name, ''),
       COALESCE(
         (SELECT min(m.received_at) FROM messages m WHERE m.conversation_id = c.id),
         c.updated_at
       ),
       c.updated_at
FROM conversations c
ON CONFLICT (account_id, jid) DO UPDATE
  SET phone = EXCLUDED.phone,
      name = COALESCE(EXCLUDED.name, customers.name),
      first_seen = LEAST(customers.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(customers.last_seen, EXCLUDED.last_seen);

-- Follow-ups the bot will send later: a quote nudge, a payment reminder, a
-- "the team is still on it" ping, or a check after a support fix. PostgreSQL is
-- the durable inbox, so the worker sweeps rows whose time has come instead of
-- trusting an in-memory timer.
CREATE TABLE IF NOT EXISTS follow_ups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  jid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('quote_nudge', 'payment_reminder', 'handoff_ping', 'post_support')),
  body text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  canceled_at timestamptz
);
-- At most one open follow-up of each kind per chat, while still allowing a new
-- one after the previous was sent or canceled.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_follow_up
  ON follow_ups (conversation_id, kind) WHERE sent_at IS NULL AND canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS follow_ups_due
  ON follow_ups (scheduled_at) WHERE sent_at IS NULL AND canceled_at IS NULL;

-- Cold storage for chats older than the live window. Rows are copied here and
-- removed from the live tables by scripts/archive.mjs, so the inbox stays fast.
CREATE TABLE IF NOT EXISTS conversations_archive (
  id bigint NOT NULL,
  account_id text NOT NULL,
  customer_jid text NOT NULL,
  customer_phone text,
  customer_name text,
  mode text NOT NULL,
  stage text NOT NULL,
  memory jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS messages_archive (
  id bigint NOT NULL,
  conversation_id bigint NOT NULL,
  direction text NOT NULL,
  actor text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS messages_archive_by_conversation
  ON messages_archive (conversation_id, occurred_at DESC);
