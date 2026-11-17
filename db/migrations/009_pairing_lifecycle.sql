ALTER TABLE accounts
  ADD COLUMN pairing_request_id uuid,
  ADD COLUMN pairing_requested_at timestamptz,
  ADD COLUMN pairing_code_at timestamptz,
  ADD COLUMN pairing_error boolean NOT NULL DEFAULT false;

-- The earlier code flow did not record when a code was issued.
UPDATE accounts SET pairing_phone=NULL,pairing_code=NULL WHERE pairing_phone IS NOT NULL;
