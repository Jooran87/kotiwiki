# Kehittäjän käsikirja – Kotiwiki

Tämä dokumentti siirtää projektin hiljaisen tiedon seuraavalle kehittäjälle
tai tekoälyavustajalle. Lue tämä ennen muutosten tekemistä.

## Arkkitehtuuri yhdellä silmäyksellä

```
server.js            Express + REST + kirjautuminen + turvaotsakkeet
db.js                SQLite (better-sqlite3) + skeema + MIGRAATIOT
extract.js           Liitteiden tekstinlouhinta hakua varten (pdf/docx/doc/xlsx)
public/
  index.html         Palvelinversion runko
  app.js             ★ JAETTU käyttöliittymälogiikka (myös sandbox käyttää tätä)
  styles.css         ★ JAETTU ulkoasu (teemat, liquid glass, tulostus)
  store-api.js       Datakerros palvelimelle (REST + auth)
  offline-template.js Offline-HTML:n generaattori (toimii Nodessa JA selaimessa)
  theme-boot.js      Teema ennen renderöintiä (erillinen tiedosto CSP:n takia)
sandbox/
  store-local.js     Datakerros sandboxille (localStorage + IndexedDB, EI authia)
  build-single.js    Kokoaa yhden tiedoston sandboxin (elama-sandbox.html)
koti-routes.js       Varasto + kauppalista + kotityöt + reaaliaikaiset tapahtumat (SSE)
public/koti.js       Varaston, kauppalistan ja kotitöiden näkymät, viivakoodiskanneri, kortit
public/koti-shared.js ★ Kodin toimintojen SÄÄNNÖT (osastot, päivälaskenta, kenttien siivous):
                     sama tiedosto palvelimella (require), selaimessa ja sandboxissa
public/koti.css      Niiden ulkoasu (2a-tokenit)
public/vendor/       zxing.min.js (Apache-2.0), ladataan vain skannatessa
dashboard-sources.js Etusivun ulkoiset lähteet: ajastus, välimuisti (SQLite), GET /api/dashboard
sources/saa.js       Sää Ilmatieteen laitoksen avoimesta datasta (havainnot + ennuste)
sources/sahko.js     Pörssisähkön hinta porssisahko.net-rajapinnasta (vartit tunneiksi)
deploy/              systemd-palvelu ja Caddyfile omalle palvelimelle
tests/               npm test: api (auth+CRUD+turva), sources (sää ja sähkö valepalvelimella),
                     backup, ui (Chromium)
backup.js/restore.js Varmuuskopiointi (VACUUM INTO) ja palautus
seed.js              Esimerkkisisältö (vain tyhjään kantaan)
```

**Tärkein sopimus:** `app.js` puhuu vain `Store`-rajapinnalle. Palvelinversio
ja sandbox eroavat AINOASTAAN siinä, kumpi store ladataan. Uusi ominaisuus =
toteuta molempiin storeihin TAI sandboxiin stub (esim. `Store.auth = null`,
jolloin app.js ohittaa kirjautumisen).

## Dashboard (tämän projektin oma osa)

Pohjaprojektin etusivu oli kiinteä; tässä se on **korttirekisteri**.

- `public/dashboard.js` – runko: `Dashboard.register({...})`, rinnakkainen
  lataus, korttikohtainen virheenkäsittely, piilotus (localStorage).
- `public/cards.js` – kortit. Uusi kortti = yksi `register`-kutsu, etusivun
  koodiin ei kosketa.
- `viewHome()` (app.js) piirtää vain otsikon ja kutsuu `Dashboard.render()`.
- Skriptijärjestys on **koti-shared.js → store → dashboard.js → cards.js → koti.js → app.js**
  sekä index.html:ssä että build-single.js:ssä. Väärä järjestys kaataa käynnistyksen.

**load ja render on erotettu tarkoituksella:** kaikkien korttien datat haetaan
`Promise.all`-rinnakkaisuudella, joten hidas lähde ei jarruta muita, ja
yksittäisen kortin poikkeus jää sen omaan laatikkoon (`.dash-err`).

**Auringonnousu lasketaan paikallisesti** (cards.js, NOAA:n yksinkertaistettu
kaava). Napapiirin pohjoispuolella `cosH` menee yli ±1 – silloin aurinko ei
nouse tai laske lainkaan, ja kortti kertoo sen tekstinä. Tulokset on
varmennettu oikeita aikoja vastaan (Helsinki ja Rovaniemi, kesä ja talvi).

