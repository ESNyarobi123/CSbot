-- System knowledge pack: WoteFy (SSDomada) and LubFy, written from the two
-- codebases on 2026-11-17. Idempotent: re-running the app updates each entry.
-- Content is deliberately customer-safe: no secrets, no invented prices, and
-- every model claim that can drift points at the datasheet/controller.

INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES

-- ============================ WOTEFY ============================
('wotefy-overview', 'wotefy', 'WoteFy — mfumo mzima (SSDomada)',
$kb$WoteFy (jina la zamani SSDomada) ni SaaS ya kuuza Wi-Fi kwa captive portal, inayotumia TP-Link Omada Controller. Mtiririko: reseller anasajili -> anachagua plan -> anaunda site -> anaunganisha Access Point kwenye Omada (Inform URL) -> anaunda SSID wazi -> anaunda packages -> mgeni anaunganisha Wi-Fi, portal inafunguka, analipa kwa mobile money (Snippe) au voucher -> RADIUS + Omada authorization -> internet inafunguka -> pesa inaingia wallet ya reseller, kisha withdrawal.

Sehemu kuu: dashboard ya reseller (sites, devices, SSIDs, packages, vouchers, sessions, reports, wallet), dashboard ya admin (resellers, payments, payouts, plans, Omada health, finance), portal ya mgeni yenye brand ya reseller, API docs, na app ya Android/iOS kwa reseller.

Mfumo ni Omada-only: haisimamii MikroTik. Mteja mwenye MikroTik anahitaji LubFy. Vifaa vinavyohusika: Omada EAP (access points), Omada gateway (ER-series) na switch za Omada zinapoweza kusimamia DHCP/LAN, pamoja na Omada Controller (cloud au on-premise).

Msaada wa haraka: https://ssdomada.site, hali ya huduma https://ssdomada.site/status.$kb$,
'wotefy ssdomada overview mfumo wifi hotspot omada captive portal reseller voucher mobile money wallet features jinsi inavyofanya kazi',
'https://ssdomada.site', true),

('wotefy-plans', 'wotefy', 'WoteFy — plans na mipaka',
$kb$WoteFy ina tiers za subscription: SSD Starter (bure, jaribio la siku 7), SSD Growth, SSD Power na SSD Ultra. Kila plan ina mipaka ya maxSites, maxDevices, maxStaff na features kama vouchers na white-label/custom domain. Vouchers zinaruhusiwa kuanzia Growth. Custom domain ni feature ya juu na setup yake inahitaji admin.

Bei za sasa zinasomwa moja kwa moja kutoka mfumo (plans tool); usikariri bei ya zamani. Trial ya Starter ni siku 7; baada ya trial, plan inahitaji malipo ili kuendelea. Plan inapoisha, site/device zinaweza kuzuiwa lakini data haifutwi mara moja.

Reseller anayelipa anaona plan yake kwenye dashboard; withdrawal ina fee fixed TZS 2,500 kwa kila withdrawal (kama ilivyowekwa kwenye settings) na minimum inaonekana kwenye dashboard. Commission ya platform kwa default ni 0%; mabadiliko yake ni setting ya admin, si jambo la kumwahidi mteja.$kb$,
'wotefy plans bei subscription starter growth power ultra trial siku 7 voucher withdrawal commission',
'https://ssdomada.site/pricing', true),

('wotefy-onboarding', 'wotefy', 'WoteFy — kujiunga na kuanza kuuza (hatua kwa hatua)',
$kb$Hatua za kuanza WoteFy:
1) Sajili kwenye https://ssdomada.site/register kwa email; OTP ya email inathibitisha akaunti. Unaweza kuingia kwa Google.
2) Chagua plan (Starter bure kwa siku 7 au plan ya kulipia).
3) Jaza jina la biashara (companyName) na brand slug; mfumo unaunda site ya kwanza kwenye Omada kiotomatiki (best-effort).
4) Weka Access Point kwenye mtandao, kisha weka Inform URL ya kifaa: server.ssdomada.site (kwenye EAP: tplinkeap.net -> System -> Controller Settings -> Inform URL). Hii ni hatua ya mkono; WoteFy haiandiki Inform URL.
5) Subiri kifaa kionekane kwenye Controller, kisha dashboard -> Devices -> Add device (MAC) -> Adopt. Kifaa kinakuwa ONLINE.
6) Unda SSID ya wageni BILA password (open) kwa site husika. SSID inatumwa Omada na kuunganishwa na portal.
7) Unda packages (bei, muda, speed, data, idadi ya devices) na vouchers kama plan inaruhusu.
8) Panga brand ya portal (logo, rangi, karibu) na ujaribu kwa simu: unganisha SSID -> portal -> lipa au voucher -> internet.

Ukikwama kwenye hatua yoyote, tuma tatizo, mfumo (WoteFy) na email ya akaunti.$kb$,
'wotefy onboarding register signup setup install inform url adopt ssid package voucher portal steps jinsi ya kuanza',
'https://ssdomada.site/docs', true),

('wotefy-guest-flow', 'wotefy', 'WoteFy — safari ya mgeni kwenye portal',
$kb$Mgeni anapounganisha SSID wazi, Omada inampeleka External Portal URL ya reseller: https://ssdomada.site/portal/{brandSlug}. Portal inaonyesha packages za site, vouchers na (kama ipo) trial. Mgeni akichagua package, portal inaomba malipo ya mobile money kupitia Snippe (STK push kwenye simu), au anaweka voucher code.

Malipo yakikamilika, mfumo unam-authorize mgeni kwenye Omada (authType 4 External Portal) na FreeRADIUS, kisha internet inafunguka. Session inaisha kwa muda, data, au kick. Mgeni anaweza kuona muda/data iliyobaki kwenye portal au kwa kuingia tena.

Portal ina API ya RFC 8908 kwa brand: GET https://ssdomada.site/api/portal/{brandSlug}/captive (application/captive+json), lakini WoteFy haiandiki DHCP option 114 kwenye LAN za Omada; simu nyingi zinaendelea kutumia HTTP probes.

Brand slug ndiyo inayoamua URL; kubadilisha jina la brand hakubadilishi URL hadi admin abadilishe slug.$kb$,
'wotefy portal guest mgeni login package voucher stk snippe payment captive rfc8908 brand slug',
'https://ssdomada.site', true),

