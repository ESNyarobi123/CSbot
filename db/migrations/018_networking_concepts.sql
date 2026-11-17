-- The concepts a good network seller explains.
--
-- Customers ask "access point ni wireless?", "nieleze mesh", "kwanini nahitaji
-- router?" and the bot used to answer with a datasheet or nothing. These are
-- approved, vendor-neutral explanations the answer composer may quote. They
-- deliberately contain no prices and no model claims.

INSERT INTO knowledge (id, system, title, content, tags, source_url, published) VALUES

('wifi-ap-basics', 'general', 'Access point, router na switch — tofauti yao',
$kb$Access point (AP) haitoi intaneti yenyewe: inatoa Wi-Fi kwa simu na laptop, kisha kuunganisha signal hiyo kwenye mtandao kwa waya kwenda kwenye router au switch yenye intaneti. Kwa hiyo AP ya kawaida inahitaji waya mmoja wa data kutoka kwenye router/switch, na umeme (mara nyingi PoE kwenye waya huo huo).
Router ni kifaa kinachoingiza intaneti ya mtoa huduma na kuisambaza kwenye mtandao wako; router nyingi za nyumbani zina Wi-Fi ndani yake, ndiyo maana watu huchanganya na AP.
Switch huongeza ports za waya pekee; haitoi Wi-Fi.
AP inayotumika nje au umbali mkubwa inahitaji mounting, PoE, na mara nyingi antenna/coverage inayofaa eneo la wazi. Kuta, miti na maghorofa hupunguza signal, kwa hiyo idadi ya AP huamuliwa na eneo halisi, si kwa mbali moja tu.
Mfumo wa billing (WoteFy au LubFy) unakaa juu ya vifaa hivi: unakusanya malipo na kudhibiti nani anaweza kutumia Wi-Fi.$kb$,
'access point ap router switch wifi wireless waya poe mtandao intaneti tofauti', NULL, true),

('wifi-mesh', 'general', 'Mesh — Wi-Fi inayoshirikiana kati ya AP',
$kb$Mesh ni mfumo ambapo AP kadhaa za familia moja zinashirikiana kama mtandao mmoja: SSID moja, password moja, na simu inabadilisha AP yenyewe bila kukatika (seamless roaming).
Kuna njia mbili za kuunganisha AP hizo:
1) Wired backhaul: kila AP ina waya kwenda kwenye switch/router. Hii ni ya haraka na imara zaidi, na ndiyo inayotakiwa kwenye hoteli, shule na ofisi yenye waya.
2) Wireless backhaul: AP ya pili inapokea signal kwa wireless kutoka ya kwanza. Hii inaokoa waya lakini kasi hupungua kwa kila hatua, na inahitaji AP ya pili iwe mahali penye signal nzuri.
Mesh haiongei umbali wa AP moja; inaunganisha AP nyingi. Ikiwa eneo ni kubwa au kuna kizuizi, suluhisho ni AP zaidi (au AP ya nje yenye nguvu), si kubadilisha jina la teknolojia.
Mesh inafanya kazi ikiwa AP zote zinatoka kwenye mfumo unaokubali mesh: Omada EAP, Ruijie Reyee, Ubiquiti UniFi, au MikroTik kupitia CAPsMAN/RouterOS. Kuchanganya brand tofauti kwenye mesh moja hakuhakikiwi.
Controller (Omada Controller, Reyee cloud, UniFi controller, CAPsMAN) ndiyo inayosimamia SSID, password, na uhamishaji wa simu kati ya AP.$kb$,
'mesh roaming seamless backhaul controller omada reyee unifi capsmann wifi', NULL, true),

('wifi-coverage-planning', 'general', 'Kupanga idadi ya AP kwa eneo',
$kb$Umbali unaotajwa kwenye datasheet ni wa eneo la wazi (line of sight). Ndani ya nyumba au eneo lenye kuta, miti au maghorofa, umbali halisi huwa mdogo—mara nyingi nusu au chini ya hapo.
Kanuni za kuanzia:
- Eneo dogo la ndani (chumba kimoja hadi nyumba ndogo): AP moja ya ndani inatosha.
- Nyumba yenye vyumba vingi au kuta: AP mbili au zaidi, au mesh yenye wired backhaul.
- Uwanja, bohari, hoteli ya nje: AP ya nje (outdoor) yenye IP rating, na idadi inayotokana na ukubwa wa eneo.
- Eneo la mita 300 la wazi linaweza kuhitaji AP moja ya nje yenye coverage kubwa, au mbili zilizounganishwa ikiwa kuna vizuizi.
Idadi ya watumiaji pia inahesabiwa: AP ya kawaida inashauriwa kwa makumi ya watumiaji kwa wakati mmoja, si mamia. Kwa mkutano mkubwa au hoteli, tumia AP zaidi au model yenye uwezo mkubwa.
Kabla ya kuagiza, ni bora kujua: urefu na upana wa eneo, kuta/ghorofa, idadi ya watumiaji kwa wakati mmoja, na mahali pa kuweka umeme na waya.$kb$,
'coverage umbali planning idadi ya ap eneo kuta watumiaji hotspot', NULL, true),

('poe-power', 'general', 'PoE — umeme kupitia waya wa mtandao',
$kb$PoE (Power over Ethernet) inapeleka umeme na data kwenye waya mmoja wa mtandao, kwa hiyo AP inahitaji waya mmoja tu badala ya waya wa data pamoja na adapta ya umeme.
Viwanja vinavyojulikana: 802.3af (hadi 15.4 W), 802.3at (hadi 30 W), na passive PoE (mara nyingi 24 V au 48 V, haifuati standard).
Kifaa kinachohitaji 802.3at hakitafanya kazi vizuri kwenye port ya 802.3af; kinahitaji switch/injector inayotoa kiwango hicho.
AP nyingi za nje huja na PoE adapter ndani ya box; AP za dari huunganishwa kwenye PoE switch.
Kabla ya kufunga, hakikisha switch au injector ina uwezo wa kutosha kwa AP zote pamoja, si kwa AP moja tu.$kb$,
'poe umeme waya adapter injector switch 802.3af 802.3at passive', NULL, true),

('wifi-controllers', 'general', 'Controller na usimamizi wa AP nyingi',
$kb$Controller ni mfumo unaosimamia AP zote mahali pamoja: SSID, password, packages za billing, na uhamishaji wa simu kati ya AP.
- TP-Link Omada: AP za EAP zinasimamiwa na Omada Controller (local au Omada Cloud). WoteFy inatumia Omada.
- Ruijie Reyee: AP za Reyee zinaunganishwa kwenye Reyee cloud/app; AP moja inaweza kuwa "master" wa nyingine.
- Ubiquiti UniFi: inahitaji UniFi Network controller (local au cloud).
- MikroTik: RouterOS na CAPsMAN husimamia AP za MikroTik.
Kuchanganya brand kwenye controller moja hakuhakikiwa: kama mteja ana controller ya Omada, AP za Omada ndizo zinazofaa zaidi; kama ana MikroTik, LubFy inafaa zaidi.
Controller haitoi Wi-Fi yenyewe; inasimamia AP. Kwa hiyo mteja anahitaji controller pamoja na AP, si moja badala ya nyingine.$kb$,
'controller omada reyee unifi capsmann usimamizi ap nyingi wotefy lubfy', NULL, true)

ON CONFLICT (id) DO NOTHING;
