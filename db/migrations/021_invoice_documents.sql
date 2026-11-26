ALTER TABLE media DROP CONSTRAINT media_kind_check;
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind IN ('image', 'audio', 'document'));

ALTER TABLE outbound
  ADD COLUMN document_id bigint REFERENCES media(id) ON DELETE SET NULL,
  ADD COLUMN document_name text,
  ADD COLUMN document_hash text;