('wotefy-omada-setup', 'wotefy', 'WoteFy — kuunganisha Omada vizuri',
$kb$WoteFy inahitaji Omada Controller inayofikiwa na server na EAP. Mambo ya kuhakikisha:
- Site ya WoteFy ina omadaSiteId. Kama haipo, dashboard inaweza kuunda/heal; ukiona site haijalink, tumia sync.
- SSID ya portal ni OPEN (bila password) na ina omadaSsidId. SSID yenye password haiunganishwi kwenye portal na sync-portal.
- Portal profile kwenye Omada iwe External Portal Server, URL https://ssdomada.site/portal/{brandSlug}. SSDomada huunda/rekebisha profile kiotomatiki inapowezekana, lakini controller yenye toleo tofauti inaweza kuhitaji Admin UI.
- Pre-Authentication Access (walled garden) iwe na host za ssdomada.site, controller, na checkout za Snippe. USIONGEZE probe hosts za Google/Apple/Microsoft (connectivitycheck.gstatic.com, captive.apple.com, msftconnecttest) — zinafanya simu zidhani mtandao uko online na kukosa sign-in sheet.
- Inform URL ya EAP inabaki kwenye kifaa: server.ssdomada.site.

Baada ya kuongeza SSID mpya wazi, endesha tena POST /api/v1/reseller/omada/sync-portal (Bearer token) ili kuambatanisha portal na kuandika pre-auth. Rejesho la API linaonyesha portalUrl na openSsidNames; hakikisha zinaendana.

Controller inaweza kurudisha -1505 ikiwa app ya API haijapewa site au site ilifutwa; angalia Omada health. Hii si shida ya portal pekee.$kb$,
'wotefy omada controller site ssid portal external radius preauth walled garden inform url sync-portal adopt -1505',
'https://ssdomada.site/docs/captive-preauth-allowlist', true),

('wotefy-payments-troubleshoot', 'wotefy', 'WoteFy — malipo yameshindikana au yanasubiri (troubleshooting)',
$kb$Dalili: mgeni ameweka namba, STK haiji/imekataliwa, au ameilipa lakini internet haijafunguka.

Hatua za kwanza (mteja):
1) Hakikisha namba ni sahihi, ni ya mtandao unaotumika, na ina salio la kutosha.
2) Kama STK ilikataliwa: usirudie mara nyingi kwa dakika moja; subiri sekunde 60, kisha jaribu mara moja. Kurudia haraka kunasababisha push ya pili kukataliwa wakati ya kwanza ilifanikiwa.
3) Kama pesa imetoka: chukua SMS/reference ya malipo na uitume kwa support pamoja na email ya akaunti.
4) Kama portal inasema "Payment expired": muamala uliisha (mara nyingi baada ya dakika 60) — jaribu tena, hakuna malipo ya mara mbili kama yalikamilika.

Sababu za kawaida: salio dogo, PIN isiyo sahihi, mteja ameghairi, mtandao umekataa ombi ("rejected by the network"), au provider haikuthibitisha malipo kwa muda. Malipo ya PENDING huchunguzwa kila dakika na kufungwa kama "expired" baada ya muda; hii si pesa iliyopotea.

Timu ya WoteFy inaweza kuangalia payment kwa reference/email na kum-authorize mgeni kwa mkono ikiwa malipo yalikamilika. Mteja asihamishie pesa kwa namba nyingine bila kuthibitisha na support.$kb$,
'wotefy payment malipo failed pending expired rejected stk snippe mpesa airtel nimelipa hakuna internet troubleshooting',
NULL, true),

('wotefy-portal-troubleshoot', 'wotefy', 'WoteFy — portal haifunguki / sign-in haitokei',
$kb$Hatua kwa mpangilio:
1) Hakikisha mgeni yuko kwenye SSID ya portal (OPEN, si SSID ya password) na ameondoa "private/random MAC" kama simu inarudia kuingia bila portal.
2) Fungua browser na ujaribu https://ssdomada.site/portal/{brandSlug} moja kwa moja. Ikifunguka, portal iko sawa na shida ni redirect/probes. Isipofunguka, angalia DNS/internet ya kifaa.
3) Kwenye Omada: External Portal URL iwe https (si http), SSID iwe imeunganishwa kwenye portal profile, na portal profile iwe enabled kwenye site.
4) Ondoa probe domains kwenye Pre-Authentication Access (Google/Apple/Microsoft). Zikibaki, simu inaweza kuamua mtandao uko online na kukosa sign-in sheet, au kuonyesha ukurasa mtupu.
5) Ruhusu host za ssdomada.site, controller, api.snippe.co.tz/api.snippe.sh (kama checkout inafunguliwa browser) kwenye walled garden.
6) Futa cache ya browser au jaribu kwa browser nyingine; Android mara nyingi inahitaji "Forget network" kisha kuunganisha tena.
7) Kama bado, endesha sync-portal na urudie jaribio.

Ikiwa portal inafunguka lakini hakuna packages, angalia packages za site na plan. Ikiwa inafunguka lakini voucher inakataliwa, angalia voucher batch, expiry na site.$kb$,
'wotefy portal haifunguki sign in captive blank page redirect omada ssid preauth probes troubleshooting browser forget network',
NULL, true),

('wotefy-device-offline', 'wotefy', 'WoteFy — kifaa kiko PENDING/OFFLINE au hakionekani Omada',
$kb$Maana ya hali: PENDING = rekodi imeundwa WoteFy lakini Controller haijakiona/kumuadopt; OFFLINE = ilikuwa imeadoptiwa lakini haionekani sasa; ONLINE = imeadoptiwa na inaonekana.

Hatua:
1) Hakikisha kifaa kina IP kwenye LAN na kinawasiliana na internet; EAP inahitaji DHCP.
2) Weka Inform URL kwenye kifaa: server.ssdomada.site. Kwenye EAP: tplinkeap.net -> System -> Controller Settings. Kwenye gateway/switch angalia Controller Settings ya kifaa.
3) Subiri dakika 1-3; kisha Omada Controller -> Devices -> Pending. Kifaa kikionekana, dashboard -> Devices -> Retry adopt (au Add device na MAC).
4) Adopt ikikataa, hakikisha MAC imeandikwa kwa format sahihi na kifaa ni cha Omada (EAP/gateway/switch), si cha brand nyingine.
5) Kama Controller inasema -1505 (permission), admin anahitaji kumpa app ya API ruhusa ya site husika; kama site haipo, site inahitaji kuundwa upya.
6) Kifaa kikionekana Omada lakini WoteFy haionyeshi ONLINE, tumia sync/refresh; sync ya devices inasasisha status, IP, model na firmware.

Kifaa kilichoadoptiwa hakipokei portal/SSID kiotomatiki wakati wa kuadopt — portal na SSID huundwa nyakati nyingine (SSID create / sync-portal).$kb$,
'wotefy device kifaa offline pending adopt inform url omada eap gateway switch mac -1505 sync',
NULL, true),

