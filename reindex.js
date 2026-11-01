// Louhii tekstisisällön uudelleen kaikista jo ladatuista liitteistä.
// Aja jos olet päivittänyt hakutoiminnon vanhaan asennukseen jossa on
// jo tiedostoja, tai jos haluat varmistaa hakemiston ajantasaisuuden:
//   node reindex.js
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { extractText } = require('./extract');

const UPLOAD_DIR = path.join(process.env.ELAMA_DATA_DIR || path.join(__dirname, 'data'), 'uploads');

(async function run() {
  const atts = db.prepare('SELECT id, stored_name, original_name, mimetype FROM attachments').all();
  const update = db.prepare('UPDATE attachments SET text_content = ? WHERE id = ?');
  let ok = 0, skipped = 0;
  for (const a of atts) {
    const fp = path.join(UPLOAD_DIR, a.stored_name);
    if (!fs.existsSync(fp)) { console.warn('Puuttuu levyltä:', a.original_name); skipped++; continue; }
    const text = await extractText(fp, a.mimetype);
    update.run(text, a.id);
    ok++;
    console.log(`Indeksoitu: ${a.original_name} (${text.length} merkkiä)`);
  }
  console.log(`\nValmis. Indeksoitu ${ok}, ohitettu ${skipped}.`);
})();