### Ulkoiset lähteet – EI selaimesta

Selain ei ota yhteyttä ulos. Uusi lähde:
`sources/<nimi>.js` → `dashboard-sources.js` ajastaa ja tallentaa SQLiteen
(taulu `dashboard_cache`) → `GET /api/dashboard` → kortin `load`
(`Store.dashboard.get('<nimi>')`). Näin CSP pysyy tiukkana, avaimet
palvelimella, ja lähteen ollessa alhaalla näytetään viimeisin arvo.

- **Lähteen sopimus:** moduuli vie `{ id, intervalMs, fetch }`. `fetch`
  palauttaa JSON-kelpoisen olion tai heittää virheen. Epäonnistunut haku ei
  koske aiempaan dataan: riville kirjataan vain `failed_at` ja virheteksti,
  ja reitti palauttaa `failing: true`. Virheteksti jää palvelimen lokiin,
  selaimelle sitä ei anneta.
- **Lähteen dataan ei luoteta.** `sources/saa.js` poimii XML:stä vain
  tunnetut suureet, kelvolliset aikaleimat ja äärelliset luvut, rajaa
  vastauksen koon (3 Mt) ja keston (15 s). Kortti tarkistaa arvot vielä
  luvuiksi ja escapettaa ne. Testi syöttää korttiin haitallista dataa.
- **Sää (`sources/saa.js`):** Ilmatieteen laitoksen WFS-rajapinta, ei avainta.
  Havainnot `fmi::observations::weather::simple` (lähin asema, Kaisaniemi) ja
  ennuste `fmi::forecast::edited::weather::scandinavia::point::simple`
  (meteorologin tarkistama, 72 h). "NaN" = mittaus puuttuu, jolloin käytetään
  edellistä arvoa. Päivät ja tunnit lasketaan Helsingin ajassa palvelimella
  (`Intl`, `Europe/Helsinki`), koska palvelin voi olla UTC:ssä. Lisenssi
  CC BY 4.0: lähdemaininta on kortin alareunassa, älä poista sitä.
- **Sähkön hinta (`sources/sahko.js`):** `api.porssisahko.net/v2/latest-prices.json`,
  ei avainta. Vastaus on 48 tunnin liukuva ikkuna vartin jaksoina, snt/kWh
  arvonlisäveroineen. Lähde tekee varteista tunteja (tunnin hinta = varttien
  keskiarvo, vartit kulkevat mukana) ja jättää vajaan päivän pois. Kortti
  laskee "hinnan nyt" selaimen kellosta, koska hinta vaihtuu vartin välein,
  sekä päivän keskihinnan, alimman ja ylimmän tunnin ja halvimman tulevan
  kolmen tunnin jakson.
  - **Haku kerran tunnissa, älä tihennä.** Rajapinta on ilmainen, mutta
    jokainen pyyntö maksaa ylläpitäjälle (ehdot: porssisahko.net/api).
  - **Muisti:** kun huomisen hinnat tulevat noin klo 14, ikkunan alku siirtyy
    ja kuluvan päivän klo 00 putoaa vastauksesta. Lähde pitää aiemmin nähdyt
    vartit muistissa (36 h) ja yhdistää ne. Palvelimen uudelleenkäynnistys
    iltapäivällä tyhjentää muistin, jolloin klo 00 puuttuu loppupäivän.
  - **Kelpoisuus:** rivi hylätään, jos hinta ei ole luku väliltä −100 ja 1000
    tai aikaleima ei ole vartin tasalla. Negatiivinen hinta on oikea hinta ja
    piirtyy nollaviivan alle.
  - **Kaavio** on CSS-ruudukko: pylvään korkeus ja nollaviivan paikka tulevat
    tyyliattribuuttina (`--h`, `--b`). Hinnan näkee myös ilman väriä ja
    ilman hiirtä: lukurivi (osoitus, napautus, nuolinäppäimet) ja taulukko.
- **Testit eivät käytä verkkoa.** `tests/sources.test.js` käynnistää
  paikallisen valepalvelimen ja ohjaa haut sinne (`FMI_URL`, `SAHKO_URL`). Rajapintatestit
  ajavat palvelimen asetuksella `ELAMA_SOURCES=off` (ei hakuja lainkaan).
