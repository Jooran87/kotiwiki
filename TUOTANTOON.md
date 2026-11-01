# Kotiwikin vienti omalle palvelimelle

Tässä ohjeessa wiki siirretään omalta koneelta pieneen virtuaalipalvelimeen
Helsingin konesalissa, jotta se toimii puhelimella missä tahansa ja
kauppalista päivittyy molemmille reaaliajassa.

Kohdat on merkitty tekijän mukaan: **[Sinä]** = teet itse selaimessa,
**[Claude Code]** = pyydä Claude Codea tekemään palvelimella SSH-yhteyden yli.

---

## 1. Kokonaiskuva

```
Puhelin / kone  ──HTTPS──▶  Caddy (portti 443, automaattinen sertifikaatti)
                               │
                               ▼  vain koneen sisällä
                            Kotiwiki (Node.js, portti 3000) ── SQLite-tiedosto
```

- **Palvelin:** UpCloud Starter, Helsinki. 1 vCPU / 2 Gt / 20 Gt riittää
  (wiki käyttää ~100 Mt muistia). Hinta noin 6–8 €/kk + alv.
- **Osoite:** oma verkkotunnus (esim. `koti.omanimi.fi`), noin 10–15 €/vuosi.
- **HTTPS:** Caddy hakee ja uusii Let's Encrypt -sertifikaatin itse.
  HTTPS on pakollinen: ilman sitä salasanat kulkisivat selväkielisinä ja
  puhelimen kamera ei avaudu suoraan viivakoodiskanneriin.
- **Ei Dockeria eikä tietokantapalvelinta.** SQLite on yksi tiedosto.

---

## 2. Palvelimen luonti [Sinä]

1. Luo tili osoitteessa upcloud.com ja lisää maksutapa.
2. **Deploy server** → sijainti **Helsinki (fi-hel1 tai fi-hel2)** →
   Starter-paketti → käyttöjärjestelmä **Ubuntu Server 24.04 LTS**.
3. **SSH-avain:** liitä koneesi julkinen avain (`~/.ssh/id_ed25519.pub`;
   jos sitä ei ole, Claude Code luo sen komennolla `ssh-keygen -t ed25519`).
   Älä käytä salasanakirjautumista.
4. Kirjaa ylös palvelimen julkinen IP-osoite.
5. **Verkkotunnus:** lisää verkkotunnuksen DNS-asetuksiin A-tietue
   `koti.omanimi.fi → palvelimen IP`. (Domainin voi ostaa esim. suoraan
   Traficomin listaamalta .fi-välittäjältä.)

---

## 3. Asennus [Claude Code]

Anna Claude Codelle palvelimen IP ja verkkotunnus ja pyydä: *"Asenna kotiwiki
palvelimelle TUOTANTOON.md:n luvun 3 mukaan."* Vaiheet:

```bash
# Päivitykset ja palomuuri: auki vain SSH, HTTP ja HTTPS
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw unattended-upgrades git
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable

# SSH vain avaimella
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs

# Oma palvelutunnus ja koodi (repo on yksityinen → lukuoikeus deploy-avaimella)
sudo useradd -r -m -d /opt/kotiwiki -s /usr/sbin/nologin kotiwiki
sudo -u kotiwiki mkdir -p /opt/kotiwiki/data /opt/kotiwiki/backups
sudo -u kotiwiki git clone git@github.com:Jooran87/kotiwiki.git /opt/kotiwiki/app
cd /opt/kotiwiki/app && sudo -u kotiwiki npm ci --omit=dev

# Palvelu ja Caddy (tiedostot deploy/-kansiossa)
sudo cp deploy/kotiwiki.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now kotiwiki
sudo apt -y install caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # vaihda verkkotunnus tiedostoon
sudo systemctl reload caddy
```

**Tärkeää:** `deploy/kotiwiki.service` asettaa `BEHIND_PROXY=1`. Silloin
istuntoeväste lähetetään vain HTTPS:llä ja kirjautumisyritysten rajoitus
laskee yritykset oikean IP-osoitteen mukaan (ilman sitä kaikki näyttäisivät
tulevan Caddyn osoitteesta, ja hyökkääjä voisi lukita teidät molemmat ulos).
Wiki kuuntelee vain osoitteessa 127.0.0.1, joten sitä ei pääse ohittamaan
Caddyn ohi.

---

## 4. Käyttöönotto [Sinä]

1. Avaa `https://koti.omanimi.fi` → wiki pyytää luomaan **pääkäyttäjän**.
   Tee tämä heti asennuksen jälkeen: ensimmäinen avaaja saa pääkäyttäjän.
2. **Käyttäjät**-sivulta tunnus avovaimolle roolilla **Muokkaaja**.
3. Puhelimessa: avaa osoite Safarissa → Jaa → **Lisää Koti-valikkoon**.
   Wiki aukeaa sen jälkeen kuin sovellus.
4. Kokeile: lisää kauppalistaan tuote yhdellä puhelimella, sen pitäisi
   ilmestyä toiseen sekunnissa. Skannaa varastoon yksi tuote.

---

## 5. Varmuuskopiot [Claude Code]

Palvelimen levy ei ole varmuuskopio. Kaksi kerrosta:

1. **Yöllinen kopio palvelimelle** (pitää 30 uusinta):
   ```
   15 3 * * * cd /opt/kotiwiki/app && /usr/bin/node backup.js /opt/kotiwiki/backups
   ```
   (`sudo -u kotiwiki crontab -e`)
2. **Kopio palvelimen ulkopuolelle**, esim. kotikoneen tai mökin NAS:n
   ajastettu haku:
   ```
   rsync -az kotiwiki-palvelin:/opt/kotiwiki/backups/ ~/Varmuuskopiot/kotiwiki/
   ```
   Lisäksi UpCloudin oma levyvarmistus (Backups-välilehti) maksaa vähän ja
   palauttaa koko palvelimen.

**Palautusharjoitus kerran:** `node restore.js <kopio>` testikansioon.

---

## 6. Päivitykset

Kun Claude Code on tehnyt uuden ominaisuuden ja se on GitHubissa:

```bash
cd /opt/kotiwiki/app
sudo -u kotiwiki node backup.js /opt/kotiwiki/backups   # ensin kopio
sudo -u kotiwiki git pull
sudo -u kotiwiki npm ci --omit=dev
sudo systemctl restart kotiwiki
```

Tietokannan rakennemuutokset ajautuvat käynnistyksessä automaattisesti.
Käyttöjärjestelmän tietoturvapäivitykset asentuvat itsestään
(unattended-upgrades). `npm audit` kannattaa ajaa puolen vuoden välein.

---

## 7. Tietoturvan tarkistuslista

- [ ] Repo GitHubissa **yksityinen** (Settings → Change visibility)
- [ ] SSH vain avaimella, palomuurissa auki vain 22, 80 ja 443
- [ ] Wiki kuuntelee vain 127.0.0.1:3000, ulospäin näkyy vain Caddy
- [ ] `BEHIND_PROXY=1` palvelussa (Secure-eväste + oikea IP rajoitukseen)
- [ ] Pääkäyttäjä luotu heti asennuksen jälkeen, salasanat vähintään 12 merkkiä
- [ ] Yövarmuuskopio + kopio palvelimen ulkopuolelle + palautus kokeiltu
- [ ] Data (`data/`, `backups/`) ei koskaan GitHubissa (`.gitignore` hoitaa)
