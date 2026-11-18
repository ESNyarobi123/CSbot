-- A voice note is a customer message, not a receipt image: it is stored next to
-- the photos so the worker can read the words before it classifies the turn.
ALTER TABLE media DROP CONSTRAINT media_kind_check;
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind IN ('image', 'audio'));

-- WhatsApp voice notes are small, but a long one exceeds the old 8 MB photo cap.
ALTER TABLE media DROP CONSTRAINT media_size_check;
ALTER TABLE media ADD CONSTRAINT media_size_check CHECK (size > 0 AND size <= 16777216);