('wotefy-speed-data', 'wotefy', 'WoteFy — speed limit na data hazitekelezwi',
$kb$WoteFy inatumia njia mbili: EAP wireless inatumia client rate limit ya Omada (down/up tofauti); wired (gateway/switch) inatumia Bandwidth Control rule inayolingana na private LAN IPv4 ya mgeni.

Mambo ya kujua:
- Speed limit inahitaji mgeni aonekane kwenye Controller na IP yake ya LAN. Mgeni aliye nyuma ya router nyingine anaonekana kwa IP ya router/NAT, hivyo hawezi kudhibitiwa kwa package yake.
- Controller ina kikomo cha slots za rate limit (controller-wide, si per site); kila kikomo kinachowekwa kinachukua slot. Slot zinaweza kujaa na kuleta -41008.
- DHCP lease ikibadilika, rule inaweza kukatika hadi heal cron iirekebishe. Hii ni deferral, si kumfunga mgeni aliyelipa.
- Data (GB) inahesabiwa kwa max(FreeRADIUS accounting, Omada counters), haijumlishwi mara mbili. Counter za Omada ni per session, zinaanza upya mgeni akireconnect.
- "This month" inajumlisha EAP na wired tangu snapshot zimeanza kufunika clients wote.

Hatua: kama mgeni anasema speed ni kubwa/ndogo kuliko package, chukua MAC, site, package na muda; timu inaangalia rate limit row na slot pressure. Usimwambie mgeni "amefungiwa" kama bado yuko online — mara nyingi ni limit ambayo haijaapply.$kb$,
'wotefy speed limit data gb rate limit omada bandwidth control fail-open -41008 quota accounting troubleshooting',
NULL, true),

('wotefy-agent', 'wotefy', 'WoteFy — Agent (application, onboarding na commission)',
$kb$Agent ni channel ya mauzo na installation, SI akaunti ya reseller. Mtu anayeomba agent anajaza fomu ya umma: https://ssdomada.site/agent-apply (jina, email, nchi/region, simu, password, na TP-Link email ya hiari kwa Omada Cloud). Fomu inatuma POST /api/v1/agents/apply.

Baada ya kuwasilisha: application inakuwa PENDING; admin anaisoma na kuidhinisha au kuikataa. Ukiidhinishwa unaweza kuingia kwenye /agent. Ufikiaji wa Omada Cloud hutolewa kando na admin (anakualika kwa TP-Link ID); login ya WoteFy ni tofauti na TP-Link.

Agent anaweza kualika reseller kwa referral code/invitation, kuona resellers wake, commissions, wallet na kuomba withdrawal. Commission inaweza kuwa PENDING -> CLEARING -> AVAILABLE; withdrawal inahitaji approval ya admin. Agent hawezi kubadilisha bei za platform.

Shida za kawaida: application haijaidhinishwa (subiri admin), hawezi kuingia Omada (bado hakualikwa), referral code haikubaliwi (uhakikishe umeidhinishwa), commission haionekani (subiri malipo yakamilike na admin kuisogeza).$kb$,
'wotefy agent apply application approval referral code commission wallet withdrawal omada cloud invite onboarding',
'https://ssdomada.site/agent-apply', true),

('wotefy-api', 'wotefy', 'WoteFy — API na URLs za developer',
$kb$Nyaraka za API: https://ssdomada.site/docs. Tabs nne: Reseller API, Admin API, Portal & Cron, Auth & Public. OpenAPI JSON: /api/docs/reseller, /api/v1/admin/docs, /api/docs/portal, /api/docs/platform.

Uthibitisho: web inatumia cookie ya session; mobile/API inatumia Authorization: Bearer <token> inayopatikana kwa login. Usitume token kwa mtu mwingine.

Endpoints muhimu: POST /api/v1/auth (register/login), /api/v1/reseller/sites, /api/v1/reseller/ssids, /api/v1/reseller/devices (na PATCH [id] action adopt), /api/v1/reseller/omada/sync-portal, /api/v1/reseller/packages, /api/v1/reseller/vouchers, /api/v1/reseller/sessions, /api/v1/reseller/wallet, na portal: /api/portal/{brandSlug}/pay, /redeem-voucher, /status, /captive.

Mfano wa sync-portal:
curl -sS -X POST "https://ssdomada.site/api/v1/reseller/omada/sync-portal" -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{}'
Body ya hiari: {"siteId":"<cuid>"} kwa site moja.

Cron endpoints zinahitaji CRON_SECRET na hazitumiki kwa mteja. Ukiwa na shida ya API, tuma endpoint, status code, na muda.$kb$,
'wotefy api docs swagger openapi rest endpoint bearer token sync-portal curl developer integration',
'https://ssdomada.site/docs', true),

('wotefy-account', 'wotefy', 'WoteFy — akaunti, password, withdrawal na lifecycle',
$kb$Kuingia: https://ssdomada.site/login. Kusahau password: tumia "Forgot password" na email ya akaunti; utapokea link/OTP. OTP ya usajili inaweza kuchelewa au kuzuiwa na provider wa email — jaribu tena baada ya dakika chache na angalia spam.

Withdrawal: reseller anaomba kutoka wallet; admin anaidhinisha, kisha malipo yanafanywa kwa Snippe au manual. Withdrawal fee ni fixed (kwa sasa TZS 2,500) na minimum inaonekana kwenye dashboard. Withdrawal inaweza kukataliwa ikiwa wallet haitoshi au taarifa za malipo si sahihi.

Reseller account lifecycle: kwanza warning (in-app/push, inaghairika kwa login/activity), kisha archive (login inazimwa, DB na Omada sites zinabaki), kisha purge (si default; inahitaji checks na ruhusa maalum). Wallet balance, withdrawals zilizo wazi, plan iliyopo au device iliyoonwa hivi karibuni zinazuia purge. Akaunti yenye historia ya fedha inalindwa.

Kufuta akaunti: https://ssdomada.site/delete-account. Kwa mabadiliko ya email/biashara, tuma kwa support na uthibitisho wa umiliki.$kb$,
'wotefy account login password forgot otp email withdrawal wallet lifecycle archive purge delete account',
'https://ssdomada.site/delete-account', true),

