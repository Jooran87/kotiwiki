'use strict';
// Varmuusvarasto, yhteinen kauppalista ja toistuvat kotityöt.
//
// Kenttien siivous ja päättelysäännöt (osaston arvaus, päivien laskenta) ovat
// tiedostossa public/koti-shared.js, jota myös sandbox käyttää.
//
// Kaikki reitit ovat /api/-alla, joten server.js:n portti hoitaa
// kirjautumisen ja roolit (lukija = vain GET) ennen kuin pyyntö tulee tänne.
//
// Reaaliaikaisuus: GET /api/events on Server-Sent Events -virta. Kun varasto
// kauppalista tai kotityöt muuttuvat, kaikille avoimille selaimille lähtee
// tapahtuma ("pantry", "shopping" tai "chores") ja ne hakevat listan uudelleen. Ei uusia
// riippuvuuksia: SSE on tavallista HTTP:tä, ja selaimen EventSource yhdistää
// katkoksen jälkeen itse uudelleen.

const K = require('./public/koti-shared');

const now = () => new Date().toISOString();
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

module.exports = function mountKoti(app, db) {
  // ---------- Reaaliaikaiset tapahtumat (SSE) ----------
  const clients = new Set();

  function broadcast(type) {
    const msg = `event: ${type}\ndata: ${JSON.stringify({ at: now() })}\n\n`;
    for (const res of clients) {
      try { res.write(msg); } catch (_) { clients.delete(res); }
    }
  }

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // käänteisproxy ei saa puskuroida virtaa
    });
    res.write('retry: 5000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  // Pidetään yhteydet hengissä (proxyt katkaisevat hiljaiset yhteydet).
  setInterval(() => {
    for (const res of clients) {
      try { res.write(': ping\n\n'); } catch (_) { clients.delete(res); }
    }
  }, 25000).unref();

  // ---------- Varmuusvarasto ----------
  const getItem = (id) => db.prepare('SELECT * FROM pantry_items WHERE id = ?').get(id);
  const remember = db.prepare(`INSERT INTO pantry_catalog (barcode, name, category, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(barcode) DO UPDATE SET name = excluded.name,
    category = excluded.category, updated_at = excluded.updated_at`);
  // Saman tuotteen muut rivit (sama nimi, eri päiväys). Vertailu tehdään
  // JavaScriptissä, koska SQLiten lower() ei tunne ääkkösiä.
  const siblings = (name, exceptId) => db.prepare('SELECT * FROM pantry_items WHERE id != ?')
    .all(exceptId || 0).filter((r) => K.nameKey(r.name) === K.nameKey(name));
  // Tavoitemäärä kuuluu tuotteelle, ei yksittäiselle riville: pidetään se
  // samana kaikilla saman nimisillä riveillä.
  const syncTarget = (rows, target, t) => rows.forEach((r) => {
    if (r.target_qty !== target) {
      db.prepare('UPDATE pantry_items SET target_qty = ?, updated_at = ? WHERE id = ?').run(target, t, r.id);
    }
  });

  app.get('/api/pantry', (req, res) => {
    // Päivätyt ensin vanhenemisjärjestyksessä, päiväyksettömät loppuun.
    res.json({
      categories: K.PANTRY_CATEGORIES,
      items: db.prepare(`SELECT * FROM pantry_items
        ORDER BY best_before = '', best_before, name COLLATE NOCASE`).all(),
    });
  });

  app.get('/api/pantry/catalog/:barcode', (req, res) => {
    const code = K.pantryFields({ barcode: req.params.barcode }).barcode;
    const row = db.prepare('SELECT * FROM pantry_catalog WHERE barcode = ?').get(code);
    res.json(row || null);
  });

  app.post('/api/pantry', (req, res) => {
    const f = K.pantryFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Nimi puuttuu' });
    const t = now();
    const same = siblings(f.name);
    // Ilman omaa tavoitetta uusi erä perii tuotteen aiemman tavoitteen.
    if (!f.target_qty) f.target_qty = Math.max(0, ...same.map((r) => r.target_qty));
    const id = db.transaction(() => {
      // "Loppu"-rivi (määrä 0) on vain muistilappu: uusi erä korvaa sen.
      same.filter((r) => r.qty === 0).forEach((r) => db.prepare('DELETE FROM pantry_items WHERE id = ?').run(r.id));
      syncTarget(same.filter((r) => r.qty > 0), f.target_qty, t);
      return db.prepare(`INSERT INTO pantry_items
        (name, barcode, category, qty, best_before, target_qty, created_at, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(f.name, f.barcode, f.category, f.qty, f.best_before, f.target_qty, t, req.user.name, t).lastInsertRowid;
    })();
    if (f.barcode) remember.run(f.barcode, f.name, f.category, t);
    broadcast('pantry');
    res.json(getItem(id));
  });

  app.put('/api/pantry/:id', (req, res) => {
    const old = getItem(req.params.id);
    if (!old) return res.status(404).json({ error: 'Tuotetta ei löydy' });
    const f = K.pantryFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Nimi puuttuu' });
    const t = now();
    const same = siblings(f.name, old.id);
    // Nimen vaihto toiseksi tuotteeksi: ilman omaa tavoitetta rivi perii
    // uuden tuotteensa tavoitteen (eikä nollaa sitä muilta eriltä).
    if (!f.target_qty && K.nameKey(old.name) !== K.nameKey(f.name)) {
      f.target_qty = Math.max(0, ...same.map((r) => r.target_qty));
    }
    db.transaction(() => {
      db.prepare(`UPDATE pantry_items SET name = ?, barcode = ?, category = ?, qty = ?,
        best_before = ?, target_qty = ?, updated_at = ? WHERE id = ?`)
        .run(f.name, f.barcode, f.category, f.qty, f.best_before, f.target_qty, t, req.params.id);
      syncTarget(same, f.target_qty, t);
    })();
    if (f.barcode) remember.run(f.barcode, f.name, f.category, t);
    broadcast('pantry');
    res.json(getItem(req.params.id));
  });

  // Yksi kappale käytetty: määrä -1. Viimeinen kappale poistaa rivin, paitsi
  // jos tuotteella on tavoitemäärä eikä muita eriä ole: silloin rivi jää
  // määrällä 0 muistuttamaan ostamisesta.
  app.post('/api/pantry/:id/use', (req, res) => {
    const item = getItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Tuotetta ei löydy' });
    if (item.qty > 1) {
      db.prepare('UPDATE pantry_items SET qty = qty - 1, updated_at = ? WHERE id = ?').run(now(), item.id);
    } else if (item.target_qty > 0 && !siblings(item.name, item.id).length) {
      db.prepare("UPDATE pantry_items SET qty = 0, best_before = '', updated_at = ? WHERE id = ?").run(now(), item.id);
    } else {
      db.prepare('DELETE FROM pantry_items WHERE id = ?').run(item.id);
    }
    broadcast('pantry');
    res.json(getItem(item.id) || { id: item.id, qty: 0, removed: true });
  });

  app.delete('/api/pantry/:id', (req, res) => {
    db.prepare('DELETE FROM pantry_items WHERE id = ?').run(req.params.id);
    broadcast('pantry');
    res.json({ ok: true });
  });

  // ---------- Kauppalista ----------
  const getShop = (id) => db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id);

  // Osasto uudelle riville: 1) käyttäjän aiemmin tälle tuotteelle valitsema,
  // 2) varaston kategoria (annettu vihje tai viivakoodista tuttu tuote),
  // 3) arvaus nimestä.
  function sectionFor(text, pantryCategory) {
    const key = K.nameKey(text);
    const saved = db.prepare('SELECT section FROM shopping_sections WHERE name_key = ?').get(key);
    if (saved && K.cleanSection(saved.section)) return saved.section;
    let cat = K.PANTRY_CATEGORIES.includes(pantryCategory) ? pantryCategory : '';
    if (!cat) {
      const known = db.prepare(`SELECT name, category FROM pantry_catalog
        UNION ALL SELECT name, category FROM pantry_items`).all().find((r) => K.nameKey(r.name) === key);
      if (known) cat = known.category;
    }
    return K.guessSection(text, cat);
  }

  // Ennen osastoja lisätyt rivit saavat osaston kerran käynnistyksessä.
  for (const row of db.prepare("SELECT id, text FROM shopping_items WHERE section = ''").all()) {
    db.prepare('UPDATE shopping_items SET section = ? WHERE id = ?').run(sectionFor(row.text), row.id);
  }

  app.get('/api/shopping', (req, res) => {
    // Ostamatta olevat ensin (vanhin ylimpänä), sitten tänään/viimeksi ostetut.
    // Selain ryhmittelee ostamattomat osastoittain (KotiShared.SECTIONS).
    res.json(db.prepare(`SELECT * FROM shopping_items
      ORDER BY done_at IS NOT NULL, CASE WHEN done_at IS NULL THEN created_at END,
      done_at DESC`).all());
  });

  app.post('/api/shopping', (req, res) => {
    const text = str(req.body.text, 200);
    if (!text) return res.status(400).json({ error: 'Kirjoita tuote' });
    // Sama tuote jo ostamatta listalla: ei tuplata riviä.
    const dup = db.prepare('SELECT * FROM shopping_items WHERE done_at IS NULL').all()
      .find((r) => K.nameKey(r.text) === K.nameKey(text));
    if (dup) return res.json({ ...dup, duplicate: true });
    const section = K.cleanSection(req.body.section) || sectionFor(text, req.body.category);
    const info = db.prepare(`INSERT INTO shopping_items (text, qty, section, added_by, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(text, str(req.body.qty, 40), section, req.user.name, now());
    broadcast('shopping');
    res.json(getShop(info.lastInsertRowid));
  });

  app.put('/api/shopping/:id', (req, res) => {
    const item = getShop(req.params.id);
    if (!item) return res.status(404).json({ error: 'Riviä ei löydy' });
    const text = req.body.text === undefined ? item.text : str(req.body.text, 200);
    if (!text) return res.status(400).json({ error: 'Kirjoita tuote' });
    const qty = req.body.qty === undefined ? item.qty : str(req.body.qty, 40);
    // Käsin vaihdettu osasto muistetaan: sama tuote menee jatkossa oikeaan paikkaan.
    const section = K.cleanSection(req.body.section) || item.section;
    if (section !== item.section) {
      db.prepare(`INSERT INTO shopping_sections (name_key, section) VALUES (?, ?)
        ON CONFLICT(name_key) DO UPDATE SET section = excluded.section`).run(K.nameKey(text), section);
    }
    let doneAt = item.done_at, doneBy = item.done_by;
    if (req.body.done === true && !item.done_at) { doneAt = now(); doneBy = req.user.name; }
    if (req.body.done === false) { doneAt = null; doneBy = ''; }
    db.prepare('UPDATE shopping_items SET text = ?, qty = ?, section = ?, done_at = ?, done_by = ? WHERE id = ?')
      .run(text, qty, section, doneAt, doneBy, item.id);
    broadcast('shopping');
    res.json(getShop(item.id));
  });

  app.delete('/api/shopping/:id', (req, res) => {
    db.prepare('DELETE FROM shopping_items WHERE id = ?').run(req.params.id);
    broadcast('shopping');
    res.json({ ok: true });
  });

  // "Tyhjennä ostetut": poistaa kaikki ruksitut rivit kerralla.
  app.post('/api/shopping/clear-done', (req, res) => {
    const info = db.prepare('DELETE FROM shopping_items WHERE done_at IS NOT NULL').run();
    broadcast('shopping');
    res.json({ removed: info.changes });
  });

  // ---------- Toistuvat kotityöt ----------
  const getChore = (id) => db.prepare('SELECT * FROM chores WHERE id = ?').get(id);

  app.get('/api/chores', (req, res) => {
    res.json(db.prepare('SELECT * FROM chores ORDER BY next_due, title COLLATE NOCASE').all());
  });

  app.post('/api/chores', (req, res) => {
    const f = K.choreFields(req.body, K.todayISO());
    if (!f.title) return res.status(400).json({ error: 'Anna tehtävälle nimi' });
    const info = db.prepare(`INSERT INTO chores (title, note, every_n, unit, next_due, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(f.title, f.note, f.every_n, f.unit, f.next_due, now(), req.user.name);
    broadcast('chores');
    res.json(getChore(info.lastInsertRowid));
  });

  app.put('/api/chores/:id', (req, res) => {
    if (!getChore(req.params.id)) return res.status(404).json({ error: 'Tehtävää ei löydy' });
    const f = K.choreFields(req.body, K.todayISO());
    if (!f.title) return res.status(400).json({ error: 'Anna tehtävälle nimi' });
    db.prepare('UPDATE chores SET title = ?, note = ?, every_n = ?, unit = ?, next_due = ? WHERE id = ?')
      .run(f.title, f.note, f.every_n, f.unit, f.next_due, req.params.id);
    broadcast('chores');
    res.json(getChore(req.params.id));
  });

  // Tehty: seuraava kerta lasketaan kuittauspäivästä toistovälin päähän.
  app.post('/api/chores/:id/done', (req, res) => {
    const chore = getChore(req.params.id);
    if (!chore) return res.status(404).json({ error: 'Tehtävää ei löydy' });
    const day = K.doneDate(req.body && req.body.date, K.todayISO());
    db.prepare('UPDATE chores SET last_done_at = ?, last_done_by = ?, next_due = ? WHERE id = ?')
      .run(day, req.user.name, K.addInterval(day, chore.every_n, chore.unit), chore.id);
    broadcast('chores');
    res.json(getChore(chore.id));
  });

  app.delete('/api/chores/:id', (req, res) => {
    db.prepare('DELETE FROM chores WHERE id = ?').run(req.params.id);
    broadcast('chores');
    res.json({ ok: true });
  });
};