- **Sandbox:** `Store.dashboard.get('saa')` ja `get('sahko')` palauttavat
  esimerkkidatan (`demo: true`), ja kortti kertoo sen käyttäjälle.
- Kehitysympäristö, jossa liikenne kulkee välityspalvelimen kautta: Noden
  oma `fetch` ei lue `HTTPS_PROXY`-muuttujaa ilman `NODE_USE_ENV_PROXY=1`
  (Node 22.21 tai uudempi). Omalla palvelimella tätä ei tarvita.

## Varmuusvarasto, kauppalista ja kotityöt

- **Yhteiset säännöt: `public/koti-shared.js`.** Kaikki, mikä pitää olla
  täsmälleen samoin palvelimella ja sandboxissa (kenttien siivous, osaston
  arvaus, kotityön seuraavan päivän laskenta), on tässä yhdessä tiedostossa.
  Siinä ei saa olla tietokantaa, DOMia eikä verkkoa. Uusi sääntö tänne, ei
  kahteen storeen erikseen.
- **Nimien vertailu aina `nameKey()`llä** (JavaScriptin `toLowerCase`).
  SQLiten `lower()` ei tunne ääkkösiä, joten "JÄÄTELÖ" ja "jäätelö" olisivat
  SQL-vertailussa eri tuote.
- **Tavoitemäärä (`pantry_items.target_qty`, 0 = ei tavoitetta) kuuluu
  tuotteelle, ei riville.** Saman nimiset erät pidetään samassa tavoitteessa
  (`syncTarget`), uusi erä perii tavoitteen. Määrä 0 on sallittu vain
  tavoitteellisella tuotteella: viimeisen kappaleen käyttö jättää silloin
  "loppu"-rivin muistilapuksi (muuten rivi poistuu kuten ennen), ja seuraava
  saman niminen lisäys korvaa sen.
- **Ostoehdotukset lasketaan selaimessa** (`pantrySuggestions` koti.js:ssä)
  varaston ja kauppalistan datasta: alle tavoitteen tai vanhenee 30 pv
  sisällä, eikä tuote ole jo listalla. Ei omaa palvelinreittiä.
- **Kauppalistan osasto (`shopping_items.section`)** on yksi
  `KotiShared.SECTIONS`-listan arvoista; listan järjestys = kaupan
  kiertojärjestys. Uuden rivin osasto (`sectionFor`): 1) käyttäjän aiemmin
  tälle tuotteelle valitsema (`shopping_sections`, sandboxissa
  `DB.shopSections`), 2) varaston kategoria, jos tuote on varastosta tuttu,
  3) arvaus nimestä (`KEYWORDS`: yhdyssanan loppuosa ratkaisee). Arvaus saa
  mennä pieleen, koska käsin tehty korjaus muistetaan.
- **Kotityöt (`chores`)**: `next_due` ja `last_done_at` ovat `YYYY-MM-DD`.
  Kuittaus (`POST /api/chores/:id/done`) asettaa seuraavan kerran
  kuittauspäivästä toistovälin päähän (`addInterval`: kuun loppu ja
  karkausvuosi käsitelty). Selain lähettää oman päivänsä; palvelin hyväksyy
  sen vain, jos ero palvelimen päivään on enintään vuorokausi
  (aikavyöhyke-ero), muuten käytetään palvelimen päivää.

- **Palvelin:** `koti-routes.js` liitetään server.js:ssä portin JÄLKEEN,
  joten kirjautuminen ja roolit (lukija = vain GET) koskevat sitä
  automaattisesti. Taulut `pantry_items`, `pantry_catalog` (viivakoodi →
  nimi + kategoria) ja `shopping_items` luodaan db.js:n migraatiossa.
- **Reaaliaikaisuus:** `GET /api/events` on SSE-virta. Jokainen kirjoitus
  kutsuu `broadcast('pantry' | 'shopping' | 'chores')`; selain hakee listan uudelleen.
  Ei kirjastoja. Keep-alive 25 s välein (`unref`, ei pidä testiajoa
  hengissä). Caddyssa `flush_interval -1`, muuten virta puskuroituu.
