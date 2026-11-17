-- Device knowledge v2.
--
-- The first table only held the handful of columns the price list happened to
-- use. A customer asking "ni 360°?", "ina mesh?", "inasimamiwa na controller
-- gani?" or "ina manage watu wangapi?" got silence, and the model filled the
-- gap with a guess. These columns are the rest of the datasheet, so the answer
-- can come from a record instead of an invention.

ALTER TABLE device_specs
  ADD COLUMN IF NOT EXISTS antenna text,
  ADD COLUMN IF NOT EXISTS radios text,
  ADD COLUMN IF NOT EXISTS gain_dbi numeric(4,1) CHECK (gain_dbi IS NULL OR gain_dbi >= 0),
  ADD COLUMN IF NOT EXISTS ip_rating text,
  ADD COLUMN IF NOT EXISTS mesh boolean,
  ADD COLUMN IF NOT EXISTS controller text,
  ADD COLUMN IF NOT EXISTS poe_watts numeric(5,1) CHECK (poe_watts IS NULL OR poe_watts >= 0),
  ADD COLUMN IF NOT EXISTS mounting text,
  ADD COLUMN IF NOT EXISTS highlights text[],
  -- Other names a customer or the catalog uses for the same box ("RAP6262",
  -- "EAP650-OUTDOOR"), so a differently spelled model still reaches this row.
  ADD COLUMN IF NOT EXISTS aliases text[];

CREATE INDEX IF NOT EXISTS device_specs_aliases ON device_specs USING gin (aliases);

-- Each chat keeps what the customer's own site needs (distance, users, walls,
-- the kit they already own) across conversations, not just within one thread.
CREATE TABLE IF NOT EXISTS customer_memory (
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  jid text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, jid)
);

-- TP-Link Omada family -------------------------------------------------------
UPDATE device_specs SET
  radios = '2.4 GHz 2×2 + 5 GHz 2×2', antenna = 'Internal omni-directional',
  controller = 'Omada SDN controller / Omada Cloud', mesh = true,
  mounting = 'Ceiling or wall bracket',
  highlights = ARRAY['Managed from the Omada controller (local or cloud)',
    'Forms a mesh with other Omada EAP units', 'One cable: PoE-in carries power and data']
WHERE model_key = 'TPLINKEAP650';

UPDATE device_specs SET
  radios = '2.4 GHz 2×2', antenna = 'Internal omni-directional',
  controller = 'Omada SDN controller / Omada Cloud', ip_rating = 'IP65',
  mounting = 'Pole or wall mount, weatherproof',
  highlights = ARRAY['Cheapest Omada entry point for a small outdoor hotspot',
    '2.4 GHz only — fine for phones, not for heavy video']
WHERE model_key = 'TPLINKEAP110';

UPDATE device_specs SET
  radios = '2.4 GHz 2×2 + 5 GHz 2×2', antenna = 'Internal omni-directional',
  controller = 'Omada SDN controller / Omada Cloud', mesh = true, ip_rating = 'IP65',
  mounting = 'Pole or wall mount, weatherproof',
  highlights = ARRAY['Dual band AC1200 for a yard or compound',
    'Same Omada controller as the indoor EAP units']
WHERE model_key = 'TPLINKEAP225';

UPDATE device_specs SET
  radios = '2.4 GHz 2×2 + 5 GHz 2×2', antenna = 'Internal omni-directional',
  controller = 'Omada SDN controller / Omada Cloud', mesh = true, ip_rating = 'IP67',
  mounting = 'Pole or wall mount, weatherproof',
  highlights = ARRAY['Wi-Fi 6 outdoor unit at the price of an older AC unit',
    'IP67 housing for rain and dust',
    'Sits on the same Omada controller as the rest of the fleet']
WHERE model_key = 'TPLINKEAP610';

-- Outdoor units --------------------------------------------------------------
UPDATE device_specs SET
  deployment = 'outdoor', antenna = 'Built-in antennas', controller = 'Standalone web UI, or Cudy cloud app',
  mounting = 'Pole or wall mount, weatherproof'
WHERE model_key = 'CUDYAP1300';

UPDATE device_specs SET
  deployment = 'outdoor', antenna = 'Built-in antennas', controller = 'Standalone web UI, or Cudy cloud app',
  mounting = 'Pole or wall mount, IP65 housing',
  highlights = ARRAY['Rated for rain and dust (IP65)', '48 V PoE adapter included',
    'Reaches further than the indoor units on one AP']
WHERE model_key = 'CUDYAP3000';

UPDATE device_specs SET
  antenna = 'Built-in omni-directional', controller = 'Ruijie Reyee cloud / self-organising network',
  mounting = 'Pole or wall mount, outdoor',
  highlights = ARRAY['Reyee units find each other and share one SSID',
    'Managed from the Reyee app without a separate controller box']
WHERE model_key = 'RGRAP52OD';

UPDATE device_specs SET
  antenna = 'Built-in omni-directional', controller = 'Standalone web UI',
  mounting = 'Pole or wall mount, outdoor'
WHERE model_key = 'COMFASTCFWA933';

-- Router ---------------------------------------------------------------------
UPDATE device_specs SET
  radios = '2.4 GHz 2×2 + 5 GHz 2×2', antenna = 'Internal, 4× Ethernet ports',
  controller = 'RouterOS (WinBox / CAPsMAN)', mounting = 'Desk or wall',
  highlights = ARRAY['Router and Wi-Fi in one box', 'CAPsMAN manages the other MikroTik APs',
    'PoE-out on one port can power an AP']
WHERE model_key = 'MIKROTIKHAPAX2';

-- Models customers ask about that the shop can price ---------------------------
INSERT INTO device_specs (model_key, brand, model, deployment, wifi, bands, ports, poe, coverage_m,
  users, notes, source_url, verified, antenna, radios, controller, mesh, mounting, highlights, aliases)
VALUES
  ('RGRAP6262G', 'RUIJIE', 'RG-RAP6262(G)', 'indoor', '802.11ax (Wi-Fi 6, AX1800)',
   '2.4 GHz + 5 GHz', '1× 10/100/1000 Mbps', '802.3af PoE', NULL, NULL,
   'Reyee ceiling access point for hotels, schools and offices.',
   'https://reyee.ruijie.com/', false, 'Internal omni-directional', '2.4 GHz 2×2 + 5 GHz 2×2',
   'Ruijie Reyee cloud / self-organising network', true, 'Ceiling or wall bracket',
   ARRAY['Reyee units form one network without a separate controller',
     'Powered over the same cable that carries data'],
   ARRAY['RAP6262', 'RG RAP 6262', 'RAP6262G']),
  ('UBIQUITIUAPACMESH', 'UBIQUITI', 'Ubiquiti UAP AC Mesh', 'outdoor', '802.11ac (Wi-Fi 5, AC1200)',
   '2.4 GHz + 5 GHz', '2× 10/100/1000 Mbps', '802.3af PoE or 24 V passive', NULL, NULL,
   'Outdoor mesh unit for covering a yard between buildings.',
   'https://store.ui.com/', false, 'External omni-directional antennas', '2.4 GHz 2×2 + 5 GHz 2×2',
   'UniFi Network controller', true, 'Pole mount, weatherproof',
   ARRAY['Meshes wirelessly with other UniFi units', 'Two Ethernet ports for daisy-chaining'],
   ARRAY['UAP ACMESH', 'UAP-AC-M', 'AC MESH'])
ON CONFLICT (model_key) DO NOTHING;
