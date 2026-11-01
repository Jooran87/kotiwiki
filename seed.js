// Lisää esimerkkisisältöä uuteen tietokantaan. Aja kerran: node seed.js
// Ei tee mitään jos sisältöä on jo olemassa.
//
// Tämä on RUNKO, ei valmis sisältö: kategoriat ja esimerkkiohjeet näyttävät
// millaista sisältöä minnekin kuuluu. Korvaa omillasi – tai tyhjennä tiedosto
// ja aloita puhtaalta pöydältä.
const db = require('./db');
const now = () => new Date().toISOString();

const existing = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (existing > 0) {
  console.log('Tietokannassa on jo sisältöä – esimerkkidataa ei lisätty.');
  process.exit(0);
}

const insCat = db.prepare('INSERT INTO categories (name, icon, color, sort_order) VALUES (?, ?, ?, ?)');
const insSubCat = db.prepare('INSERT INTO categories (name, icon, sort_order, parent_id) VALUES (?, ?, ?, ?)');
const insPage = db.prepare('INSERT INTO pages (category_id, title, content, keywords, updated_at, updated_by, views) VALUES (?, ?, ?, ?, ?, ?, ?)');
const insNote = db.prepare('INSERT INTO shift_notes (category_id, author, content, created_at) VALUES (?, ?, ?, ?)');
const insContact = db.prepare('INSERT INTO contacts (label, phone, note, sort_order) VALUES (?, ?, ?, ?)');
const insAnn = db.prepare('INSERT INTO announcements (title, content, pinned, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
const insTerm = db.prepare('INSERT INTO terms (term, definition, updated_at, updated_by) VALUES (?, ?, ?, ?)');
const insLink = db.prepare('INSERT INTO links (label, url, note, sort_order) VALUES (?, ?, ?, ?)');

const ME = 'Minä';

// ---------- Kategoriat: elämän osa-alueet ----------
const koti = insCat.run('Koti', 'svg:building', '#0369a1', 0).lastInsertRowid;
const auto = insCat.run('Auto ja liikkuminen', 'svg:wrench', '#b45309', 1).lastInsertRowid;
const talous = insCat.run('Talous', 'svg:folder', '#0f766e', 2).lastInsertRowid;
const terveys = insCat.run('Terveys', 'svg:heart', '#9d174d', 3).lastInsertRowid;
const vapaa = insCat.run('Vapaa-aika', 'svg:book', '#7c3aed', 4).lastInsertRowid;

// Alakategoriat: sama monitasoisuus kuin pohjaprojektissa
const kotiLaitteet = insSubCat.run('Laitteet ja huolto', 'svg:plug', 1, koti).lastInsertRowid;
const kotiRuoka = insSubCat.run('Ruoka ja reseptit', 'svg:clipboard', 2, koti).lastInsertRowid;
const talousSopimukset = insSubCat.run('Sopimukset', 'svg:doc', 1, talous).lastInsertRowid;

// Kolmas taso: Koti > Laitteet ja huolto > huonekohtaisesti
const laitKeittio = insSubCat.run('Keittiö', 'svg:store', 1, kotiLaitteet).lastInsertRowid;
const laitPesu = insSubCat.run('Pesutupa', 'svg:droplet', 2, kotiLaitteet).lastInsertRowid;

// ---------- Esimerkkiohjeet ----------
insPage.run(kotiLaitteet, 'Lämminvesivaraajan nollaus',
  `# Lämminvesivaraajan nollaus

Kun lämmintä vettä ei tule, kokeile tässä järjestyksessä.

## 1. Tarkista sulake
Sähkökaapissa varaajan oma sulake. Jos se on lauennut, kytke takaisin
ja odota **2–3 tuntia** – vesi ei lämpene hetkessä.

## 2. Ylikuumenemissuoja
Varaajan kyljessä on pieni punainen nappi suojakannen alla.
Paina kunnes kuuluu naksahdus.

## 3. Jos ei auta
Soita huoltoon (numero löytyy Tärkeät numerot -sivulta).
Kerro varaajan **malli ja valmistusvuosi** – ne lukevat kyljen tarrassa.

> Muista: älä avaa varaajan sähköosia itse.`,
  'lämminvesi, varaaja, sulake, huolto', now(), ME, 12);

insPage.run(kotiLaitteet, 'Ilmanvaihdon suodattimien vaihto',
  `# Ilmanvaihdon suodattimien vaihto

**Väli:** noin 6 kk, tai kun paine-ero kasvaa.

- Sammuta koneet ennen luukun avaamista
- Merkitse vaihtopäivä suodattimeen tussilla
- Tilaa uudet heti vaihdon jälkeen, niin niitä on aina varalla

Kirjaa vaihtopäivä muistiinpanoihin, niin seuraava kerta on helppo ajoittaa.`,
  'suodatin, ilmanvaihto, huoltoväli', now(), ME, 8);

insPage.run(laitKeittio, 'Astianpesukoneen suodattimen puhdistus',
  `# Astianpesukoneen suodatin

**Väli:** kerran kuussa.

1. Ota alakori pois
2. Kierrä suodatin irti (vastapäivään)
3. Huuhtele juoksevan veden alla, harjaa tarvittaessa
4. Aseta takaisin ja varmista että lukittuu

Jos astiat jäävät likaisiksi, tämä on ensimmäinen tarkistuskohde.`,
  'astianpesukone, suodatin, keittiö', now(), ME, 6);

insPage.run(laitPesu, 'Pyykinpesukoneen nukkasihti',
  `# Nukkasihdin puhdistus

**Väli:** muutaman kuukauden välein.

1. Aseta matala astia luukun eteen – vettä tulee
2. Avaa etupaneelin alaluukku
3. Kierrä sihti irti ja puhdista
4. Kierrä takaisin tiukasti, muuten vuotaa

Jos kone ei tyhjennä vettä, syy on useimmiten tässä.`,
  'pyykinpesukone, nukkasihti, pesutupa', now(), ME, 5);

insPage.run(kotiRuoka, 'Perusleipä',
  `# Perusleipä

## Aineet
- 5 dl vettä
- 25 g hiivaa
- 1 tl suolaa
- 1 rkl siirappia
- noin 12 dl jauhoja

## Ohje
1. Liuota hiiva kädenlämpöiseen veteen
2. Lisää suola ja siirappi
3. Sekoita jauhot vähitellen, vaivaa 10 min
4. Kohota liinan alla 1 h
5. Paista 225 °C noin 25 min`,
  'leipä, resepti, leivonta', now(), ME, 5);

insPage.run(auto, 'Katsastus ja määräaikaishuolto',
  `# Katsastus ja huolto

## Ennen katsastusta tarkista
- Valot ja vilkut
- Renkaiden urasyvyys (talvella vähintään 3 mm)
- Tuulilasinpyyhkijät ja pesuneste
- Ettei mittaristossa pala varoitusvaloja

## Mukaan
- Ajoneuvon rekisteriote
- Edellinen katsastustodistus

Kirjaa katsastuspäivä muistutuksiin heti kun uusi määräaika on tiedossa.`,
  'katsastus, huolto, auto, renkaat', now(), ME, 15);

insPage.run(talousSopimukset, 'Sopimusten uusiminen',
  `# Sopimusten uusiminen

Käy nämä läpi kerran vuodessa – kilpailutus kannattaa lähes aina.

- **Sähkö** – tarkista sopimustyyppi ja päättymispäivä
- **Vakuutukset** – koti, auto, matka
- **Puhelin ja netti**
- **Suoratoistopalvelut** – mitkä ovat oikeasti käytössä?

Merkitse jokaisen sopimuksen päättymispäivä muistutuksiin.`,
  'sopimus, vakuutus, sähkö, kilpailutus', now(), ME, 7);

insPage.run(terveys, 'Kotiapteekin tarkistus',
  `# Kotiapteekin tarkistus

**Väli:** kerran vuodessa.

- Tarkista viimeiset käyttöpäivät
- Vanhentuneet lääkkeet apteekkiin, ei roskiin
- Täydennä: särkylääke, laastarit, sidetarvikkeet, kuumemittari
- Tarkista että hätänumerot ovat ajan tasalla`,
  'kotiapteekki, lääkkeet, ensiapu', now(), ME, 4);

insPage.run(vapaa, 'Retkeilyn pakkauslista',
  `# Retkeilyn pakkauslista

## Aina mukaan
- Kartta ja kompassi (älä luota pelkkään puhelimeen)
- Vettä ja evästä
- Ensiapupakkaus
- Otsalamppu ja varaparistot
- Sadeviitta

## Talvella lisäksi
- Termospullo
- Varasukat ja -lapaset
- Makuualusta taukoja varten

Kerro aina jollekin minne menet ja milloin palaat.`,
  'retkeily, pakkaus, luonto', now(), ME, 3);

// ---------- Muistutukset ----------
insAnn.run('Auton katsastus umpeutuu maaliskuussa',
  'Varaa aika hyvissä ajoin – ruuhka-aikaan vapaita aikoja on vähän.',
  1, now(), ME, now());
insAnn.run('Sähkösopimus päättyy syksyllä',
  'Kilpailuta ennen automaattista jatkumista.', 0, now(), ME, now());
insAnn.run('Ilmanvaihdon suodattimet vaihdettu',
  'Seuraava vaihto puolen vuoden päästä.', 0, now(), ME, now());

// ---------- Tärkeät numerot ----------
[
  ['Hätänumero', '112', 'henkeä uhkaavat tilanteet'],
  ['Myrkytystietokeskus', '0800 147 111', 'ympäri vuorokauden, maksuton'],
  ['Päivystysapu', '116 117', 'kiireellinen hoidon tarve'],
  ['Taloyhtiön huolto', '', 'täytä oma numerosi'],
  ['Vakuutusyhtiö', '', 'täytä oma numerosi'],
  ['Sähköyhtiön vikailmoitus', '', 'täytä oma numerosi'],
].forEach((r, i) => insContact.run(r[0], r[1], r[2], i));

// ---------- Muistiinpanoja ----------
const paiviaSitten = (n) => new Date(Date.now() - n * 86400000).toISOString();
insNote.run(null, ME, 'Suodattimet vaihdettu, seuraava kerta puolen vuoden päästä.', paiviaSitten(2));
insNote.run(auto, ME, 'Renkaissa urasyvyyttä 4 mm – kestävät vielä ensi talven.', paiviaSitten(9));
insNote.run(koti, ME, 'Varaajan malli ja vuosi kirjattu ohjeeseen.', paiviaSitten(21));

// ---------- Termit ----------
[
  ['Euribor', 'Euroalueen viitekorko. Asuntolainan korko on usein euribor + marginaali.'],
  ['Marginaali', 'Pankin oma lisä viitekoron päälle. Sovitaan lainaa otettaessa.'],
  ['Omavastuu', 'Osuus vahingosta, jonka maksat itse ennen kuin vakuutus korvaa.'],
  ['Spot-hinta', 'Sähkön pörssihinta, joka vaihtelee tunneittain.'],
].forEach((t) => insTerm.run(t[0], t[1], now(), ME));

// ---------- Linkit ----------
[
  ['Oma verotoimisto', 'https://www.vero.fi', 'veroilmoitus ja verokortti'],
  ['Kansalaisen karttapaikka', 'https://asiointi.maanmittauslaitos.fi/karttapaikka', 'kartat ja kiinteistötiedot'],
  ['Omakanta', 'https://www.kanta.fi', 'reseptit ja terveystiedot'],
].forEach((l, i) => insLink.run(l[0], l[1], l[2], i));

console.log('Esimerkkisisältö lisätty (Oma dashboard – runko).');
