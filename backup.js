// Varmuuskopioskripti: kopioi tietokannan ja liitetiedostot aikaleimattuun
// kansioon. Turvallinen ajaa myös palvelimen ollessa käynnissä (SQLiten
// VACUUM INTO tuottaa eheän kopion WAL-tilassa).
//
// Käyttö:  node backup.js [kohdekansio]     (tai: npm run backup)
// Oletuskohde: ./backups
//
// Ympäristömuuttujat:
//   ELAMA_DATA_DIR    – datahakemisto (oletus ./data)
//   TYOWIKI_BACKUP_DIR  – kohdekansio (sama kuin argumentti)
//   ELAMA_BACKUP_KEEP – montako uusinta kopiota säilytetään (oletus 30)
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.ELAMA_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'elama.db');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const BACKUP_ROOT = process.argv[2] || process.env.TYOWIKI_BACKUP_DIR || path.join(__dirname, 'backups');
const KEEP = Math.max(1, parseInt(process.env.ELAMA_BACKUP_KEEP, 10) || 30);

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('Tietokantaa ei löydy:', DB_PATH);
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });

  // Kohdekansio; jos sama sekunti on jo käytössä, lisätään juokseva pääte.
  let dest = path.join(BACKUP_ROOT, stamp());
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(BACKUP_ROOT, stamp() + '-' + i);
  fs.mkdirSync(dest, { recursive: true });

  // 1) Tietokanta: VACUUM INTO tuottaa eheän, tiivistetyn kopion.
  const db = new Database(DB_PATH);
  const dbCopy = path.join(dest, 'elama.db');
  db.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
  db.close();

  // 2) Liitetiedostot.
  let files = 0, bytes = 0;
  if (fs.existsSync(UPLOADS)) {
    fs.cpSync(UPLOADS, path.join(dest, 'uploads'), { recursive: true });
    for (const f of fs.readdirSync(UPLOADS)) {
      files++; bytes += fs.statSync(path.join(UPLOADS, f)).size;
    }
  }

  // 3) Manifesti (mitä kopio sisältää).
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({
    created: new Date().toISOString(),
    source: DATA_DIR,
    db_bytes: fs.statSync(dbCopy).size,
    upload_files: files,
    upload_bytes: bytes,
  }, null, 2));

  // 4) Siivoa vanhat: säilytä KEEP uusinta.
  const all = fs.readdirSync(BACKUP_ROOT)
    .filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}/.test(n))
    .sort()
    .reverse();
  const removed = [];
  for (const old of all.slice(KEEP)) {
    fs.rmSync(path.join(BACKUP_ROOT, old), { recursive: true, force: true });
    removed.push(old);
  }

  console.log('Varmuuskopio valmis:', dest);
  console.log(`  kanta ${(fs.statSync(dbCopy).size / 1024).toFixed(0)} kt, liitteitä ${files} kpl (${(bytes / 1024 / 1024).toFixed(1)} Mt)`);
  console.log(`  säilytetään ${Math.min(all.length, KEEP)} kopiota` + (removed.length ? `, poistettu ${removed.length} vanhaa` : ''));
}

main();
