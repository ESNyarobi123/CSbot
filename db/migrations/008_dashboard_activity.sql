CREATE INDEX messages_recent_activity ON messages (occurred_at) WHERE kind NOT LIKE 'history:%';