- **Selain:** `Store.events.on(tyyppi, fn)` (store-api.js). Sandboxissa
  `Store.events = null` → ei reaaliaikaisuutta, kaikki muu toimii.
  `Koti.listen()` pitää yhden tilauksen kerrallaan ja lopettaa sen, kun
  käyttäjä on siirtynyt toiseen näkymään. Kauppalistan päivitys säilyttää
  kesken olevan kirjoituksen; varasto ei päivity, jos lomake tai kamera on auki.
- **Skanneri:** `getUserMedia` vaatii HTTPS:n tai localhostin. Tunnistus
  ensin selaimen `BarcodeDetector`illa (Chrome/Android), muuten ZXing
  (iPhone Safari). ZXing ladataan dynaamisesti `vendor/zxing.min.js`:stä
  (CSP `script-src 'self'` sallii). Videosta luetaan keskialueen rajaus
  ~220 ms välein. `Permissions-Policy: camera=(self)`.
- Päiväys tallennetaan muodossa `YYYY-MM-DD` ja validoidaan (myös
  olemattomat päivät kuten 30.2. hylätään → tyhjä).
- Testit: e2e-tarkistus oikealla kamerasyötteellä onnistuu Chromiumin
  `--use-file-for-fake-video-capture=<y4m>`-lipulla.

## Palvelin internetissä

`BEHIND_PROXY=1` (deploy/kotiwiki.service): `trust proxy = loopback`, jolloin
kirjautumisrajoitus käyttää `req.ip`:tä (X-Forwarded-For) eikä lukitse
kaikkia kerralla, ja istuntoeväste saa `Secure`-lipun. `HOST=127.0.0.1`
pitää Noden piilossa Caddyn takana.

## Pelisäännöt (opittu kantapään kautta)

1. **Ei uusia riippuvuuksia kevyin perustein.** Auth tehtiin Node cryptolla,
   evästeparseri käsin. `npm audit` on 0 – pidä se nollassa
   (`overrides`-kenttä package.jsonissa pakottaa korjatut versiot: `uuid`
   exceljs:lle ja `brace-expansion` koko puulle. Jos `npm audit` näyttää
   siirtymäriippuvuuden haavoittuvuuden, lisää override + aja `npm test`.)
   **Tunnettu poikkeus (11/2026):** `minimatch <11` (moderate, DoS haitallisella
   glob-lausekkeella) exceljs → archiver → glob 7 -ketjussa. Overridea ei voi
   käyttää, koska minimatch 11 rikkoo glob 7:n (testattu). Ei hyödynnettävissä:
   archiver ajaa vain sovelluksen omia kiinteitä lausekkeita, ei käyttäjän syötettä.
   Poistuu kun exceljs päivittää archiverin.
2. **Kaikki käyttäjäsisältö escapetaan** (`esc()` app.js:ssä) ennen innerHTML:ää.
   Markdown renderöidään escapetusta tekstistä. XSS-testit vartioivat tätä.
3. **Skeemamuutokset vain lisäävinä migraatioina db.js:ään**
   (PRAGMA table_info -tarkistus + ALTER TABLE). Ajautuvat automaattisesti
   käynnistyksessä – vanha data ei koskaan vaadi käsityötä.
4. **Sandboxin datamuutokset:** lisää kenttä `migrateExisting()`-funktioon
   (säilyttää käyttäjän datan) TAI nosta `LS_KEY`-versiota (nollaa demon
   seed-dataan – tee näin vain kun uusi seed-sisältö on demolle tärkeä).
5. **Ulkoasu-/logiikkamuutoksen jälkeen aina** `node sandbox/build-single.js`
   ja committaa syntynyt elama-sandbox.html.
6. **`npm test` vihreänä (465 testiä) ennen jokaista committia.** Testit ajavat
   palvelimen eristetyssä ELAMA_DATA_DIR-hakemistossa – eivät koske oikeaa dataa.
7. **Tekijätieto tulee AINA istunnosta** (`req.user.name`) – älä koskaan luota
   selaimen author-kenttään.
8. **CSP kieltää inline-skriptit** palvelinversiossa – uusi JS vain erillisiin
   tiedostoihin (vrt. theme-boot.js). /offline-reitillä on oma löysempi CSP,
   koska se on itsenäinen dokumentti.
9. Asennuspaketti käyttäjälle: zip kotiwiki-kansiosta ILMAN node_modules/data/
   backups -kansioita.

## Sudenkuopat (älä astu uudelleen)