('wotefy-devices', 'wotefy', 'WoteFy — vifaa vinavyofanya kazi (Omada)',
$kb$WoteFy inafanya kazi na vifaa vya TP-Link Omada vinavyosimamiwa na Controller:
- Access points: families za EAP (EAP2xx ni Wi-Fi 5, EAP6xx ni Wi-Fi 6, EAP7xx ni Wi-Fi 7). Kuna indoor ceiling, wall-plate na outdoor models (mf. EAP225-Outdoor, EAP610-Outdoor). EAP ndiyo inayoonyesha SSID ya wageni na kupeleka kwenye portal.
- Gateways/routers: ER-series (mf. ER605, ER7206, ER8411). Zinatumika kwa DHCP/LAN, wired guests na Bandwidth Control; portal yenyewe ni ya Omada.
- Switches: switch za Omada (SG/TL-SG families), zikiwa na PoE kwa EAP. Switch peke yake haidhibiti speed ya mgeni; gateway rule inafanya kazi hiyo.
- Controller: Omada Controller (cloud au on-premise) ndiyo ubongo; WoteFy inazungumza nayo kwa OpenAPI na Admin API.

Uchaguzi: hesabu watumiaji kwa wakati mmoja, eneo (indoor/outdoor), ukuta/floor, na kama unahitaji Wi-Fi 6/7. EAP moja ya kisasa inatosha kwa shop ndogo; eneo kubwa linahitaji EAP kadhaa zenye backhaul ya cable/PoE. Kwa gateway, hakikisha ina ports za kutosha na inaweza kufanya DHCP kwa guest VLAN.

Specs kamili (radio rates, antennas, PoE budget, RAM) zinategemea model na firmware — thibitisha kwenye datasheet ya TP-Link kabla ya kuahidi kitu kwa mteja. WoteFy haisimamii MikroTik/Cudy/UniFi; hizo ni LubFy.$kb$,
'wotefy devices vifaa omada eap eap225 eap610 eap650 eap670 er605 er7206 er8411 switch poe wifi5 wifi6 wifi7 specs selection',
'https://www.tp-link.com/en/omada/', true),

-- ============================ LUBFY ============================
('lubfy-overview', 'lubfy', 'LubFy — mfumo mzima',
$kb$LubFy ni cloud control plane ya biashara ya Wi-Fi hotspot yenye tenants wengi: organizations (resellers), sites, routers, packages, vouchers, captive portals, payments (Snippe), sessions, RADIUS (FreeRADIUS kwa HotSpot) na commission za agents. Backend ni Go + PostgreSQL + Redis + FreeRADIUS; dashboards ziko kwa /reseller, /agent na /admin.

Mtiririko: reseller anasajili organization -> anaunda site -> anaongeza router -> anachukua enrollment token -> kifaa kinaenda kwenye LubFy -> anaunda packages/vouchers -> mgeni anaunganisha Wi-Fi -> portal https://lubfy.online/p/{siteId} -> kulipia au voucher -> RADIUS authorization -> internet.

Vendors: MIKROTIK (install/apply scripts, WireGuard), CUDY, RUIJIE/Reyee (WiFiDog), UNIFI (External Portal + Network Integration API), CAMBIUM (cnMaestro/AP), na OMADA (controller-managed). MikroTik pekee ndiyo inayopokea install.rsc/apply.rsc; wengine wanapata field values za kuandika kwenye kifaa/controller.

URLs: api https://api.lubfy.online, dashboard https://lubfy.online. Health: GET /healthz (liveness), /readyz (DB+Redis).$kb$,
'lubfy overview mfumo wifi hotspot mikrotik cudy unifi ruijie cambium omada reseller agent site router package voucher radius architecture',
'https://lubfy.online', true),

('lubfy-vendors', 'lubfy', 'LubFy — vendors na kile kinachotumwa kwa kila mmoja',
$kb$LubFy ina vendors sita; usichukulie kuwa kila vendor anafanya kitu kimoja:
- MIKROTIK: inapata install.rsc na apply.rsc, bootstrap paste, WireGuard management, schedulers (apply 2m, heartbeat 5m, hosts 1m), portal HTML kwenye flash. Hii ni vendor pekee yenye remote apply.
- CUDY: hakuna install.rsc. Unapata guest access values: External Portal Server, Captive Portal Domain, Portal URL (https://lubfy.online/p/{siteId}), UAM Server https://lubfy.online/go, RADIUS host/ports/secret/NAS ID, UAM Allowed na UAM Domain, lease minutes, CoA 3799.
- UNIFI: External Portal host (host pekee, si URL) + path /guest/s/<unifi site>/; guest authorize kwa Network Integration API key kwenye Network Application 9.1.105+ (si api.ui.com Site API).
- RUIJIE/Reyee: WiFiDog URLs /login/, /portal/, /auth/, /ping/ chini ya service base ya router; unahitaji device MAC na serial.
- CAMBIUM: External Page URL na login handoff; cnMaestro Cloud/On-Premise au AP ya mkono; haitumii controller API ya LubFy.
- OMADA: controller-managed; EAP inaadoptiwa kwenye Omada Controller, guest SSID + External Portal profile huko, na LubFy ina-authorize kwa controller.

Ushauri: mteja mwenye MikroTik aende MikroTik; mwenye Cudy aende Cudy; mwenye UniFi/Ruijie/Cambium/Omada aende vendor yake. Usimwambie mteja "LubFy itaandika script" kwa vendor asiye MikroTik.$kb$,
'lubfy vendors mikrotik cudy unifi ruijie reyee cambium omada external portal radius wifidog controller support',
'https://lubfy.online', true),

('lubfy-mikrotik-install', 'lubfy', 'LubFy — kufunga MikroTik (hatua kwa hatua)',
$kb$Hatua:
1) Dashboard -> site -> Add router. Chagua vendor MIKROTIK, jaza identity, na uhakikishe router inaweza kufikia internet.
2) Tengeneza enrollment token; utapata paste fupi: GET https://api.lubfy.online/i/{token} (inatoa l.rsc). Token inaisha baada ya dakika 10 na ni ya mara moja.
3) Kwenye terminal ya RouterOS (WebFig/WinBox/SSH) paste command hiyo. Bootstrap inapakua install.rsc halisi na kuiendesha; usiunganishe `as-value` kwenye faili kubwa.
4) Install inaunda: bridge ya HotSpot, WAN ya DHCP/PPPoE, profile lubfy-hs, portal directories flash/lubfy-hotspot-v28-a|b, RADIUS, DNS static, firewall, na schedulers.
5) Subiri install ikamilike (dakika 2-4). Board inaripoti heartbeat; dashboard inaonyesha phase/status. VERIFIED inahitaji phase=complete na status=verified, si heartbeat pekee.
6) Unda packages na vouchers, kisha jaribu kwa simu: SSID -> portal https://lubfy.online/p/{siteId} -> lipa/voucher -> internet.

