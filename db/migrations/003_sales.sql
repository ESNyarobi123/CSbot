CREATE TABLE sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations,
  stage text NOT NULL CHECK (stage IN ('inquiry','quoted','ready_to_pay','payment_reported','paid','completed')),
  quote jsonb,
  request_key text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK ((stage='completed') = (closed_at IS NOT NULL)),
  UNIQUE (id, conversation_id),
  UNIQUE (conversation_id, request_key)
);
CREATE UNIQUE INDEX one_open_sale ON sales (conversation_id) WHERE closed_at IS NULL;
CREATE INDEX sales_by_conversation ON sales (conversation_id, id DESC);

CREATE INDEX sales_events_by_conversation ON sales_events (conversation_id,id DESC);

INSERT INTO sales (conversation_id, stage, quote, opened_at, updated_at, closed_at)
SELECT c.id, c.stage,
  CASE WHEN c.memory ? 'lastQuote' THEN
    jsonb_strip_nulls(jsonb_build_object('text', c.memory->'lastQuote', 'kind', c.memory->'quoteFor',
      'product', CASE WHEN c.memory->>'quoteFor' IS DISTINCT FROM 'plan' THEN c.memory->'product' END,
      'system', c.memory->'system'))
  END,
  COALESCE(events.first_at,c.updated_at), GREATEST(c.updated_at,COALESCE(events.last_at,c.updated_at)),
  CASE WHEN c.stage='completed' THEN COALESCE(events.completed_at,c.updated_at) END
FROM conversations c
LEFT JOIN LATERAL (
  SELECT min(created_at) AS first_at, max(created_at) AS last_at,
    max(created_at) FILTER (WHERE stage='completed') AS completed_at
  FROM sales_events WHERE conversation_id=c.id
) events ON true
WHERE c.stage <> 'inquiry' OR events.first_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM sales_alerts a WHERE a.conversation_id=c.id);

ALTER TABLE sales_events ADD COLUMN sale_id bigint;
ALTER TABLE sales_alerts ADD COLUMN sale_id bigint;
UPDATE sales_events e SET sale_id=s.id FROM sales s WHERE s.conversation_id=e.conversation_id;
UPDATE sales_alerts a SET sale_id=s.id FROM sales s WHERE s.conversation_id=a.conversation_id;
ALTER TABLE sales_events ALTER COLUMN sale_id SET NOT NULL,
  ADD FOREIGN KEY (sale_id,conversation_id) REFERENCES sales (id,conversation_id);
ALTER TABLE sales_alerts ALTER COLUMN sale_id SET NOT NULL,
  DROP CONSTRAINT sales_alerts_pkey, ADD PRIMARY KEY (sale_id,stage),
  ADD FOREIGN KEY (sale_id,conversation_id) REFERENCES sales (id,conversation_id);
CREATE INDEX sales_events_by_sale ON sales_events (sale_id,id DESC);