- **store-local.js alustetaan heti latauksessa** (`const ready = ensureSeeded()`
  tiedoston alkupäässä). Kaikki, mitä `ensureSeeded` tai `migrateExisting`
  käyttää, on määriteltävä sen YLÄPUOLELLA. Muuten tyhjä demo toimii, mutta
  sandbox kaatuu vasta uudelleenlatauksessa, kun selaimessa on vanhaa dataa
  ("Cannot access ... before initialization"). Testi lataa sivun uudelleen
  datan kanssa juuri tämän takia.

- **Safari + file://** estää IndexedDB:n → sandboxin blob-toiminnot on
  kääritty try/catchiin; älä tee IndexedDB:stä kriittistä polkua.
- **iOS:n tiedostoesikatselu (Quick Look) ei suorita JavaScriptiä** →
  sandboxissa on staattinen jsNotice-viesti; puhelinkäyttöön on offline-HTML,
  jonka sisältö on esirenderöityä.
- **`</script>` template-literalin sisällä** rikkoo single-file-buildin →
  offline-templatessa se on kirjoitettu muodossa `<\/script>`.
- **Node poolaa pienet tiedostopuskurit** (byteOffset ≠ 0) → pdf-parse vaatii
  kopion omaan puskuriin (tehty extract.js:ssä). Ilman tätä pienet PDF:t
  eivät indeksoidu.
- **better-sqlite3 pitää olla ^12**, jotta Node 24:lle on valmis binääri
  (v11 yritti kääntää lähteistä ja kaatui käyttäjän Macilla).
- Kehitysympäristöhuomio: `pkill` bash-ketjussa palauttaa 144 ja katkaisee
  `&&`-ketjun – aja siivous erillisenä komentona.
- **Kategorian väri sijoitetaan inline-tyyliin** (`--cat-accent`) → se on
  validoitava heksaksi (`#rrggbb`) sekä palvelimella (`cleanColor`) että
  sandboxissa, muuten syntyy CSS-injektioriski. Muut käyttäjäsyötteet eivät
  koskaan mene tyyliin, vain escapettuun tekstiin/attribuutteihin.
- **Live-haku** (`initLiveSearch` app.js:ssä) ja **sisällysluettelo**
  (`buildToc`) ovat puhtaasti client-puolta, käyttävät olemassa olevaa
  `Store.search`ia ja renderöityä `.doc`ia – ei uusia palvelinreittejä.
- **Liitteet tarjoillaan hiekkalaatikossa**: `/api/attachments/:id` asettaa
  vastauksen CSP:ksi `default-src 'none'; ...; sandbox`, jottei käyttäjän
  lataama SVG/HTML voi ajaa skriptiä XSS-vektorina.
- **`html, body { height: 100% }` rikkoo `position: sticky`n.** Bodyn laatikko
  jää ruudun korkuiseksi, jolloin sticky-elementeillä ei ole liikkumavaraa ja
  ne vierivät pois, vaikka CSS käskee toisin. Käytä `min-height: 100%`.
  Tämä piti yläpalkin ja oikean palstan stickyt rikki pitkään huomaamatta.
- **Kiinteä sivupalkki tarvitsee AINA oman vierityksen** (`height: calc(100vh -
  var(--topbar-h)); overflow-y: auto`). Kategoriapuu on jo 11 rivillä ~740 px
  eli korkeampi kuin 1366×768-läppärin työtila – ilman omaa vieritystä alimmat
  kategoriat olisivat saavuttamattomissa. Yläpalkin korkeus on muuttujassa
  `--topbar-h` (perusilme 57 px, 2a 56 px), käytä sitä älä lukua.
