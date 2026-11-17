-- Contact facts. Written because the model answered "Nairobi" for an office in
-- Dar es Salaam and invented weekend hours; location and hours must come from
-- this row, never from generation.

INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES
('contact-office', 'general', 'Ofisi, eneo na saa za kazi',
$kb$Ofisi ya Connect Solution iko Sinza Makaburini, Dar es Salaam, Tanzania — karibu na Lantana Hotel, kwenye fremu zenye milango ya kijani. Tunaweza kufika eneo la mteja kwa installation na huduma za ufungaji.

Kwa saa za kazi, ziara ya ofisi, huduma ya wikendi au dharura: hakuna ratiba iliyothibitishwa kwenye mfumo. Mwambie mteja atume siku anayopanga na timu itathibitisha. Usibuni saa za kufungua, siku za kufanya kazi, namba ya simu ya ofisi, wala jina la mtu wa kuwasiliana.

Kwa msaada wa haraka, mteja anaweza kuandika hapa WhatsApp na timu itamjibu; kwa tatizo la mfumo, bot inakusanya tatizo, mfumo (WoteFy/LubFy) na email ya akaunti kwanza.$kb$,
'ofisi office eneo location mahali address sinza makaburini dar es salaam tanzania saa za kazi hours wikendi weekend ziara directions ramani',
NULL, true)
ON CONFLICT (id) DO UPDATE SET system=EXCLUDED.system,title=EXCLUDED.title,content=EXCLUDED.content,
  tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,published=EXCLUDED.published,updated_at=now();
