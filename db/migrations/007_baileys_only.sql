-- Baileys is the only WhatsApp transport now. Numbers are linked from the shop's own phone
-- by QR code or by an 8-character pairing code, and sessions live in whatsapp_auth.
DELETE FROM accounts WHERE mode = 'cloud';

ALTER TABLE accounts DROP CONSTRAINT accounts_mode_check,
  ADD CONSTRAINT accounts_mode_check CHECK (mode IN ('baileys', 'mock'));

DROP INDEX IF EXISTS one_account_per_cloud_number;
ALTER TABLE accounts
  DROP COLUMN cloud_phone_number_id,
  DROP COLUMN cloud_token,
  DROP COLUMN cloud_verified_name;

DROP INDEX IF EXISTS one_whatsapp_account_per_phone;
CREATE UNIQUE INDEX one_whatsapp_account_per_phone ON accounts (phone) WHERE mode = 'baileys';

-- Baileys has no 24-hour window, so this Cloud API bookkeeping is no longer needed.
DROP TABLE IF EXISTS contact_windows;

-- A pending pairing request: the gateway calls requestPairingCode with this number once a socket exists.
ALTER TABLE accounts
  ADD COLUMN pairing_phone text,
  ADD COLUMN pairing_code text;
