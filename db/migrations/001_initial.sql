CREATE TABLE accounts (
  id text PRIMARY KEY,
  label text NOT NULL,
  phone text,
  mode text NOT NULL CHECK (mode IN ('baileys', 'mock')),
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'offline',
  qr text,
  qr_at timestamptz,
  session_version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX one_whatsapp_account_per_phone ON accounts (phone) WHERE mode='baileys';
CREATE TABLE whatsapp_auth (
  account_id text REFERENCES accounts ON DELETE CASCADE,
  session_version integer NOT NULL,
  category text NOT NULL,
  key_id text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (account_id, session_version, category, key_id)
);
CREATE TABLE admin_numbers (
  account_id text REFERENCES accounts ON DELETE CASCADE,
  phone text NOT NULL,
  PRIMARY KEY (account_id, phone)
);
CREATE TABLE conversations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts,
  customer_jid text NOT NULL,
  customer_phone text,
  customer_name text,
  mode text NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human')),
  stage text NOT NULL DEFAULT 'inquiry' CHECK (stage IN
    ('inquiry', 'quoted', 'ready_to_pay', 'payment_reported', 'paid', 'completed')),
  memory jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, customer_jid)
);
CREATE INDEX inbox_by_account ON conversations (account_id, updated_at DESC, id DESC);
CREATE TABLE contact_aliases (
  account_id text REFERENCES accounts ON DELETE CASCADE,
  jid text NOT NULL,
  conversation_id bigint NOT NULL REFERENCES conversations ON DELETE CASCADE,
  PRIMARY KEY (account_id, jid)
);
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations,
  provider_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  actor text NOT NULL CHECK (actor IN ('customer', 'bot', 'admin')),
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  auto_reply boolean NOT NULL DEFAULT true,
  processing text NOT NULL DEFAULT 'done' CHECK (processing IN ('pending', 'done')),
  UNIQUE (conversation_id, direction, provider_id)
);
CREATE INDEX pending_messages ON messages (conversation_id, id) WHERE processing = 'pending';
CREATE INDEX message_history ON messages (conversation_id, occurred_at DESC, id DESC);
CREATE TABLE outbound (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts,
  conversation_id bigint REFERENCES conversations,
  jid text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('bot', 'admin', 'alert', 'handoff')),
  body text NOT NULL,
  image_url text,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'sent', 'uncertain', 'canceled')),
  provider_id text NOT NULL,
  request_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  sent_at timestamptz,
  reason text,
  UNIQUE (account_id, provider_id),
  UNIQUE (conversation_id, request_key)
);
CREATE INDEX outbound_waiting ON outbound (account_id, id) WHERE state IN ('queued', 'sending');
CREATE TABLE sales_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations,
  stage text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_alerts (
  conversation_id bigint REFERENCES conversations,
  stage text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, stage)
);
CREATE TABLE knowledge (
  id text PRIMARY KEY,
  system text NOT NULL CHECK (system IN ('general', 'wotefy', 'lubfy')),
  title text NOT NULL,
  content text NOT NULL,
  tags text NOT NULL DEFAULT '',
  source_url text,
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX published_knowledge_search ON knowledge USING gin
  (to_tsvector('simple', title || ' ' || tags || ' ' || content)) WHERE published;
CREATE TABLE products (
  id text PRIMARY KEY,
  name text NOT NULL,
  sku text NOT NULL,
  description text,
  image_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
