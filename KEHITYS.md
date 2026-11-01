# Kehittäjän käsikirja – Oma dashboard

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
tests/               npm test: api (auth+CRUD+turva), backup, ui (Chromium)
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
- Skriptijärjestys on **dashboard.js → cards.js → app.js** sekä index.html:ssä
  että build-single.js:ssä. Väärä järjestys kaataa käynnistyksen.

**load ja render on erotettu tarkoituksella:** kaikkien korttien datat haetaan
`Promise.all`-rinnakkaisuudella, joten hidas lähde ei jarruta muita, ja
yksittäisen kortin poikkeus jää sen omaan laatikkoon (`.dash-err`).

**Auringonnousu lasketaan paikallisesti** (cards.js, NOAA:n yksinkertaistettu
kaava). Napapiirin pohjoispuolella `cosH` menee yli ±1 – silloin aurinko ei
nouse tai laske lainkaan, ja kortti kertoo sen tekstinä. Tulokset on
varmennettu oikeita aikoja vastaan (Helsinki ja Rovaniemi, kesä ja talvi).

### Ulkoiset lähteet – EI selaimesta

Selain ei ota yhteyttä ulos. Uusi lähde:
`sources/<nimi>.js` → `server.js` ajastaa ja tallentaa SQLiteen →
`GET /api/dashboard` → kortin `load`. Näin CSP pysyy tiukkana, avaimet
palvelimella, ja lähteen ollessa alhaalla voidaan näyttää viimeisin arvo.

## Pelisäännöt (opittu kantapään kautta)

1. **Ei uusia riippuvuuksia kevyin perustein.** Auth tehtiin Node cryptolla,
   evästeparseri käsin. `npm audit` on 0 – pidä se nollassa
   (`overrides`-kenttä package.jsonissa pakottaa korjatut versiot: `uuid`
   exceljs:lle ja `brace-expansion` koko puulle. Jos `npm audit` näyttää
   siirtymäriippuvuuden haavoittuvuuden, lisää override + aja `npm test`.)
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
6. **`npm test` vihreänä (253 testiä) ennen jokaista committia.** Testit ajavat
   palvelimen eristetyssä ELAMA_DATA_DIR-hakemistossa – eivät koske oikeaa dataa.
7. **Tekijätieto tulee AINA istunnosta** (`req.user.name`) – älä koskaan luota
   selaimen author-kenttään.
8. **CSP kieltää inline-skriptit** palvelinversiossa – uusi JS vain erillisiin
   tiedostoihin (vrt. theme-boot.js). /offline-reitillä on oma löysempi CSP,
   koska se on itsenäinen dokumentti.
9. Asennuspaketti käyttäjälle: zip tyowiki-kansiosta ILMAN node_modules/data/
   backups -kansioita.

## Sudenkuopat (älä astu uudelleen)

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
  (esim. Hälytyskeskus → Hälytysjärjestelmien ohjeet → DSC/Ajax/HHL).
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
  suodattavat `deleted_at IS NULL`** – listaus, haku, suosituimmat, offline-
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

## Työjono (priorisoitu, ei aloitettu)

1. **Lue ja kuittaa** tiedotteille – kuka on nähnyt tärkeän tiedotteen
   (taulu announcement_reads, kuittausnappi, lukijalista ylläpitäjälle)
2. **Vanhentuneiden vahvistusten kooste** – lista ohjeista joiden
   ✔-vahvistus puuttuu tai on yli 180 pv (data on jo kannassa)
3. **Vuorolokin arkisto** – päivämääräsuodatus + sivutus kun huomioita on satoja
4. **Liitelouhinta taustalle** – iso PDF viivyttää nyt latausvastausta
5. **HTTPS-ohje ICT:lle** käänteisproxyllä (evästeet + Secure-lippu)
6. Myöhemmin jos tarve: FTS5-haku (nyk. LIKE riittää satoihin artikkeleihin,
   mitattu 3–4 ms @ 309 sivua), OCR skannatuille PDF:ille

## Komennot

```bash
npm start                      # palvelin (PORT=xxxx vaihtaa portin)
npm test                       # 253 testiä eristetyssä ympäristössä
npm run backup                 # varmuuskopio backups/-kansioon
node sandbox/build-single.js   # kokoa jaettava sandbox-tiedosto
node reindex.js                # liitteiden hakuindeksin uudelleenajo
```

Dokumentit: README.md (ominaisuudet ja käyttö) · ASENNUS.md (oma kone) ·
TUOTANTOON.md (palvelin, ICT-tehtävät) · tämä tiedosto (kehittäjät).
