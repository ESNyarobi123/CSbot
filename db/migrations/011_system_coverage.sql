-- Geographic availability of WoteFy and LubFy. Both are cloud SaaS with no
-- hard geographic fence: the bot was punting ("thibitisha na timu") and leaking
-- the customer's site size (1 km) into a "does it work across East Africa?"
-- question. These entries give it a factual answer instead.

INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES
('wotefy-coverage', 'wotefy', 'WoteFy — inafanya kazi wapi (East/Central Africa)',
$kb$WoteFy ni cloud SaaS inayopangwa mtandaoni kwa https://ssdomada.site. Hakina kizuizi cha kijiografia kilichojengwa ndani ya mfumo: reseller anajisajili kwa email kutoka nchi yoyote, kisha mfumo unafanya kazi kwenye site yoyote yenye Omada Controller na access points (EAP/gateway/switch za Omada) zilizounganishwa kwenye intaneti.

Kwa hiyo jibu la "WoteFy inafanya kazi East Africa nzima?" ni ndiyo — huduma ipo mtandaoni na portal/malipo hufanya kazi kwenye site yoyote iliyounganishwa kwenye Controller, ndani au nje ya Tanzania. Nchi na sarafu ya packages inachaguliwa na reseller anapounda site na packages zake; hakuna orodha ya nchi iliyofungwa kwenye usajili.

Malipo ya mgeni hupitia mobile money (Snippe) au voucher — angalia wotefy-payments kwa providers zinazotumika na utatuzi. Usiseme WoteFy "haifanyi kazi" nchi fulani kwa sababu tu haijatajwa; nchi inategemea mahali mteja anafunga controller na kifaa chake.$kb$,
'wotefy coverage east africa nchi country region currency sarafu works where operate geographic availability inafanya kazi wapi',
'https://ssdomada.site', true),

('lubfy-coverage', 'lubfy', 'LubFy — inafanya kazi wapi (East/Central Africa)',
$kb$LubFy ni cloud control plane inayopangwa mtandaoni kwa https://lubfy.online (API https://api.lubfy.online). Hakina kizuizi cha kijiografia: reseller anajisajili na kuunda organization/site kutoka nchi yoyote, kisha mfumo unafanya kazi kwenye site yoyote yenye router/controller iliyounganishwa kwenye intaneti (MikroTik, Cudy, UniFi, Ruijie/Reyee, Cambium au Omada).

Kwa hiyo "LubFy inafanya kazi East Africa nzima?" ni ndiyo — huduma ipo mtandaoni na portal/malipo hufanya kazi kwenye site yoyote iliyounganishwa. Nchi na sarafu ya packages inachaguliwa na reseller.

Malipo ya mgeni hupitia mobile money (Snippe) au voucher. Usiseme LubFy "haifanyi kazi" nchi fulani kwa sababu tu haijatajwa; nchi inategemea mahali mteja anafunga kifaa chake.$kb$,
'lubfy coverage east africa nchi country region currency sarafu works where operate geographic availability inafanya kazi wapi',
'https://lubfy.online', true)
ON CONFLICT (id) DO UPDATE SET
  system = EXCLUDED.system,
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  tags = EXCLUDED.tags,
  source_url = EXCLUDED.source_url,
  published = EXCLUDED.published,
  updated_at = now();
