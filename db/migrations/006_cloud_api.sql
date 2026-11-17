-- Official WhatsApp Cloud API accounts sit next to Baileys accounts. A single deployment can mix them.
ALTER TABLE accounts DROP CONSTRAINT accounts_mode_check,
  ADD CONSTRAINT accounts_mode_check CHECK (mode IN ('baileys', 'mock', 'cloud'));
DROP INDEX one_whatsapp_account_per_phone;
CREATE UNIQUE INDEX one_whatsapp_account_per_phone ON accounts (phone) WHERE mode IN ('baileys', 'cloud');

ALTER TABLE accounts
  ADD COLUMN cloud_phone_number_id text,
  ADD COLUMN cloud_token text,
  ADD COLUMN cloud_verified_name text;
CREATE UNIQUE INDEX one_account_per_cloud_number ON accounts (cloud_phone_number_id) WHERE mode='cloud';

-- The Cloud API only allows free-form messages inside 24 hours of the recipient's last inbound message.
-- Tracking that clock per contact turns error 131047 into a routing decision instead of a failed send.
CREATE TABLE contact_windows (
  account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,
  phone text NOT NULL,
  last_inbound_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, phone)
);

ALTER TABLE outbound
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN read_at timestamptz;
