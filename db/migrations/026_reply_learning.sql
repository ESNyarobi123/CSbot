CREATE TABLE knowledge_reply_cache (
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  answer text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '6 hours',
  PRIMARY KEY (conversation_id, fingerprint)
);
CREATE INDEX knowledge_reply_cache_expiry ON knowledge_reply_cache(expires_at);

CREATE TABLE knowledge_review_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('suggestion','correction','resolved')),
  system text NOT NULL CHECK (system IN ('general','wotefy','lubfy')),
  sample text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (conversation_id, message_id, kind)
);
CREATE INDEX knowledge_review_pending ON knowledge_review_items(created_at DESC) WHERE reviewed_at IS NULL;