- **Haun LIKE-kyselyt** escapetaan (`% _ \` → `ESCAPE '\'`), jotta haku on
  kirjaimellinen. Sandbox käyttää substring-hakua, joten se on jo kirjaimellinen.
- **`highlight()` etsii osumat RAAKATEKSTISTÄ** ja escapettaa palat erikseen.
  Jos korostus tehtäisiin valmiiksi escapetusta merkkijonosta, haku sanalla
  `amp`/`quot`/`lt` osuisi HTML-entiteetin sisään ja rikkoisi merkin.

## Alakategoriat (monta tasoa)

- `categories.parent_id` (NULL = pääkategoria). **Mielivaltainen syvyys**
  (esim. Koti → Laitteet ja huolto → Keittiö).
- **Silmukan esto:** uudeksi yläkategoriaksi ei kelpaa kategoria itse eikä sen
  aleneva – `descendantIds()` (server.js) / `localDescendantIds()` (sandbox);
  UI:n yläkategoriavalitsin jättää nämä pois.
- **Poistoketju rekursiivinen:** `descendantIds` kerää koko alipuun, jonka
  sivut+liitteet poistetaan (edelleen vain admin + salasana).
- Järjestys (`sort_order`) lasketaan **sisarusten kesken** (sama `parent_id`);
  reorder-napit siirtävät vain saman tason sisällä.
- Client rakentaa puun rekursiivisesti: `catTreeHtml()` (sivupalkki),
  `ancestorsOf()` (murupolku), `descendantsOf()` (silmukan esto, ohjemäärät).
  Sisennys kompoundaa CSS:ssä (`.subcat-list` padding + border-left per taso).

## Tallentamattomat muutokset ja luonnokset

- `unsavedDirty` (app.js) on tosi kun muokkauslomaketta on kosketettu.
  `window.onbeforeunload` kattaa selaimen sulkemisen, mutta **hash-navigointi
  ei laukaise sitä** – siksi `router()` kysyy erikseen ja palauttaa osoitteen
  (`revertingHash`), jos käyttäjä peruu.
- Sama näppäily tallentaa luonnoksen selaimeen (`elama_draft_<id|uusi>`).
  Luonnos tarjotaan palautettavaksi muokkausnäkymän avautuessa ja siivotaan
  onnistuneen tallennuksen sekä ohjeen poiston yhteydessä.
- **Peruuta**-nappi nollaa varoituksen mutta EI luonnosta (vahinkoklikkaus ei
  hukkaa tekstiä).

## Roskakori (pehmeä poisto)

- `pages.deleted_at` / `deleted_by` (NULL = näkyvä ohje). **Kaikki sivukyselyt
  suodattavat `deleted_at IS NULL`**: listaus, haku, offline-
  tuloste ja kategorioiden `page_count`. Uutta kyselyä lisätessä MUISTA tämä.
- Poisto = `UPDATE ... SET deleted_at`. Liitteet ja versiohistoria säilyvät
  koskemattomina, joten palautus (`POST /api/pages/:id/restore`) on täydellinen.
- **Salasanavahvistus:** `DELETE /api/pages/:id` vaatii käyttäjän oman salasanan
  (`verifyPassword`), lopullinen `DELETE /api/trash/:id` lisäksi admin-roolin.
- `TRASH_DAYS = 30`. `purgeTrash()` ajetaan käynnistyksessä, kerran vuorokaudessa
  (`setInterval(...).unref()` – ei pidä testiajoa hengissä) ja roskakoria
  avattaessa. Sandboxissa vastaava `purgeTrashLocal()` ajetaan listauksessa.
- Poisto/tallennus kutsuu `loadCategories()`, jotta sivupalkin ohjemäärät
  pysyvät ajan tasalla.

## Ulkoasu 2a (valittu suunta)

Claude Designin handoff (`design_handoff_halytyskeskus_etusivu`) on toteutettu
ja **valittu pysyväksi ulkoasuksi**. Vanha "liquid glass" -etusivu ja
kokeiluvaiheen kytkin on poistettu.

- `data-design="2a"` on kiinteästi `<html>`-tagissa (index.html ja
  build-single.js) – ei JS-riippuvuutta. `public/design2a.css` tunnistaa
  siitä omat sääntönsä; `styles.css` on yhä pohja kaikille muille näkymille.
- Etusivu on `viewHome()` (d2-*-luokat). Muut näkymät käyttävät edelleen
  styles.css:n rakennetta, jonka päälle 2a tuo värit ja typografian.
- **Fontit paketoitu** (`public/fonts/`, Inter Tight + IBM Plex Mono,
  OFL-1.1). Handoff latasi ne Google Fontsista; se ei käy, koska CSP on
  `default-src 'self'` eikä sisäverkossa ole internetiä. `build-single.js`
  muuntaa `url('fonts/…')` base64:ksi, joten sandbox pysyy yhtenä tiedostona.
- **Kontrastikorjaukset:** handoffin `--tx3`, vaalean `--brand` ja `--warn`
  alittivat WCAG AA:n 4,5:1. Korjatut arvot ja mittaukset design2a.css:n
  alkukommentissa – mittaa uudelleen jos sävyjä muutetaan.
- **Tumman teeman täytöt ovat kirkkaita, joten teksti niiden päällä on tumma.**
  Älä kirjoita täytön päälle `color: #fff`, vaan `var(--acttx, #fff)`
  (vaaleassa valkoinen, tummassa #20120A). Näin tekevät `.btn`, `.btn.danger`,
  `.brand-mark`, `#backTop` ja kauppalistan valintamerkki. Kategorian
  aksenttiväri tekstinä (`.d2-catnum`, `.d2-recmeta`) vaalennetaan tummassa
  teemassa muuttujalla `--cat-ink` (40 % aksenttia, 60 % valkoista), koska
  paletti on valittu vaalealle pohjalle.
- Sudenkuoppa: `.d2-home`-flexissä `align-items: flex-start` kutistaa
  pystysuunnassa sarakkeet max-content-levyisiksi → vaakavieritys. Kapeilla
  näytöillä on oltava `stretch`.
- **Toteuttamatta** (vaatii skeemamuutokset): tiedotteen voimassaoloaika,
  tiedotteeseen liitetty ohje, 30 vrk liukuva TOP-lista, kategorian kuvaus.
  Etusivu käyttää näiden sijaan nykyistä dataa.

## Roolit ja oikeudet (server.js:n portti-middleware)

- `admin`: kaikki + /api/users
- `editor`: kaikki paitsi /api/users
- `viewer`: vain GET (käyttöliittymä piilottaa napit CSS:llä
  `:root[data-vrole="viewer"]`, mutta palvelin on ainoa oikea vartija).
  **Uusi kirjoittava lomake ⇒ lisää kortille `editor-only`-luokka** tai napin
  id piilotuslistaan – muuten lukija näkee lomakkeen, joka kaatuu 403:een.
  `viewPageEdit` näyttää lukijalle selkeän viestin lomakkeen sijaan.
- Kirjautumaton tila: `data-auth="out"` piilottaa yläpalkin, sivupalkin,
  reunapalstan ja alapalkin, jottei kirjautumissivulla ole klikattavaa
  valikkoa (klikkaus olisi antanut harhaanjohtavan istuntovirheen).
- **Kategorian poisto: vain `admin` JA salasanavahvistus.** `DELETE
  /api/categories/:id` tarkistaa roolin ja `verifyPassword`:lla bodyn
  `password`-kentän (peruuttamaton, vie alakategoriat+sivut+liitteet). UI
  näyttää salasanalomakkeen; napin piilotus `[data-vrole="editor"] #delCatBtn`.
  Sandboxissa (ei authia) riittää vahvistus.
- Avoimet reitit: /api/auth-status, /api/login, /api/setup (vain kun 0
  käyttäjää), /api/logout, staattiset tiedostot

## Työjono (ei aloitettu)

1. **Lisää ulkoisia lähteitä etusivulle**: uutiset, Euribor
   (sää ja sähkön hinta on jo tehty ja toimivat mallina; paikanpitäjät ovat
   cards.js:n lopussa, ohje README:ssä)
2. **Laiterekisteri**: kodinkoneiden takuut, kuitit ja huoltohistoria
   (wikin liitteet ja haku toimivat tähän valmiiksi)
3. **Reseptit ja viikon ruokalista**: ainekset kauppalistalle yhdellä napilla
4. **Liitelouhinta taustalle**: iso PDF viivyttää nyt latausvastausta
5. Myöhemmin jos tarve: FTS5-haku (nyk. LIKE riittää satoihin artikkeleihin,
   mitattu noin 4 ms, kun sivuja oli 309), OCR skannatuille PDF:ille

## Komennot

```bash
npm start                      # palvelin (PORT=xxxx vaihtaa portin)
npm test                       # 465 testiä eristetyssä ympäristössä
npm run backup                 # varmuuskopio backups/-kansioon
node sandbox/build-single.js   # kokoa jaettava sandbox-tiedosto
node reindex.js                # liitteiden hakuindeksin uudelleenajo
```

Dokumentit: README.md (ominaisuudet ja käyttö) · ASENNUS.md (oma kone) ·
TUOTANTOON.md (palvelin) · tämä tiedosto (kehittäjät).
