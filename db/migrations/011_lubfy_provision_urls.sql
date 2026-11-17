-- Exact provision URLs for LubFy, the values a reseller or installer copies.
-- Same rules as 010: idempotent upsert, no secrets, no prices.

INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES
('lubfy-provision-urls', 'lubfy', 'LubFy — URLs za install, apply na portal',
$kb$URLs za provisioning (token ni ya mara moja, inaisha baada ya dakika 10):
- Paste fupi ya kwanza: GET https://api.lubfy.online/i/{token} — inarudisha l.rsc (bootstrap).
- Enroll kamili: GET https://api.lubfy.online/v1/provision/t/{token}/install.rsc — inarudisha lubfy-install.rsc.
- Apply: GET https://api.lubfy.online/v1/provision/t/{token}/apply.rsc — inarudisha apply.rsc inayotengenezwa live.
- Portal HTML: GET https://api.lubfy.online/v1/provision/t/{token}/portal/* — inarudisha faili za portal (login.html n.k.).

Majukwaa: dashboard https://lubfy.online (reseller /reseller, agent /agent, admin /admin). API base https://api.lubfy.online, health GET /healthz na /readyz. Contract ya API iko kwenye api/openapi/lubfy-v1.yaml.

Kumbuka: install/apply zinatumika kwa MikroTik pekee. Cudy, UniFi, Ruijie na Cambium zinapata field values kwenye dashboard, si .rsc. Token ikitumika mara mbili au ikaisha, tengeneza enrollment mpya kwenye dashboard; usitume token ya mtu mwingine.$kb$,
'lubfy provision urls install apply rsc token api bootstrap portal login html endpoint mikrotik',
'https://api.lubfy.online', true)
ON CONFLICT (id) DO UPDATE SET system=EXCLUDED.system,title=EXCLUDED.title,content=EXCLUDED.content,
  tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,published=EXCLUDED.published,updated_at=now();
