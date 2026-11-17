-- Answers to "ina band gani", "ina ports ngapi", "inafikia mita ngapi" need
-- per-model facts, and a shop's fleet grows every week. The catalog description
-- is a single paragraph written for the price list, so the specs live here,
-- keyed by the model with every character that is not a letter or digit removed.
CREATE TABLE device_specs (
  model_key text PRIMARY KEY,
  brand text,
  model text NOT NULL,
  deployment text CHECK (deployment IN ('indoor', 'outdoor', 'both')),
  wifi text,
  bands text,
  ports text,
  poe text,
  coverage_m int CHECK (coverage_m IS NULL OR coverage_m > 0),
  users int CHECK (users IS NULL OR users > 0),
  notes text,
  source_url text,
  -- A row is customer-safe only once someone checked it against the datasheet.
  -- Unverified rows are still used, but the bot says the team will confirm.
  verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The row is looked up by the model the customer named, so the key must be
-- stable and identical for "EAP 650", "eap-650" and "TP-LINK EAP650".
CREATE OR REPLACE FUNCTION device_spec_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

INSERT INTO device_specs (model_key, brand, model, deployment, wifi, bands, ports, poe, coverage_m, users, verified, source_url) VALUES
  (device_spec_key('TP LINK EAP 110'), 'TP-Link', 'EAP110-Outdoor', 'outdoor',
   '802.11n (Wi-Fi 4)', '2.4 GHz', '1× 10/100 Mbps', '802.3af PoE', 100, NULL, true,
   'https://www.tp-link.com/en/business-networking/omada-wifi-outdoor/eap110-outdoor/'),
  (device_spec_key('TP LINK EAP 225'), 'TP-Link', 'EAP225-Outdoor', 'outdoor',
   '802.11ac (Wi-Fi 5, AC1200)', '2.4 GHz + 5 GHz', '1× 10/100/1000 Mbps', '802.3af PoE', 120, NULL, true,
   'https://www.tp-link.com/en/business-networking/omada-wifi-outdoor/eap225-outdoor/'),
  (device_spec_key('TP LINK EAP 610'), 'TP-Link', 'EAP610-Outdoor', 'outdoor',
   '802.11ax (Wi-Fi 6, AX1800)', '2.4 GHz + 5 GHz', '1× 10/100/1000 Mbps', '802.3af/at PoE', 200, NULL, true,
   'https://www.tp-link.com/en/business-networking/omada-wifi-outdoor/eap610-outdoor/'),
  (device_spec_key('TP LINK EAP 650'), 'TP-Link', 'EAP650', NULL,
   '802.11ax (Wi-Fi 6, AX3000)', '2.4 GHz + 5 GHz', '1× 10/100/1000 Mbps', '802.3at PoE', NULL, NULL, true,
   'https://www.tp-link.com/en/business-networking/omada-wifi-ceiling/eap650/'),
  (device_spec_key('MIKROTIK HAP AX2'), 'MikroTik', 'hAP ax² (C53UiG+5HPaxD2HPaxD)', NULL,
   '802.11ax (Wi-Fi 6, dual-band)', '2.4 GHz + 5 GHz', '5× 10/100/1000 Mbps', 'PoE-in 802.3af/at, PoE-out port 5', NULL, 80, true,
   'https://mikrotik.com/product/hap_ax2'),
  (device_spec_key('Cudy AP 1300'), 'Cudy', 'AP1300', NULL,
   '802.11ac (Wi-Fi 5, AC1200)', '2.4 GHz + 5 GHz', NULL, NULL, NULL, NULL, false, NULL),
  (device_spec_key('Cudy AP 3000'), 'Cudy', 'AP3000', NULL,
   '802.11ax (Wi-Fi 6, AX3000)', '2.4 GHz + 5 GHz', NULL, NULL, NULL, NULL, false, NULL),
  (device_spec_key('COMFAST CF-WA 933'), 'COMFAST', 'CF-WA933', 'outdoor',
   '900 Mbps dual-band', '2.4 GHz + 5 GHz', '1× 10/100 Mbps', '802.3af PoE', NULL, NULL, false, NULL),
  (device_spec_key('RG RAP 52 OD'), 'Ruijie Reyee', 'RG-RAP52(OD)', 'outdoor',
   '802.11ac (Wi-Fi 5, AC1300)', '2.4 GHz + 5 GHz', '1× 10/100/1000 Mbps', '802.3af PoE', NULL, NULL, false, NULL)
ON CONFLICT (model_key) DO NOTHING;
