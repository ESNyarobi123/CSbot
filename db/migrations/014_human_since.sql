-- A chat parked in human mode must be able to return to the bot. The idle
-- window is measured from the moment the handoff started (or the last human
-- reply), so a handoff with no admin activity is released instead of leaving a
-- paying customer unanswered for hours.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_since timestamptz;

UPDATE conversations SET human_since = updated_at WHERE mode = 'human' AND human_since IS NULL;

CREATE INDEX IF NOT EXISTS conversations_human_since_idx
  ON conversations (human_since) WHERE mode = 'human';
