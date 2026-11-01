// Palautus varmuuskopiosta. PYSÄYTÄ PALVELIN ENNEN AJOA.
//
// Käyttö:  node restore.js <varmuuskopiokansio>
// Esim.:   node restore.js backups/2026-07-04_120000
//
// Turvaksi nykyinen data siirretään talteen kansioon
// data_ennen_palautusta_<aikaleima> – mitään ei tuhota.
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.ELAMA_DATA_DIR || path.join(__dirname, 'data');
const src = process.argv[2];

if (!src) {
  console.error('Anna varmuuskopiokansio: node restore.js backups/2026-07-04_120000');
  process.exit(1);
}
const srcDb = path.join(src, 'elama.db');
if (!fs.existsSync(srcDb)) {
  console.error('Kelvollista varmuuskopiota ei löydy (elama.db puuttuu):', src);
  process.exit(1);
}

// Siirrä nykyinen data turvaan.
if (fs.existsSync(DATA_DIR)) {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  const safety = DATA_DIR + `_ennen_palautusta_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  fs.renameSync(DATA_DIR, safety);
  console.log('Nykyinen data siirretty talteen:', safety);
}

// Palauta kanta ja liitteet.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.copyFileSync(srcDb, path.join(DATA_DIR, 'elama.db'));
const srcUploads = path.join(src, 'uploads');
if (fs.existsSync(srcUploads)) {
  fs.cpSync(srcUploads, path.join(DATA_DIR, 'uploads'), { recursive: true });
}

console.log('Palautus valmis kansiosta:', src);
console.log('Käynnistä palvelin uudelleen (npm start).');
