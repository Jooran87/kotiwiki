# Oma dashboard

Henkilökohtainen aloitussivu: **muistutukset, omat ohjeet ja päivän tiedot**
yhdellä silmäyksellä. Rakennettu Palmian työohje-wikin pohjalle – sama moottori,
eri käyttötarkoitus.

Toimii **omalla koneella tai aina päällä olevalla pikkukoneella** (esim.
Raspberry Pi). Ei pilvipalveluita eikä tilejä: kaikki data on omassa
tietokannassa omalla koneella.

---

## Mitä tässä on nyt

**Dashboard-runko korttipaikkoineen.** Etusivu koostuu korteista, joita voi
lisätä, järjestää ja piilottaa. Nämä toimivat jo:

| Kortti | Mitä näyttää |
|---|---|
| **Päivä** | Kellonaika, päivämäärä, viikkonumero sekä auringonnousu ja -lasku Helsingissä ja Rovaniemellä |
| **Muistutukset** | Kiinnitetyt ja tuoreimmat muistutukset |
| **Ohjeet** | Omat kategoriat ja niiden ohjemäärät |
| **Viimeksi päivitetyt** | Mitä olet viimeksi muokannut |
| **Tärkeät numerot** | Hätänumero korostettuna, muut alla |
| **Muistiinpanot** | Pikakirjaus ja viimeisimmät merkinnät |

Auringonnousuajat **lasketaan laitteessa** – niitäkään ei haeta verkosta.

**Paikanpitäjinä** näkyvät Uutiset, Sää, Euribor ja Sähkön hinta. Ne kertovat
suoraan ettei lähdettä ole vielä kytketty – ks. seuraava luku.

**Pohjasta peritty ja valmiina:** ohjeet ja monitasoiset kategoriat, haku (myös
liitetiedostojen sisällöstä), liitteet ja kuvat tekstin seassa, versiohistoria,
roskakori (30 vrk), termipankki, linkit, käyttäjät ja roolit, varmuuskopiointi,
offline-versio puhelimeen, tumma ja vaalea teema.

---

## Ulkoisten lähteiden lisääminen

**Tärkein sääntö: selain ei hae mitään ulkoa.** Data haetaan palvelimella,
tallennetaan välimuistiin ja tarjoillaan valmiina. Syyt:

- Tiukka tietoturva-asetus (CSP) säilyy – selain puhuu vain omalle palvelimelle
- Mahdolliset rajapinta-avaimet pysyvät palvelimella
- Yksi haku palvelee kaikkia sivulatauksia, joten rajoituksiin ei törmätä
- **Jos lähde on alhaalla, näytetään viimeisin onnistunut arvo aikaleimalla**
  eikä tyhjää ruutua

Vaiheet uudelle lähteelle:

1. `sources/<nimi>.js` – hakee datan ja palauttaa olion
2. `server.js` ajastaa haun ja tallentaa tuloksen (SQLite)
3. `GET /api/dashboard` palauttaa lähteiden viimeisimmät arvot
4. `public/cards.js`: korvaa paikanpitäjä oikealla kortilla

### Lähde-ehdokkaat (käyttöehdot tarkistettava)

- **Sää:** Ilmatieteen laitoksen avoin data tai Open-Meteo – ilmaisia
- **Uutiset:** RSS-syötteet. Näytä otsikko + linkki, älä kopioi koko artikkelia
- **Euribor:** vaatii selvityksen. Virallinen julkaisija on EMMI ja jakelulla on
  ehtoja; Suomen Pankki ja EKP ovat avoimempia vaihtoehtoja
- **Sähkön pörssihinta:** tuntihinnat tälle ja huomiselle päivälle

---

## Uuden kortin lisääminen

Kortit ovat `public/cards.js`:ssä. Etusivun koodiin ei tarvitse koskea:

```js
Dashboard.register({
  id: 'roskat',              // pysyvä tunniste
  title: 'Jäteastiat',
  slot: 'rail',              // 'main' = leveä palsta, 'rail' = oikea kaista
  order: 60,                 // pienempi ensin
  icon: 'trash',             // valinnainen
  load: async () => Store.dashboard.get('roskat'),   // valinnainen
  render: (data) => `<div class="dash-body">${esc(data.seuraava)}</div>`,
});
```

`load` ja `render` on erotettu tarkoituksella: kaikkien korttien datat haetaan
rinnakkain, joten hidas lähde ei jarruta muita, ja yksittäisen kortin virhe jää
sen omaan laatikkoon.

**Muista `esc()`** kaikelle mikä tulee ulkopuolelta – myös rajapintojen
vastauksille.

Kortin voi piilottaa sen otsikkorivin ×-napista; valinta muistetaan.

---

## Käyttöönotto

```bash
npm install
node seed.js      # esimerkkisisältö (vain tyhjään kantaan)
npm start         # http://localhost:3000
```

Ensimmäisellä avauksella luodaan pääkäyttäjätili. Jos käytät dashboardia vain
itse omalla koneella, tunnus on lähinnä muodollisuus – mutta jos laitat sen
kotiverkkoon näkyviin, se kannattaa pitää.

**Kokeilu ilman asennusta:** avaa `sandbox/elama-sandbox.html` tietokoneen
selaimessa. Data tallentuu vain siihen selaimeen.

### Aina päällä olevalle koneelle

Dashboard ei ota kantaa siihen, missä se pyörii. Jos siirrät sen esimerkiksi
Raspberry Pi:lle, muistutukset ja tulevat ulkoiset lähteet päivittyvät myös
silloin kun oma kone on kiinni. Käynnistys automaattiseksi: ks. `TUOTANTOON.md`.

---

## Muokkaaminen omaksi

- **Nimi ja logo:** `public/index.html` ja `sandbox/build-single.js`,
  kohdat `brand-mark` ja `brand-text`
- **Värit:** `public/design2a.css`, tokenit tiedoston alussa
- **Kategoriat ja esimerkkisisältö:** `seed.js` (palvelin) ja
  `sandbox/store-local.js` (sandbox). Molemmat ovat pelkkää esimerkkiä –
  korvaa omillasi
- **Käsitteet:** "Muistutukset" ja "Päiväkirja" ovat pohjan tiedote- ja
  vuorolokitoimintoja uusilla nimillä

Ulkoasumuutoksen jälkeen aja `node sandbox/build-single.js`.

Muut dokumentit: `KEHITYS.md` (tekninen käsikirja), `ASENNUS.md` (asennus),
`TUOTANTOON.md` (palvelimelle vienti).
