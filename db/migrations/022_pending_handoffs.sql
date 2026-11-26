-- A bot handoff and its confirmation share the transaction timestamp. Keep
-- those conversations eligible to reply until an agent explicitly takes over.
UPDATE conversations c
SET memory = c.memory || '{"handoffPending":true}'::jsonb
WHERE c.mode = 'human'
  AND EXISTS (
    SELECT 1 FROM outbound o
    WHERE o.conversation_id = c.id AND o.origin = 'handoff'
      AND o.created_at = c.human_since
  )
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id AND m.direction = 'outbound' AND m.actor = 'admin'
      AND m.occurred_at >= c.human_since
  );
