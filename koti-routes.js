'use strict';
// Varmuusvarasto ja yhteinen kauppalista.
//
// Kaikki reitit ovat /api/-alla, joten server.js:n portti hoitaa
// kirjautumisen ja roolit (lukija = vain GET) ennen kuin pyyntö tulee tänne.
//
// Reaaliaikaisuus: GET /api/events on Server-Sent Events -virta. Kun varasto
// tai kauppalista muuttuu, kaikille avoimille selaimille lähtee tapahtuma
// ("pantry" tai "shopping") ja ne hakevat listan uudelleen. Ei uusia
// riippuvuuksia: SSE on tavallista HTTP:tä, ja selaimen EventSource yhdistää
// katkoksen jälkeen itse uudelleen.

const PANTRY_CATEGORIES = ['Ruoka', 'Juomavesi', 'Ensiapu ja lääkkeet', 'Paristot ja valo',
  'Hygienia', 'Koiran tarvikkeet', 'Muu'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const now = () => new Date().toISOString();
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const cleanBarcode = (v) => str(v, 64).replace(/[^0-9A-Za-z\-.]/g, '');
const cleanCategory = (v) => (PANTRY_CATEGORIES.includes(v) ? v : 'Muu');
const cleanQty = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 9999) : 1;
};
function cleanDate(v) {
  const s = str(v, 10);
  if (!ISO_DATE.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : '';
}

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

  app.get('/api/pantry', (req, res) => {
    // Päivätyt ensin vanhenemisjärjestyksessä, päiväyksettömät loppuun.
    res.json({
      categories: PANTRY_CATEGORIES,
      items: db.prepare(`SELECT * FROM pantry_items
        ORDER BY best_before = '', best_before, name COLLATE NOCASE`).all(),
    });
  });

  app.get('/api/pantry/catalog/:barcode', (req, res) => {
    const row = db.prepare('SELECT * FROM pantry_catalog WHERE barcode = ?').get(cleanBarcode(req.params.barcode));
    res.json(row || null);
  });

  function pantryFields(body) {
    return {
      name: str(body.name, 200),
      barcode: cleanBarcode(body.barcode),
      category: cleanCategory(body.category),
      qty: Math.max(cleanQty(body.qty), 1),
      best_before: cleanDate(body.best_before),
    };
  }

  app.post('/api/pantry', (req, res) => {
    const f = pantryFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Nimi puuttuu' });
    const t = now();
    const info = db.prepare(`INSERT INTO pantry_items
      (name, barcode, category, qty, best_before, created_at, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(f.name, f.barcode, f.category, f.qty, f.best_before, t, req.user.name, t);
    if (f.barcode) remember.run(f.barcode, f.name, f.category, t);
    broadcast('pantry');
    res.json(getItem(info.lastInsertRowid));
  });

  app.put('/api/pantry/:id', (req, res) => {
    if (!getItem(req.params.id)) return res.status(404).json({ error: 'Tuotetta ei löydy' });
    const f = pantryFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Nimi puuttuu' });
    const t = now();
    db.prepare(`UPDATE pantry_items SET name = ?, barcode = ?, category = ?, qty = ?,
      best_before = ?, updated_at = ? WHERE id = ?`)
      .run(f.name, f.barcode, f.category, f.qty, f.best_before, t, req.params.id);
    if (f.barcode) remember.run(f.barcode, f.name, f.category, t);
    broadcast('pantry');
    res.json(getItem(req.params.id));
  });

  // Yksi kappale käytetty: määrä -1, viimeinen poistaa rivin.
  app.post('/api/pantry/:id/use', (req, res) => {
    const item = getItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Tuotetta ei löydy' });
    if (item.qty <= 1) db.prepare('DELETE FROM pantry_items WHERE id = ?').run(item.id);
    else db.prepare('UPDATE pantry_items SET qty = qty - 1, updated_at = ? WHERE id = ?').run(now(), item.id);
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

  app.get('/api/shopping', (req, res) => {
    // Ostamatta olevat ensin (vanhin ylimpänä), sitten tänään/viimeksi ostetut.
    res.json(db.prepare(`SELECT * FROM shopping_items
      ORDER BY done_at IS NOT NULL, CASE WHEN done_at IS NULL THEN created_at END,
      done_at DESC`).all());
  });

  app.post('/api/shopping', (req, res) => {
    const text = str(req.body.text, 200);
    if (!text) return res.status(400).json({ error: 'Kirjoita tuote' });
    // Sama tuote jo ostamatta listalla: ei tuplata riviä.
    const dup = db.prepare(`SELECT * FROM shopping_items WHERE done_at IS NULL
      AND lower(text) = lower(?)`).get(text);
    if (dup) return res.json({ ...dup, duplicate: true });
    const info = db.prepare(`INSERT INTO shopping_items (text, qty, added_by, created_at)
      VALUES (?, ?, ?, ?)`).run(text, str(req.body.qty, 40), req.user.name, now());
    broadcast('shopping');
    res.json(getShop(info.lastInsertRowid));
  });

  app.put('/api/shopping/:id', (req, res) => {
    const item = getShop(req.params.id);
    if (!item) return res.status(404).json({ error: 'Riviä ei löydy' });
    const text = req.body.text === undefined ? item.text : str(req.body.text, 200);
    if (!text) return res.status(400).json({ error: 'Kirjoita tuote' });
    const qty = req.body.qty === undefined ? item.qty : str(req.body.qty, 40);
    let doneAt = item.done_at, doneBy = item.done_by;
    if (req.body.done === true && !item.done_at) { doneAt = now(); doneBy = req.user.name; }
    if (req.body.done === false) { doneAt = null; doneBy = ''; }
    db.prepare('UPDATE shopping_items SET text = ?, qty = ?, done_at = ?, done_by = ? WHERE id = ?')
      .run(text, qty, doneAt, doneBy, item.id);
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

  return { broadcast, clientCount: () => clients.size };
};

module.exports.PANTRY_CATEGORIES = PANTRY_CATEGORIES;
module.exports.cleanDate = cleanDate;