Muhimu: portal HTML inakaa kwenye slot ya flash na profile html-directory LAZIMA iwe slot hiyo (si flash/hotspot ya factory). Guest radio (wlan1/wifi1) inahamishwa kwenye HotSpot bridge; CAP off na ap-bridge. Kama DHCP iko kwenye bridge ya factory, LubFy inahamisha DHCP client kwenye ethernet member kabla HotSpot ifunge bridge.

Baada ya install, usibadilishe html-directory kwa mkono; apply inairudisha.$kb$,
'lubfy mikrotik install rsc bootstrap enrollment token wireguard hotspot portal flash html-directory scheduler verified phase complete',
'https://lubfy.online', true),

('lubfy-mikrotik-apply', 'lubfy', 'LubFy — apply, verificication na schedulers',
$kb$Board iliyofungwa ina schedulers: lubfy-apply kila dakika 2, lubfy-heartbeat kila dakika 5, lubfy-hosts kila dakika 1, lubfy-hs-enable kila sekunde 20.

apply.rsc inatengenezwa LIVE kila poll (haifanyiwa freeze). Poll inapakua tail ndogo; full refresh inakuja kwenye dirisha la dakika 30. Body inaweza kuwa na sehemu za WAN, ports, DNS, wireless, hotspot na portal. Sehemu zote ni guarded: hitilafu ya sehemu moja haiwezi kuua /import yote.

Verification: body iliyothibitishwa inaandika revision kwenye faili lubfy.applied; reporter ya lubfy-hosts (kila dakika) inasoma faili, inaita GET /apply-ack?revision=... na kuifuta faili ikiwa imefanikiwa. Ndiyo maana ack inaweza kuchelewa dakika moja baada ya apply.

Marker ni faili lubfy.marker (si global). Off-marker board inapata full body; marker ikilingana, repair inarukwa lakini tail bado inafanya WAN unwrap, guest radio placement na verified re-send. apply_state (queued_start, after_wifi, after_ports, after_dns, verified_<rev>, unverified_<rev>_<sehemu>, fail_<step>) ndiyo breadcrumbs za cloud.

Usibadilishe v34 marker au portal generation kwa marekebisho madogo ya repair; repair-only inatumia hotspotGardenRevision, na login.html CSS inatumia hotspotPortalHTMLGeneration.$kb$,
'lubfy apply ack verified marker apply_state scheduler heartbeat hosts repair portal revision v34 garden revision',
NULL, true),

('lubfy-mikrotik-troubleshoot', 'lubfy', 'LubFy — MikroTik troubleshooting (error codes na hatua)',
$kb$Anza na apply_state ya board kwenye dashboard/report. Kama apply_state haibadiliki kabisa, board haifanyi /import (si kushindwa verification): last_apply_poll_at inaonyesha GET tu. Sababu: /tool fetch kwenda lubfy-apply.next.rsc inashindwa, flash imejaa, au script lubfy-apply imevunjika. Hii inahitaji ziara ya LAN: /log print, /file print, /system resource print, kisha /system script run lubfy-apply.

Error codes:
- INSTALL_DOWNLOAD_FAILED: faili ya install/portal ilifika 0 bytes. Hakikisha API ni HTTP/1.1, hakuna gzip, body ina Content-Length; jaribu tena paste. Bootstrap ya sasa inatumia identity encoding na ukaguzi wa size.
- PORTAL_VERIFY_FAILED: mara nyingi files zipo kwenye slot lakini html-directory bado flash/hotspot. Endesha lubfy-hs-enable; inachukua slot na kuwezesha HotSpot. Si soft reset.
- WG_MGMT_RULE_MISSING: rule ya input ya lubfy-wg haikuweza kuundwa; board inaweza kujibu ICMP na kuhudumia wageni lakini ikakataa input ya tunnel. Admin/reconcile inapaswa kuunda rule; usiiondoe rule iliyopo kabla ya replacement kuthibitika.
- unverified_<rev>_<sehemu>: sehemu imeshindwa. Angalia jina la sehemu (wifi/ports/dns/hotspot/portal) na uangalie menu iliyopo kwenye RouterOS (interface wifi vs wireless hazipo zote kwa board moja).
- Board inaonekana online kwa heartbeat lakini dashboard haisemi VERIFIED: heartbeat ni liveness tu; VERIFIED inahitaji phase=complete&status=verified. Subiri apply ijayo au endesha /system script run lubfy-apply.

Vifaa vya zamani (hAP lite, 32MB RAM, smips) ni dhaifu kwa portal; hAP ac lite inaweza kufanya kazi lakini si kwa CAPPORT/option 114.$kb$,
'lubfy mikrotik troubleshooting error INSTALL_DOWNLOAD_FAILED PORTAL_VERIFY_FAILED WG_MGMT_RULE_MISSING unverified apply_state import fetch flash radio menu verified heartbeat',
NULL, true),

('lubfy-cudy', 'lubfy', 'LubFy — Cudy setup',
$kb$Cudy haitumii script. Dashboard inatoa values za kuandika kwenye Cudy UI (Captive Portal / External Portal):
- Authentication Type: External Portal Server.
- Captive Portal Domain: host ya portal (mf. lubfy.online).
- Portal URL: https://lubfy.online/p/{siteId}.
- UAM Server: https://lubfy.online/go — Cudy firmware 2.4.x inakataa http(s)://, IP na path kwenye baadhi ya fields, na UAM Server inakataa IP na hukata karibu herufi 51; /p/{uuid} haiwezi kupachikwa hapo, ndiyo maana /go inatumika.
- RADIUS: host, auth port, acct port, secret, NAS ID; CoA 3799.
- UAM Allowed: portal/API/Snippe hosts + RADIUS IP. UAM Domain: ongeza host za device-finance MDM (PayJoy, Knox, M-KOPA) ili simu za mkopo ziweze heartbeat kabla ya PAP. USIONGEZE Google Fonts au connectivity-check hosts.
- Lease minutes 1440; tick 2.4G na 5G; local network default 10.1.30.0/24.

Shida za kawaida: portal haifunguki (UAM Server/Portal URL si sahihi au domain haijaruhusiwa), RADIUS timeout (secret/host/port), simu inaonyesha "Saved" (MDM hosts hazipo kwenye UAM Domain), speed haidhibitiwi (CoA 3799 imezuiwa).$kb$,
'lubfy cudy setup external portal uam server radius nas id coa 3799 walled garden mdm payjoy knox m-kopa troubleshooting',
NULL, true),

