# Projekti: Kotiwiki (Miskan oman elämän wiki)

Henkilökohtainen dashboard + ohjewiki + yhteinen kauppalista + varmuusvaraston
päiväysseuranta. Pohjana Miskan työohjewiki (Wtf-repo, haara
`claude/work-wiki-browser-tool-*`), mutta tämä on täysin erillinen projekti:
ei jaettua koodia eikä työnantajan sisältöä.

**Lue ensin `KEHITYS.md`**: arkkitehtuuri, pelisäännöt, sudenkuopat.
Muut: README.md (ominaisuudet), ASENNUS.md (oma kone),
TUOTANTOON.md (UpCloud-palvelin + Caddy + varmuuskopiot).

Nyrkkisäännöt:
- `npm test` vihreänä ennen committia (426 testiä)
- Käyttöliittymämuutoksen jälkeen `node sandbox/build-single.js` ja
  committaa syntynyt sandbox/elama-sandbox.html
- Uusi ominaisuus molempiin storeihin (store-api.js ja sandbox/store-local.js)
- Ei uusia npm-riippuvuuksia kevyin perustein; `npm audit` nollassa
- Kaikki käyttäjäsisältö escapetaan; skeemamuutokset lisäävinä migraatioina
- Ei henkilökohtaista dataa repoon (data/ ja backups/ ovat .gitignoressa)
- Kieli: käyttöliittymä, dokumentit ja commit-viestit suomeksi
- Tekstissä ei ajatusviivoja (–, —); käytä kaksoispistettä tai pilkkua

Käyttäjä (Miska) ei ole ohjelmoija: selitä selkokielellä ja toimita
kuvakaappaukset muutosten jälkeen.
