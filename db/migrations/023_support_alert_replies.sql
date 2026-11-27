ALTER TABLE outbound ADD COLUMN support_reply boolean NOT NULL DEFAULT false;

UPDATE outbound
SET support_reply = true
WHERE origin = 'alert' AND body LIKE '*CSbot | Msaada wa kiufundi*%';

CREATE INDEX outbound_support_alert_case ON outbound (conversation_id, created_at DESC)
WHERE support_reply;