('lubfy-unifi', 'lubfy', 'LubFy — UniFi setup',
$kb$UniFi haitumii script. Dashboard inatoa External Portal host na path; UniFi inaongeza path yenyewe:
- External Portal Server: host pekee (mf. lubfy.online), si URL.
- Path: /guest/s/<unifi site>/.
- Guest authorize: Network Integration API key (X-API-KEY) kwenye Network Application 9.1.105 au mpya zaidi — si api.ui.com Site API.
- Chagua device type (AP/GATEWAY/SWITCH) na protocol (PORTAL/INVENTORY); device MAC na UniFi site ID vinahitajika.

UniFi inaweza kutumia HTTPS; hakikisha guest anaweza kufikia host na portal. Kama authorize inakataliwa, angalia API key, site ID, na toleo la Network Application. Kama portal haionekani, angalia External Portal host (bila https://) na SSID/network binding kwenye UniFi.

Kwa inventory-only setup, hakuna authorization ya guest — hiyo ni kwa kuonyesha vifaa tu.$kb$,
'lubfy unifi setup external portal host network integration api key 9.1.105 guest site path u6 u7 troubleshooting',
NULL, true),

('lubfy-ruijie', 'lubfy', 'LubFy — Ruijie / Reyee setup',
$kb$Ruijie/Reyee inatumia WiFiDog. LubFy inatoa service base ya router:
- /login/ (login page), /portal/, /auth/ (auth endpoint), /ping/ (heartbeat).
- Unahitaji device MAC na serial ya kifaa; protocol ni WIFIDOG au INVENTORY.
- Weka External Portal/WiFiDog kwenye gateway/AP ukitumia URLs hizo; hakikisha kifaa kinaweza kufikia LubFy kwa HTTP.
- WISPr quota enforcement haijathibitishwa kwa Ruijie; usiahidi data cap ya Ruijie kama enforcement kamili.

Shida: auth inarudia (ping/auth URL isiyo sahihi au serial/MAC isiyolingana), portal haifunguki (WiFiDog haijawashwa au URL haifikiki), kifaa hakiendi online kwenye dashboard (MAC/serial si sahihi).$kb$,
'lubfy ruijie reyee wifidog setup login portal auth ping service url mac serial troubleshooting',
NULL, true),

('lubfy-cambium', 'lubfy', 'LubFy — Cambium setup',
$kb$Cambium ina mitindo mitatu ya usimamizi:
- CNMAESTRO_CLOUD: cnMaestro ya Cambium; haiwezi ku-relay login POST, hivyo browser ya mgeni inazungumza na AP moja kwa moja (http://<ga_srvr>:880/cgi-bin/hotspot_login.cgi).
- CNMAESTRO_ON_PREM: cnMaestro unayoihost; inaweza ku-relay login POST (https://<cnmaestro>/cn-ctlr/ext-guest/ga-ext-login) ikiwa "External Portal Post Through cnMaestro" imewashwa kwenye WLAN.
- LOCAL_AP: UI ya AP yenyewe, handoff kwenda AP:880.

Dashboard inatoa External Page URL na field values; weka WLAN wazi, External Hotspot, na RADIUS. Cambium haina controller API inayotumiwa na LubFy — kila kitu ni configuration unayoandika kwenye cnMaestro/AP.

Shida: login POST inashindwa (handoff si sahihi kwa mode), portal haifunguki (External Page URL), RADIUS timeout, simu inaona "no internet" (walled garden/MDM hosts).$kb$,
'lubfy cambium cnmaestro cloud on-prem local ap external page url handoff radius 880 hotspot_login troubleshooting',
NULL, true),

('lubfy-omada', 'lubfy', 'LubFy — Omada setup',
$kb$Omada ni controller-managed. LubFy haitoi install.rsc: EAP inaadoptiwa kwenye Omada Controller, guest SSID na External Portal profile zinaundwa huko, na LubFy ina-authorize mgeni kwa controller (External Portal auth).
Hatua: adopt EAP -> unda guest SSID (open) -> External Portal profile yenye URL ya LubFy (portal ya site) -> pre-auth/walled garden -> RADIUS/controller authorize -> jaribu kwa simu.
LubFy inaweza kuonyesha vifaa na sessions, lakini ufungaji wa portal unaishi Omada. Kama portal haifunguki, angalia External Portal URL, SSID binding, na walled garden kwenye Omada; kama auth inashindwa, angalia controller API/session.

Usichanganye WoteFy Omada setup na LubFy Omada setup: zote zinatumia Omada, lakini portal URL na controller profile ni za mfumo husika. Mteja wa WoteFy anatumia https://ssdomada.site/portal/{brand}; mteja wa LubFy anatumia https://lubfy.online/p/{siteId}.$kb$,
'lubfy omada controller eap external portal guest ssid adoption radius authorize setup troubleshooting',
NULL, true),

('lubfy-onboarding', 'lubfy', 'LubFy — reseller onboarding na kuuza',
$kb$Hatua:
1) Sajili/kuingia https://lubfy.online; tengeneza organization (jina la biashara).
2) Chagua plan (bei inasomwa live kutoka /v1/plans; usikariri bei).
3) Unda site (eneo) na uongeze router (vendor husika).
4) Kamilisha enrollment/installation ya vendor: MikroTik paste token; wengine andika field values kwenye kifaa/controller.
5) Unda packages: bei, muda, speed down/up, data cap, idadi ya devices.
6) Panga portal: logo, rangi, karibu, na uhakikishe URL https://lubfy.online/p/{siteId} inafunguka.
7) Unda voucher batches kama unauza vouchers; mgeni anaweka code kwenye portal.
8) Jaribu malipo (Snippe) na voucher kwa simu halisi; hakikisha internet inafunguka na session inaonekana dashboard.
9) Angalia reports: sessions, revenue, vouchers, router health.

Shida za kawaida: router haijaenroll (token imeisha/imefutwa), packages hazionekani (site haijachaguliwa), voucher inakataliwa (batch/expiry/site), portal inaonekana lakini malipo hayafunguki (RADIUS/controller authorize).$kb$,
'lubfy onboarding reseller organization site router package voucher portal snippe payment session steps jinsi ya kuanza',
'https://lubfy.online', true),

