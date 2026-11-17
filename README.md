# CSolution Bot (CSbot)

Backend ya Connect Solution ya kujibu wateja kwenye namba za WhatsApp zitakazounganishwa. Inashauri kuhusu WoteFy na LubFy, inasoma katalogi na bei za sasa, na inahifadhi mazungumzo na hatua za mauzo.

Tabia za WhatsApp zilizowekwa: blue ticks zinathibitisha ujumbe umepokelewa, mteja huona “anaandika” wakati bot inachakata, na picha ya risiti anayotuma mteja hupelekwa kwa admin pamoja na arifa ya malipo.

Namba zinaungwa kwa **Baileys**, library ya WhatsApp Web inayozungumza protocol ya WhatsApp moja kwa moja kupitia WebSocket, bila browser. Msingi wa muundo ni [baileys.wiki](https://baileys.wiki/): socket moja kwa kila namba, QR au pairing code, presence, read receipts na retry ya connection. Ni library isiyo rasmi, hivyo tumia namba maalum ya biashara na usitume ujumbe wa wingi.

## Huduma za Docker

| Huduma | Kazi |
| --- | --- |
| `api` | NestJS API ya akaunti na pairing, inbox, historia, maarifa, bidhaa, admin na mauzo |
| `whatsapp-gateway` | Baileys: socket moja kwa kila namba, QR au pairing code, kuingiza history, blue ticks, “anaandika”, kuhifadhi picha za wateja na kutuma majibu na arifa |
| `worker` | BullMQ, uchakataji wa ujumbe, Gemini, kutafuta bidhaa na packages, makabidhiano kwa admin na kufuta picha za zamani |
| `postgres` | Chanzo cha kudumu cha inbox, outbox, memory, maarifa na sessions za WhatsApp |
| `redis` | Foleni ya BullMQ ya kuendesha kazi kwa sambamba |
| `migrate` | Inaweka mabadiliko ya schema kabla ya huduma kuanza |

PostgreSQL inaweka ujumbe na outbox kabla ya kuendelea. Worker huunganisha ujumbe mfupi uliotumwa mfululizo, hushughulikia chat moja kwa mpangilio, na huchakata chats tofauti kwa sambamba. Inbox inaweza kupanga kazi tena Redis ikipoteza job. Gateway huweka hali ya `uncertain` ikiwa haijapata uthibitisho wa kutuma. Admin anaweza kuhakiki chat kwenye WhatsApp kabla ya kutuma tena.

Kila huduma ndefu ina healthcheck. Gateway na worker huandika `service_heartbeats` kila sekunde kumi, hivyo `docker compose ps` huonyesha huduma iliyokwama badala ya container inayoonekana “Up” bila kufanya kazi.

## Kuendesha

Tumia Docker Compose na Node.js 22 au mpya zaidi kwa scripts za hapa kwenye kompyuta.

1. Nakili `.env.example` kwenda `.env`. Tengeneza `POSTGRES_PASSWORD` na `ADMIN_API_TOKEN` tofauti kwa `openssl rand -hex 32`. Tengeneza `SESSION_KEY` kwa `openssl rand -base64 32` na ihifadhi kwa usalama pamoja na backup ya database.
2. Weka `GEMINI_API_KEY` na model inayopatikana kwenye akaunti yenu. CSbot hutumia sheria za ndani za Kiswahili na Kiingereza ikiwa key haijawekwa au Gemini haipatikani. Gemini ikitumika, hupokea ujumbe wa karibuni wa chat husika na maarifa yanayohitajika kuandaa jibu.
3. Jenga na washa stack.

```sh
npm run stack -- doctor
npm run stack -- up
npm run stack -- status
curl -fsS http://127.0.0.1:8080/health/ready
```

`npm run stack` ni kifupi cha `node scripts/csbot.mjs`. `doctor` hukagua `.env`, SESSION_KEY na Docker daemon kabla ya kuanza. `up` hujenga image, huendesha migrations na kusubiri huduma zote ziwe healthy.

API inasikiliza kwenye loopback. PostgreSQL na Redis zina volumes za kudumu na zinapatikana ndani ya network ya Compose. Services za worker zinaweza kuongezwa kwa `npm run stack -- scale worker 2`. Gateway moja inamiliki sockets kwa stack nzima.

```sh
npm run stack -- logs worker whatsapp-gateway
npm run stack -- restart whatsapp-gateway
npm run stack -- stop worker
npm run stack -- start worker
npm run stack -- exec api sh
npm run stack -- down
```

Amri za `docker compose` bado zinafanya kazi moja kwa moja ikiwa unahitaji udhibiti wa kina.

## Dashboard ya admin

Fungua [CSbot Admin](http://127.0.0.1:8080/admin) na uingie kwa `ADMIN_API_TOKEN` iliyowekwa kwenye `.env`. Dashboard inatumia API na port ileile ya Docker. Ikiwa umebadilisha `CSBOT_HTTP_PORT`, tumia port hiyo.

1. Fungua **WhatsApp numbers → Add number** na jaza jina la namba. Namba kamili yenye country code ni ya hiari: ukiacha wazi, CSbot itaijifunza kutoka kwenye simu itakayoskani QR.
2. Tumia **QR code** au **Pairing code** kupitia **WhatsApp → Linked devices → Link a device**. QR hujibadilisha kila sekunde 30. Ukitumia pairing code, chagua **Link with phone number** na andika code iliyoonyeshwa. Pairing code inahitaji namba ya akaunti iwe imejazwa.
3. Subiri dashboard ionyeshe **WhatsApp is connected**. Kwa test ya mwisho, tuma `Habari, subscription ya LubFy bei gani?` kutoka simu nyingine kwenda namba iliyounganishwa, kisha angalia jibu na **Open this number’s inbox**.
4. Tumia **Manage → Admin alerts** kuweka namba za arifa kwa akaunti husika. Tumia swichi ya **Replies** kusimamisha au kuendelea na majibu ya akaunti moja.
5. Kwenye **Inbox**, chagua namba unayotaka kuona. **Take over** huweka chat kwenye hali ya admin kujibu na **Enable bot** humruhusu CSbot kuendelea.

Overview inaonyesha takwimu za PostgreSQL na chati ya siku 7 au 30. **Sales**, **Knowledge** na **Products** hutumia rekodi za backend zilizopo.

## Kuunganisha namba yako ya WhatsApp

Namba inaungwa kwa **Baileys** kupitia *Linked devices*. Chagua njia moja:

- **QR** — rahisi ukiwa kwenye kompyuta iliyo na camera au simu karibu.
- **Pairing code** — WhatsApp inatoa code ya herufi nane; inafaa ukiwa mbali na kompyuta.

Amri moja hufanya yote (kusajili akaunti + kuunganisha):

```sh
npm run stack -- link sales +255712345678
npm run stack -- link sales +255712345678 --code
```

Kwa njia ya QR, fungua **WhatsApp → Linked devices → Link a device** na scan QR inayoonekana kwenye terminal. Kwa pairing code, fungua **WhatsApp → Linked devices → Link with phone number**, kisha andika code ile ile iliyoonyeshwa.

Ikihitaji hatua kwa hatua kwa API:

```sh
API="http://127.0.0.1:${CSBOT_HTTP_PORT:-8080}"
curl -fsS -X POST "$API/v1/accounts" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"sales","label":"CSolution Sales","phone":"+255712345678","mode":"baileys"}'

npm run stack -- pair sales          # QR
npm run stack -- pair sales --code   # pairing code

curl -fsS -X PUT "$API/v1/accounts/sales/admin-numbers" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numbers":["+255700000002"]}'
```

**Kujifunza namba kwa QR.** Akaunti ya Baileys inaweza kuundwa bila `phone`. Simu inaposkani QR, gateway inasoma namba halisi kutoka kwenye session, inaiandika kwenye akaunti na dashboard inaonyesha namba hiyo mara moja. Pairing code huhitaji namba iwe imejazwa kwa sababu WhatsApp huunda code kwa namba husika. Ikiwa `phone` ilikuwa imejazwa, gateway hukagua inalingana; isipolingana hali inakuwa `wrong_number`.

**Namba moja kwa mfumo mmoja.** Usiunganishe namba ileile kwenye vifaa viwili au kwenye CSbot mara mbili; WhatsApp inachukua session ya mwisho na ile ya kwanza inawekwa `replaced`. Kurekebisha:

```sh
curl -fsS -X POST "$API/v1/accounts/sales/reset-session" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

Hiyo inafuta credentials zilizosimbwa (bila kufuta historia ya mazungumzo) na kutoa QR/code mpya.

**Jinsi gateway inavyojilinda**

- Socket moja kwa kila namba; gateway moja inamiliki sessions kwa stack nzima kupitia PostgreSQL advisory lock, hivyo `--scale whatsapp-gateway` haitengani session.
- `restartRequired` huunganisha upya papo hapo; makosa mengine hutumia backoff ya 1–60s. `logged_out`, `forbidden` na `connectionReplaced` husimamisha majaribio hadi admin achukue hatua.
- Ujumbe unaotumwa huwekwa `sending` kisha `sent` au `uncertain`. Ukiwa `uncertain`, admin anaweza kuuretry kupitia `POST /v1/outbound/:id/retry` baada ya kuhakiki WhatsApp.
- Groups, status updates na newsletters hupuuzwa (`shouldIgnoreJid`), hivyo inbox inabaki ya mazungumzo ya mtu mmoja.
- Delivery na read receipts hurekebisha `delivered_at` na `read_at` kupitia `messages.update`.
- `syncFullHistory` inaweza kuzimwa kwa `SYNC_FULL_HISTORY=false` ikiwa history kubwa inachelewesha kuanza.

**Kumbuka hatari.** Baileys haihusiani na WhatsApp na haijaidhinishwa nayo. Namba inaweza kufungiwa ikiwa itatumika kutuma ujumbe wa wingi, kwa hiyo tumia namba maalum ya biashara, jibu tu wateja wanaowasiliana, na usikimbie mipaka ya WhatsApp. Session keys huhifadhiwa kwa AES-256-GCM kwenye `whatsapp_auth`; `SESSION_KEY` na backup ya database ni lazima ziende pamoja.

## POS, packages na maarifa

**Katalogi ya CSolution (`/api/csbot`).** CSolution sasa inatoa sehemu ya kusoma tu kwa CSbot, hivyo bei, brand, stock na picha zinasafiri moja kwa moja kutoka duka. Weka token ndefu kwenye `.env` ya CSolution (`CSBOT_CATALOG_TOKEN`, angalau herufi 24, mfano `openssl rand -hex 32`), kisha weka URI sawa na token hiyo kwenye CSbot kama `POS_BASE_URL` na `POS_API_TOKEN`.

| Route ya CSolution | Kazi |
| --- | --- |
| `GET /api/csbot` | Ukaguzi wa haraka: huduma, idadi ya bidhaa na picha |
| `GET /api/csbot/products?search=cat6&limit=60` | Bidhaa zenye `brand`, `category`, `description`, `price`, `agent_price`, `warranty`, `available_to_sell` na `images` |
| `GET /api/csbot/products/:id` | Bidhaa moja na picha zake zote |
| `GET /api/csbot/products/:id/availability` | Stock ya sasa kabla ya kujibu bei |
| `GET /api/csbot/image/:id` | Picha ya bidhaa iliyohifadhiwa CSolution |

Routes zote zinahitaji `Authorization: Bearer <CSBOT_CATALOG_TOKEN>` na hazitoi bidhaa zilizo `active=false`. Picha zilizopakiwa hupiti kwenye `/api/csbot/image/:id`, ambayo ni njia salama kuliko kufungua ukurasa wa CSolution kwa umma. Kwa mfano ukiwa Docker, tumia `POS_BASE_URL=http://host.docker.internal:3085/api/csbot/` ili CSbot ifikie CSolution iliyo kwenye hosti.

**Ukurasa wa Products.** Dashboard sasa inaonyesha kadi za bidhaa zenye picha, brand, SKU, category, bei ya mauzo, warranty na hali ya stock moja kwa moja kutoka CSolution. Kila kadi inafungua maelezo kamili na kitufe cha kunakili jibu la WhatsApp. Kama POS haijaunganishwa, ukurasa unaonyesha rekodi za ndani tu (`PUT /v1/products/:id`) na onyo la kuunganisha catalog.

**Kuhakiki muunganisho.** Kabla ya kuamini dashboard, endesha:

```sh
npm run catalog:check
npm run catalog:check -- https://csolution.yunigo.online/api/csbot/ <token>
```

Script inaonyesha kama API inajibu, idadi ya bidhaa, idadi yenye picha, inapakua picha moja kuthibitisha njia ya picha, na kuorodhesha bidhaa zisizo na picha. `host.docker.internal` hubadilishwa kuwa `127.0.0.1` mara moja ili script ifanye kazi nje ya Docker.

**Jibu la bot.** Mteja akiuliza bidhaa, worker hutafuta kwa jina, SKU au brand, kisha hujibu kwa jina, bei, brand, category, warranty, maelezo mafupi na hali ya stock. Akiomba picha (`picha`, `photo`, `image`), CSbot huambatanisha picha halisi ya bidhaa. CSbot huchagua model inayofanana zaidi na maneno ya mteja, na hutuuliza mteja kuchagua kama bidhaa mbili zinafanana.

**POS ya CSolution (database).** Njia mbadala ni login inayosoma tu. Endesha `psql -v reader=csbot_reader -f integrations/csolution-pos.sql` kwenye database ya POS ukiwa schema owner, kisha weka connection string kwenye `CSOLUTION_POS_DB_URL`. Views zinatoa bidhaa zote zinazouzwa (pamoja na services), brand, category, bei ya retail, `on_hand`, warranty na picha. Picha zilizo kwenye `/api/images/<id>` zinasomwa kupitia view ya picha. URL za nje zinatumia HTTPS na host iliyo kwenye `PRODUCT_IMAGE_HOSTS`.

**POS ya HTTP.** Ikiwa `CSOLUTION_POS_DB_URL` iko wazi, weka `POS_BASE_URL` na token ya kusoma kwenye `POS_API_TOKEN`. `POS_BRANCH_ID` huongezwa kama `branch_id` inapowekwa.

| Ombi | Muundo wa response |
| --- | --- |
| `GET /products?search=WR3000&limit=5` | `{"items":[{"id":"wr3000","name":"Cudy WR3000","sku":"WR3000"}]}` |
| `GET /products/wr3000` | `{"id":"wr3000","name":"Cudy WR3000","price":{"amount":95000,"currency":"TZS"},"images":[{"url":"https://cdn.example.com/wr3000.jpg","primary":true}]}` |
| `GET /products/wr3000/availability` | `{"available_to_sell":5}` |
| `GET /service-plans?system=lubfy&kind=wifi&site=SINZA` | `{"items":[{"name":"Saa 24","price":{"amount":1000,"currency":"TZS"},"billing_period":"DAILY","features":["5 GB"]}]}` |

`kind` inaweza kuwa `subscription`, `wifi` au `bundle`. Packages zinaweza kurudisha `percentage` na `percentage_basis` badala ya `price`, pamoja na `setup_fee`. Bei kwenye mifano ni data ya majaribio. CSbot husoma bei na stock upya kwa bidhaa inayojulikana mteja anapokuwa tayari kulipa.

**Subscriptions za watoa huduma.** Worker inatumia [API ya WoteFy](https://ssdomada.site/api/v1/plans) na [API ya LubFy](https://lubfy.online/v1/public/plans). Futa thamani ya `WOTEFY_PLANS_URL` au `LUBFY_PLANS_URL` ili huduma husika isome subscriptions kutoka `POS_BASE_URL/service-plans`. Kifurushi cha intaneti huuliza hotspot husika na kinatumia API ya HTTP. Vyanzo vya maarifa ya awali vinajumuisha [WoteFy](https://ssdomada.site/), [LubFy](https://lubfy.online/) na maelezo ya ofisi ya CSolution huko Sinza Makaburini.

**Usimamizi wa maudhui.** Weka taarifa rasmi kupitia `PUT /v1/knowledge/:id` kwa `system`, `title`, `content`, `tags`, `sourceUrl` na `published`. Worker hutumia rekodi zilizochapishwa pekee. `PUT /v1/products/:id` huweka `name`, `sku`, `description` na `imageUrl` za katalogi ya ndani. Bei na stock za kujibu wateja hutoka kwenye POS.

## API ya inbox na mauzo

Tuma `Authorization: Bearer <ADMIN_API_TOKEN>` kwa routes za `/v1`.

| Route | Matumizi |
| --- | --- |
| `GET /v1/accounts` | Orodha ya namba na hali ya connection |
| `POST /v1/accounts` | Sajili namba kwa `phone` (hiari kwa QR), `label` na `mode:"baileys"` (au `mode:"mock"` kwa majaribio). Bila `phone`, gateway hujifunza namba kutoka kwenye simu inayoskani |
| `POST /v1/accounts/:id/pairing-code` | Omba pairing code badala ya QR. Gateway huionesha kupitia `GET /pairing` |
| `PATCH /v1/accounts/:id` | Weka `{"enabled":false}` kusimamisha namba |
| `GET /v1/accounts/:id/pairing` | Hali ya session, afya ya gateway na worker, `qrRemainingMs`, `codeRemainingMs` na `qrDataUrl` QR ikiwa hai |
| `GET /v1/catalog?search=cat6&limit=60` | Katalogi halisi ya CSolution: `source`, `price`, `brand`, `category`, `warranty`, `available_to_sell` na `image` |
| `GET /v1/catalog/:id/image` | Picha ya bidhaa kupitia CSbot, hivyo dashboard na WhatsApp hutumia chanzo kimoja |
| `POST /v1/accounts/:id/reset-session` | Tengeneza session mpya na QR ya kuskani tena |
| `GET/PUT /v1/accounts/:id/admin-numbers` | Soma au weka namba za arifa za akaunti hiyo |
| `GET /v1/conversations?account=sales&mode=human&q=cudy` | Foleni ya chats za admin yenye `unread_count`, `last_body` na `last_at`. Pagination inatumia `before` kutoka `cursor_at` na `beforeId` kutoka `id` |
| `PATCH /v1/conversations/:id/read` | Weka `unread_count` kuwa 0 admin akishaifungua chat |
| `GET /v1/conversations/:id` | Memory ya mteja, oda ya mwisho kwenye `sale`, historia ya hatua kwenye `sales`, hali ya ujumbe wa kutoka pamoja na `body`/`image_url`, na orodha ya `media` |
| `GET /v1/conversations/:id/messages?before=100&limit=30` | Historia kwa mpangilio wa ujumbe mpya kwenda wa zamani |
| `PATCH /v1/conversations/:id/mode` | Weka `{"mode":"human"}` au `{"mode":"bot"}` |
| `POST /v1/conversations/:id/messages` | Jibu la admin kupitia `{"text":"…","requestId":"unique-per-reply"}`. `imageUrl` ya HTTPS inaruhusiwa ikiwa host iko kwenye `PRODUCT_IMAGE_HOSTS` |
| `GET /v1/media/:id` | Picha ya mteja kama `dataUrl` kwa ajili ya admin UI |
| `GET /v1/stats` | Idadi ya chats, chats za mhudumu, ujumbe pending, outbox iliyosubiri, `uncertain`, oda zilizo wazi na hali ya kila akaunti |
| `GET /v1/outbound?state=uncertain` | Ujumbe ambao haujathibitishwa au uliobatilishwa, kwa ajili ya kuretry |
| `POST /v1/outbound/:id/retry` | Rudisha ujumbe `uncertain`/`canceled` kwenye foleni. Provider ID ileile hutumika ili WhatsApp isitume mara mbili |
| `GET /v1/conversations/:id/sales?before=100&limit=30` | Orodha ya oda, hatua na bei ya kila oda |
| `GET /v1/conversations/:id/sales/:saleId/events` | Historia ya hatua ya oda husika. Pagination inatumia `before` na `limit` |
| `POST /v1/conversations/:id/sales` | Fungua oda kwa `{"requestId":"id-unique-per-order"}`. Kurudia request ID kunarudisha oda ileile |
| `POST /v1/conversations/:id/sale` | Thibitisha `paid` au `completed` kupitia `{"saleId":"123","stage":"paid","reason":"Verified receipt"}` |
| `GET /v1/knowledge`, `GET /v1/products` | Orodhesha maudhui ya katalogi na maarifa |

Mteja anapoomba maelekezo ya kulipa, chat husogea kwenye `ready_to_pay` na admin anaarifiwa. Mteja akiripoti kuwa amelipa, hatua huwa `payment_reported` hadi admin athibitishe. Arifa zinaonyesha mteja, mada na kiasi kilichotajwa kwenye mazungumzo. Admin akichukua chat, bot husubiri kuruhusiwa kuendelea. Baada ya oda kukamilika, ombi la bei likipata bidhaa au package kwenye katalogi linaweza kufungua oda mpya ikiwa bot imewashwa kwenye chat hiyo. Admin pia anaweza kufungua oda mpya mwenyewe. Rekodi ya bei na arifa za kila oda zinaendelea kupatikana kwenye historia. Tuma `saleId` ya oda unayothibitisha. Inahitajika mara chat inapokuwa na zaidi ya oda moja.

Picha ya mteja huhifadhiwa kwenye table ya `media`. Mteja anaporipoti malipo, picha yake ya mwisho inatumwa kwa admin pamoja na arifa, hivyo mhudumu huona risiti bila kufungua WhatsApp ya mteja. Admin anaweza kuipata kwa `GET /v1/media/:id`. Worker hufuta picha zilizopita siku `MEDIA_RETENTION_DAYS` (default 90).

`memory.profile` huhifadhi maelezo mteja aliyosema wazi kuhusu vifaa anavyotumia, bajeti na matumizi ya mtandao. Maelezo hayo yanaendelea kutumika kwenye oda inayofuata ya chat hiyo. CSbot inasasisha maelezo ya profile mteja anapotoa taarifa mpya inayotambulika.

## Majaribio

`npm test` hujenga TypeScript na kujaribu intent, follow-ups, ufasiri wa kiasi cha packages, uchujaji wa JID za groups na muundo wa namba ya pairing. Stack ya majaribio hutumia namba za mock na POS fixture kwenye project nyingine ya Compose. Smoke test inahakiki pia unread/preview ya inbox, risiti inayopelekwa kwa admin, retry ya ujumbe usiothibitika na `/v1/stats`.

```sh
docker compose build migrate
CSBOT_HTTP_PORT=18080 docker compose -p csbot-test -f compose.yaml -f tests/compose.yaml up -d --wait
node tests/smoke.mjs
docker compose -p csbot-test -f compose.yaml -f tests/compose.yaml down --volumes
```
