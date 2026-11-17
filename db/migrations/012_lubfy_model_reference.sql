-- Model-level facts that come straight from the code, not from marketing.
-- A reference for advising a customer without inventing a datasheet number.

INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES
('lubfy-model-reference', 'lubfy', 'LubFy — models zinazotajwa kwenye mfumo na tahadhari zake',
$kb$Models zinazotambuliwa moja kwa moja na code ya LubFy:
- MikroTik AX handling (radio/portal ya AX) inatumika kwa boards: hAP ax2, hAP ax3, hAP ax lite, cAP ax, wAP ax. Hii ni detect ya board, si orodha ya pekee ya vifaa vinavyokubaliwa — RouterOS 7 nyingine zinafanya kazi kwa njia ya kawaida.
- Cambium: wizard ya dashboard inataja XV2-21X, XV2-22H na XV2-23T kama reference models. Cambium nyingine inaweza kufanya kazi kama inakubali External Hotspot + RADIUS kwenye cnMaestro/AP UI.
- Cudy: firmware 2.4.x ya Captive Portal ina vikomo (UAM Server haikubali IP, hukata ~51 herufi); tumia /go. Si kila model ya Cudy ina External Portal Server — thibitisha kwenye UI.
- UniFi: External Portal + Network Integration API key kwenye Network Application 9.1.105+; U6/U7/AC APs, gateways na switches zinategemea toleo la Network Application.
- Ruijie/Reyee: WiFiDog; gateway/AP inayokubali WiFiDog pekee. WISPr quota enforcement haijathibitishwa.
- Omada: controller-managed (EAP + ER + switches); portal na authorize zinaishi Omada Controller.

Tahadhari za MikroTik: hAP lite (32MB RAM/16MB flash) ni dhaifu — usiweke portal kubwa au CAPPORT; hAP ac lite inafanya kazi lakini inabaki HTTP (si CAPPORT). CAPPORT/option 114 inarukwa kwa smips na RAM chini ya 128MB.

Specs kamili (CPU, RAM, radio rate, antenna, PoE) hazipatikani kwa kuaminika kutoka code — thibitisha datasheet ya vendor kabla ya kuahidi. Ushauri wa uchaguzi: idadi ya watumiaji kwa wakati mmoja, indoor/outdoor, PoE na backhaul.$kb$,
'lubfy models model reference mikrotik hap ax2 ax3 ax lite cap ax wap ax cambium xv2-21x xv2-22h xv2-23t cudy unifi ruijie omada specs caution',
NULL, true)
ON CONFLICT (id) DO UPDATE SET system=EXCLUDED.system,title=EXCLUDED.title,content=EXCLUDED.content,
  tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,published=EXCLUDED.published,updated_at=now();