('lubfy-agent', 'lubfy', 'LubFy — Agent program',
$kb$Agent ni channel ya mauzo: anawasilisha application (POST /v1/agent-applications) ambayo admin (AGENT_ADMIN/SUPER_ADMIN) anaisoma na kuidhinisha au kuikataa. Ukiidhinishwa, agent anaweza kutuma reseller invitations (token ya mara moja, hash pekee huhifadhiwa), na reseller anayekubali invitation anahusishwa na agent kwa mkataba usiobadilika.

Agent anaona commissions na wallet; commission ina state PENDING -> CLEARING -> AVAILABLE. Withdrawal inaomba kwa wallet; admin anaidhinisha, kisha malipo (Snippe/manual) yanafanywa. Concurrent withdrawals zinaserialized kwa agent; rejection inarudisha reservation.

Shida: application PENDING (subiri review), invitation link imeisha (tengeneza mpya), commission haionekani (malipo hayajakamilika/transition haijafanywa), withdrawal imekataliwa (salio/uhalali wa akaunti).$kb$,
'lubfy agent application invitation referral commission wallet withdrawal payout approval onboarding',
'https://lubfy.online', true),

('lubfy-api', 'lubfy', 'LubFy — API na endpoints',
$kb$HTTP contract: api/openapi/lubfy-v1.yaml kwenye repo. Base: https://api.lubfy.online. Health: GET /healthz, GET /readyz (503 kama DB/Redis haipo), GET / (build metadata).

Auth: POST /v1/auth/register, /v1/auth/login, /v1/auth/refresh, /v1/auth/logout; GET /v1/me. Access token ni short-lived; refresh inarotate na reuse inavunja session family. Verification: POST /v1/verification-challenges + /confirm.

Core: organizations, sites, routers, enrollments, installations (POST .../installations, GET .../installations/{id}), inventory, health, packages, portal (GET/PUT), voucher-batches, POST /v1/vouchers/redeem, sessions, hotspot-access/sessions, plans, subscription/pay. Payments: POST /v1/portals/{site_id}/checkout, GET /v1/payments/intents/{id}; webhooks /v1/webhooks/payments/snippe (HMAC SHA-256, timestamp <5 min).

Admin: agent-applications, organizations, agents, devices, withdrawals, transactions, audit-log, commission-rules, plans. Internal RADIUS: /internal/v1/radius/authorize na /accounting (si kwa mteja).

Kama API inarudisha 401, token imeisha: refresh au login tena. 403 = permission scoped (role haitoshi). 409 = state conflict (mf. installation active tayari). 503 kwenye readyz = DB/Redis.$kb$,
'lubfy api endpoints openapi rest authentication bearer token refresh health readyz installation inventory packages vouchers checkout webhook radius',
'https://api.lubfy.online', true),

('lubfy-portal-guest', 'lubfy', 'LubFy — portal ya mgeni, voucher, trial na malipo',
$kb$Portal ya mgeni: https://lubfy.online/p/{siteId}. Inaonyesha packages, voucher redeem, na (kama site inaruhusu) trial. Voucher inatumwa kwa POST /v1/vouchers/redeem; malipo ya package kwa POST /v1/portals/{site_id}/checkout (bei inasomwa DB, si browser) na mgeni anapoll /v1/payments/intents/{id} kwa takriban sekunde 90.

MikroTik: portal HTML iko kwenye slot ya flash; login ni PAP (login-by=mac,http-pap). Trial/voucher/payment zinapeleka form POST kwenye $(link-login-only) -> RADIUS -> session. Payment haipaswi kuwa rubber-stamp: uthibitisho wa malipo unatoka Snippe/webhook, si browser.

Shida: voucher "invalid" (batch/expiry/site), package haionekani (site haijachaguliwa au package imezimwa), malipo hayafunguki (webhook haijafika/RADIUS authorize imeshindwa), portal haifunguki (DNS/host/firewall, au SSID haijapelekwa kwenye bridge ya HotSpot), simu inaona "no internet" (walled garden inazuia portal/API).

CAPPORT/option 114 ni per-router na haijawashwa kwa default; usiahidi HTTPS login ya captive bila router husika kuwa activated na cert halali.$kb$,
'lubfy portal guest voucher trial payment checkout snippe webhook radius pap hotspot walled garden capport 114 troubleshooting',
'https://lubfy.online', true),

('lubfy-devices', 'lubfy', 'LubFy — vifaa vinavyoungwa mkono (mikroTik, Cudy, UniFi, Ruijie, Cambium, Omada)',
$kb$MikroTik (RouterOS 7, HotSpot device-mode): hAP lite (32MB RAM, 2.4GHz, ports 100M) ni dhaifu kwa portal; hAP ac lite (dual-band, ports 100M) inafanya kazi lakini si kwa CAPPORT; hAP ac2 (GbE, dual-band, 128MB RAM) ni ya kawaida kwa hotspot ndogo; hAP ax2/ax3 (Wi-Fi 6, GbE) kwa mzigo wa kisasa; hEX/hEX S (GbE, hakuna radio) kwa routing/switch; RB5009 (7xGbE + 2.5G + SFP+, 1GB RAM) kwa mzigo mkubwa; cAP/wAP kwa ceiling/outdoor; CRS na switch za PoE kwa EAP. Angalia RAM na architecture: smips/RAM <128MB inaachwa kwa CAPPORT.

Cudy: AP/router za Cudy zinazokubali External Portal Server + RADIUS (firmware 2.4.x ina vikomo vya UAM fields). Si kila model ina captive portal ya External Server — thibitisha kwenye UI.

UniFi: U6/U7/AC families za AP, UniFi gateways na switches; unahitaji Network Application 9.1.105+ na API key kwa guest authorize. Ruijie/Reyee: gateway/AP zinazokubali WiFiDog; Ruijie Reyee APs nyingi zina guest portal. Cambium: cnPilot/ePMP/XV families zinazokubali External Hotspot + RADIUS kupitia cnMaestro au AP UI. Omada: EAP2xx/6xx/7xx + ER gateways + Omada switches, controller-managed.

Uchaguzi: hesabu clients kwa wakati mmoja, eneo, PoE budget na backhaul. Specs kamili (radio rate, antenna gain, PoE, RAM) zinategemea model/firmware — thibitisha datasheet kabla ya kuahidi. Kwa MikroTik, hakikisha RAM ya kutosha kwa portal na usiweke mzigo mkubwa kwenye hAP lite.$kb$,
'lubfy devices vifaa mikrotik hap lite hap ac lite hap ac2 hap ax2 hap ax3 hex rb5009 cudy unifi u6 u7 ruijie reyee cambium omada specs selection',
NULL, true),

-- ============================ GENERAL / SUPPORT ============================
('support-flow', 'general', 'Jinsi ya kushughulikia tatizo la mfumo (support intake)',
$kb$Mteja anaposema mfumo wake una shida, bot HAITAKI kubahatisha. Inakusanya vitu vitatu kwa mpangilio:
1) Tatizo: nini kinatokea, na alikuwa anafanya nini.
2) Mfumo: WoteFy au LubFy.
3) Email ya akaunti: ile anayoingia nayo.

