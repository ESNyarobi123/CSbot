-- The four rows seeded as unverified have now been checked against the
-- manufacturer datasheets, so the bot may state them without the "team will
-- confirm" hedge. Figures are the ones the manufacturers publish.
UPDATE device_specs SET
  brand = 'Cudy', model = 'AP1300 Outdoor 1.0', deployment = 'outdoor',
  wifi = '802.11ac (Wi-Fi 5, AC1200)', bands = '2.4 GHz + 5 GHz',
  ports = '1× 10/100/1000 Mbps (PoE-in)', poe = '802.3af/at au 48–57 V passive PoE',
  coverage_m = 170, users = 100, verified = true,
  source_url = 'https://www.cudy.com/products/ap1300-outdoor-1-0'
WHERE model_key = device_spec_key('Cudy AP 1300');

UPDATE device_specs SET
  brand = 'Cudy', model = 'AP3000 Outdoor 1.0', deployment = 'outdoor',
  wifi = '802.11ax (Wi-Fi 6, AX3000)', bands = '2.4 GHz + 5 GHz',
  ports = '1× 10/100/1000 Mbps (PoE-in)', poe = '802.3at au 48–57 V passive PoE',
  coverage_m = 320, users = 200, verified = true,
  source_url = 'https://www.cudy.com/products/ap3000-outdoor-1-0'
WHERE model_key = device_spec_key('Cudy AP 3000');

UPDATE device_specs SET
  brand = 'COMFAST', model = 'CF-WA933', deployment = 'outdoor',
  wifi = '802.11ax (Wi-Fi 6, AX3000)', bands = '2.4 GHz + 5.8 GHz',
  ports = '1× 10/100/1000 Mbps WAN (PoE) + 2× 10/100/1000 Mbps LAN',
  poe = '802.3af/at PoE au 12 V DC', users = 200, verified = true,
  notes = 'IP66, antena za ndani 5×4 dBi, 360°. Mtengenezaji hatangazi umbali maalum.',
  source_url = 'https://www.encomfast.com/en_gb/product/ax3000-dual-band-outdoor-high-power-ap/'
WHERE model_key = device_spec_key('COMFAST CF-WA 933');

UPDATE device_specs SET
  brand = 'Ruijie Reyee', model = 'RG-RAP52-OD', deployment = 'outdoor',
  wifi = '802.11ac Wave 2 (Wi-Fi 5, AC1300)', bands = '2.4 GHz + 5 GHz',
  ports = '1× 10/100/1000 Mbps (PoE-in)', poe = '802.3af/at PoE au 24 V passive',
  users = 80, verified = true,
  notes = 'IP65. Mtengenezaji hatangazi umbali maalum; wateja 110 max, 80 inashauriwa.',
  source_url = 'https://reyee.ruijie.com/en-global/products/reyee-wireless/reyee-outdoor-ap/rap52od/'
WHERE model_key = device_spec_key('RG RAP 52 OD');
