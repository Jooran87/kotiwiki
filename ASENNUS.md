# Oma dashboardn asennus omalle koneelle

Tämä on wikin **täysversio** – sama, joka myöhemmin asennetaan firman
palvelimelle. Voit kirjoittaa artikkelit valmiiksi omalla koneellasi ja
siirtää ne myöhemmin palvelimelle (ohje alempana).

## 1. Asenna Node.js (kertaalleen)

- Lataa **Node.js LTS** osoitteesta <https://nodejs.org> (vihreä nappi)
- Asenna oletusasetuksilla (Windows: seuraava, seuraava, valmis)

## 2. Pura ja asenna wiki

1. Pura `elama-asennuspaketti.zip` haluamaasi paikkaan,
   esim. `C:\tyowiki` tai Tiedostot-kansioon
2. Avaa komentorivi purettuun kansioon:
   - **Windows:** avaa kansio Resurssienhallinnassa, kirjoita osoitepalkkiin
     `cmd` ja paina Enter
   - **Mac:** avaa Pääte (⌘ + välilyönti → kirjoita "Pääte" tai "Terminal").
     Kirjoita `cd ` (välilyönti perään) ja **vedä tyowiki-kansio Finderista
     Pääte-ikkunaan** → polku täydentyy → paina Enter
3. Aja komennot:

```
npm install
npm run seed
npm start
```

- `npm install` hakee tarvittavat kirjastot (kestää hetken, tarvitsee nettiä
  vain tämän kerran)
- `npm run seed` lisää esimerkkisisällön (valinnainen – jätä pois jos haluat
  aloittaa tyhjästä)
- `npm start` käynnistää wikin

## 3. Käytä

Avaa selaimessa: **http://localhost:3000**

- **Ensimmäisellä kerralla** wiki pyytää luomaan pääkäyttäjätilin
  (nimi, tunnus, salasana) – luo omasi ja kirjaudu
- Muut käyttäjät luot sivupalkin **👥 Käyttäjät** -sivulta
  (roolit: Ylläpitäjä / Muokkaaja / Lukija)
- Wiki pyörii niin kauan kuin komentorivi-ikkuna on auki;
  sammutus: `Ctrl + C` (tai sulje ikkuna)
- Seuraavilla kerroilla riittää pelkkä `npm start` samassa kansiossa

## Missä tietoni ovat?

Kaikki kirjoittamasi on kansiossa `data/` (tietokanta + liitetiedostot).
Ota kopio komennolla `npm run backup` → syntyy `backups/<aikaleima>/`.

## Siirto firman palvelimelle myöhemmin

1. Omalla koneella: `npm run backup`
2. Vie tuorein `backups/<aikaleima>`-kansio palvelimelle
3. Palvelimella (wiki pysäytettynä): `node restore.js <kansio>` ja `npm start`

Artikkelisi, kategoriat, termit ja liitteet siirtyvät sellaisenaan.

## Päivitys uuteen versioon (kirjoittamasi sisältö säilyy)

1. Sammuta wiki (`Ctrl + C` Päätteessä)
2. Nimeä vanha kansio uudelleen, esim. `tyowiki-vanha`
3. Pura uusi paketti → syntyy uusi `tyowiki`-kansio
4. **Kopioi `data`-kansio** vanhasta uuteen: `tyowiki-vanha/data` → `tyowiki/data`
5. Uudessa kansiossa: `npm install` ja `npm start`
6. Kun kaikki toimii, vanhan kansion voi poistaa

## Ongelmia?

- **"npm ei tunnistettu" / "command not found: npm"** → Node.js ei asentunut;
  sulje ja avaa Pääte/komentorivi uudelleen asennuksen jälkeen
- **Mac: `npm install` valittaa kääntämisestä (gyp/xcode)** → aja kerran
  `xcode-select --install` (asentaa Applen komentorivityökalut) ja aja
  `npm install` uudelleen
- **Mac: hyvin vanha macOS** → jos uusin Node LTS ei asennu, lataa
  nodejs.org:sta edellinen LTS-versio (20)
- **Portti varattu** → käynnistä toiseen porttiin: Windows
  `set PORT=3001 && npm start`, Mac/Linux `PORT=3001 npm start`
- **Tarkempi dokumentaatio** → katso `README.md`