Baada ya kupata vyote, bot inatoa hatua za kwanza kutoka knowledge iliyoidhinishwa ya mfumo husika. Kama hakuna knowledge inayolingana, inamkabidhi mteja kwa timu ya msaada pamoja na tatizo, mfumo na email — admin anaona taarifa hizo kwenye alert.

Bot haipaswi: kumwambia mteja "nitarekebisha" bila hatua, kubahatisha sababu, kumtaka password/PIN/OTP, au kumpa bei ya ufungaji badala ya msaada. Mteja akiomba mhudumu, ni handoff.

Taarifa za kukusanya kwa shida ya malipo: namba ya simu iliyotumika, kiasi, muda, reference/SMS, na email. Kwa shida ya kifaa: MAC, model, site, na hali (online/offline/pending).$kb$,
'support troubleshooting msaada tatizo shida intake email mfumo wotefy lubfy handoff escalation malipo kifaa',
NULL, true),

('installation-service', 'general', 'Installation na waya (Type A, Type B, cable)',
$kb$CSolution inatoa installation ya mfumo na waya. Kanuni:
- Type A: mteja ananunua kifaa kwetu; jumla = bei ya kifaa + fee ya installation (+ waya kama anahitaji).
- Type B: mteja anakuja na kifaa chake; jumla = fee ya installation (+ waya), BILA bei ya kifaa.
- Waya inauzwa kwa mita. Mita × bei kwa mita = jumla ya waya. Mita 15 ni mfano wa kawaida, si fixed.
- Installation inalipwa kwa kazi, si kwa kifaa; fee inategemea aina (AP vs gateway) na inaweza kuwa tofauti kwa Type A/B.
- Usikariri bei; soma catalog/POS ya sasa. Ukikosa model, muulize mteja model kabla ya kutoa jumla.
Kwa mfumo: WoteFy ni kwa Omada; LubFy ni kwa MikroTik/Cudy/UniFi/Ruijie/Cambium/Omada. Mteja anayenunua kifaa cha vendor asiye Omada hapaswi kupewa WoteFy.$kb$,
'installation type a type b cable waya mita bei jumla ap gateway service quote csolution omada mikrotik',
NULL, true),

('device-advice', 'general', 'Kushauri mteja kuchagua kifaa',
$kb$Kabla ya kupendekeza kifaa, uliza: eneo (indoor/outdoor, ukuta/floor), idadi ya watumiaji kwa wakati mmoja, eneo la kifaa kwa router, na kama anataka Wi-Fi 5/6/7. Kisha:
- Shop/kiosk ndogo: AP moja ya kisasa (Wi-Fi 6) + router/gateway yenye ports za kutosha; PoE kwa AP.
- Hoteli/hostel: AP kadhaa za ceiling zenye backhaul ya cable/PoE; usitegemee repeater.
- Outdoor: AP ya outdoor yenye IP rating, si AP ya ndani kwenye dirisha.
- Mzigo mkubwa: router yenye RAM/CPU ya kutosha; usiweke hotspot kwenye kifaa cha RAM ndogo.
- Vendors: Omada kwa WoteFy; MikroTik/Cudy/UniFi/Ruijie/Cambium/Omada kwa LubFy. Kifaa cha vendor asiye Omada hakiwezi kutumika WoteFy.
- Hakikisha model ina External Portal/Captive Portal na RADIUS; vinginevyo haitaweza kuunganishwa.
- Specs halisi (radio, antenna, PoE, RAM) thibitisha kwenye datasheet ya vendor; usiahidi throughput halisi wa wireless.
Kama mteja hana uhakika, pendekeza kifaa cha kati kinachojulikana kufanya kazi na mfumo wake, na mwambie atume picha ya label/model.$kb$,
'device advice kuchagua kifaa router ap indoor outdoor poe users wifi 5 6 7 vendor compatibility specs selection',
NULL, true)

ON CONFLICT (id) DO UPDATE SET
  system = EXCLUDED.system,
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  tags = EXCLUDED.tags,
  source_url = EXCLUDED.source_url,
  published = EXCLUDED.published,
  updated_at = now();

-- Internal support notes from the November 2026 production review. Written for
-- the bot so it does not repeat a wrong diagnosis ("wamekataa malipo" vs
-- "provider haijathibitisha") to a paying guest.
INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES
('wotefy-known-issues', 'wotefy', 'WoteFy — matatizo yanayojulikana na tafsiri sahihi',
$kb$Mambo yaliyochunguzwa kwenye production (Nov 2026) na tafsiri yake kwa mteja:
- Malipo mengi kushindikana: kipindi kilichochunguzwa kilionyesha kushindikana kwa zaidi ya nusu ya majaribio. Sababu kuu zilikuwa upande wa provider: "Payment request was rejected by the network", "Payment expired", salio dogo, PIN isiyo sahihi, na mteja kughairi. Hii SI kumaanisha mfumo umepoteza pesa; malipo yaliyokamilika yanathibitishwa kwa reference.
- Duplicate payment (P2002 kwenye portalInitiationId): mteja anayetuma mara mbili alikuwa akipata error. Sasa mfumo unarudisha malipo yaliyopo badala ya kugonga constraint; mteja asirudie kwa haraka bila kusubiri dakika moja.
- Rate limit "fail-open": mgeni asipopatikana kwenye Omada Controller (ameondoka/amezimwa), speed limit haitekelezwi na heal cron inajaribu tena. Hii ni deferral, si kumfunga mteja; usimwambie mgeni "umefungiwa" kama bado yuko online.
- Reconcile inaonyesha "stillPending" nyingi kwa sababu kila malipo ya pending huchunguzwa kila dakika hadi dakika 60; baadaye hufungwa kama expired. Si malipo yanayorudia.
- -1505 kwenye Omada ina maana mbili: app ya API haijapewa site, au site ilifutwa/hamishwa. Kwa hakika angalia Omada health; site isiyopo inahitaji kuundwa upya, si ruhusa tu.
- Observability: logs za app zinaweza kupotea kwenye deploy, na hakuna access log kamili; hivyo usihitimishe "hakuna shida" kwa kutokuna error kwenye log.$kb$,
'wotefy known issues bugs payment failed pending p2002 duplicate rate limit fail-open reconcile -1505 production troubleshooting',
NULL, true)
ON CONFLICT (id) DO UPDATE SET system=EXCLUDED.system,title=EXCLUDED.title,content=EXCLUDED.content,
  tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,published=EXCLUDED.published,updated_at=now();
