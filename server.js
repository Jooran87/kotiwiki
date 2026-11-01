// Oma dashboard -palvelin (pohjana Palmian työohje-wiki).
// Tarjoilee selainkäyttöliittymän (public/) ja REST-rajapinnan.
// Käynnistys: node server.js  (portti oletuksena 3000, säädettävissä PORT-muuttujalla)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { extractText } = require('./extract');
const buildOfflineHtml = require('./public/offline-template');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Tietoturvaotsakkeet ---
app.disable('x-powered-by');
app.use((req, res, next) => {
  // /offline on itsenäinen dokumentti, jonka haku vaatii inline-skriptin.
  const csp = req.path === '/offline'
    ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; " +
      "form-action 'self'; frame-ancestors 'self'; connect-src 'self'";
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Syötteiden pituusrajat kenttäkohtaisesti: estää kannan paisuttamisen
// roskadatalla. Sovelletaan kaikkiin JSON-pyyntöihin keskitetysti.
const FIELD_LIMITS = {
  title: 300, content: 500000, keywords: 500, author: 100, name: 200,
  label: 200, note: 500, phone: 60, url: 2000, term: 150, definition: 2000,
  icon: 24, color: 16,
};

// Kategorian väri: sallitaan vain #rrggbb tai tyhjä (estää CSS-injektion,
// koska väri sijoitetaan selaimessa inline-tyyliin).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const cleanColor = (v) => (HEX_COLOR.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : '');

const UPLOAD_DIR = path.join(process.env.ELAMA_DATA_DIR || path.join(__dirname, 'data'), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const [field, max] of Object.entries(FIELD_LIMITS)) {
      if (typeof req.body[field] === 'string' && req.body[field].length > max) {
        req.body[field] = req.body[field].slice(0, max);
      }
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ================= Kirjautuminen ja käyttöoikeudet =================
// Roolit: admin (ylläpitäjä) > editor (muokkaaja) > viewer (lukija).
// Salasanat scrypt-tiivisteinä, istunnot SQLitessa httpOnly-evästeellä.

const SESSION_COOKIE = 'elama_session';
const SESSION_DAYS = 30;

const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');

function verifyPassword(pw, salt, expectedHex) {
  const got = Buffer.from(hashPassword(pw, salt), 'hex');
  const exp = Buffer.from(expectedHex, 'hex');
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()); // laiska siivous
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, expires, now());
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function currentUser(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.username, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, now());
  return row || null;
}

const usersCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// Kirjautumisyritysten rajoitus: 5 epäonnistumista -> 60 s odotus per IP.
const loginFails = new Map();
function loginBlocked(ip) {
  const e = loginFails.get(ip);
  return e && e.count >= 5 && Date.now() < e.until;
}
function noteLoginFail(ip) {
  const e = loginFails.get(ip) || { count: 0, until: 0 };
  e.count += 1;
  e.until = Date.now() + 60000;
  loginFails.set(ip, e);
  // Siivotaan vanhentuneet merkinnät, ettei map kasva rajatta.
  if (loginFails.size > 500) {
    const now = Date.now();
    for (const [k, v] of loginFails) if (v.until < now) loginFails.delete(k);
  }
}

function validCredentials(username, password) {
  return typeof username === 'string' && username.trim().length >= 3 &&
    typeof password === 'string' && password.length >= 8;
}

function createUser({ username, name, password, role }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(
    'INSERT INTO users (username, name, role, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(username.trim().toLowerCase(), name.trim(), role, salt, hashPassword(password, salt), now());
  return info.lastInsertRowid;
}

// --- Avoimet reitit ---
app.get('/api/auth-status', (req, res) => {
  const user = currentUser(req);
  res.json({ setupRequired: usersCount() === 0, user });
});

// Ensikäynnistys: luo pääkäyttäjä. Sallittu VAIN kun yhtään käyttäjää ei ole.
app.post('/api/setup', (req, res) => {
  if (usersCount() > 0) return res.status(403).json({ error: 'Pääkäyttäjä on jo luotu' });
  const { username, password } = req.body;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nimi puuttuu' });
  if (!validCredentials(username, password)) {
    return res.status(400).json({ error: 'Tunnus vähintään 3 ja salasana vähintään 8 merkkiä' });
  }
  const id = createUser({ username, name, password, role: 'admin' });
  createSession(res, id);
  res.json({ ok: true, user: { id, username: username.trim().toLowerCase(), name, role: 'admin' } });
});

app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress || '?';
  if (loginBlocked(ip)) return res.status(429).json({ error: 'Liian monta yritystä – odota hetki' });
  const username = String(req.body.username || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !verifyPassword(String(req.body.password || ''), u.pass_salt, u.pass_hash)) {
    noteLoginFail(ip);
    return res.status(401).json({ error: 'Väärä tunnus tai salasana' });
  }
  loginFails.delete(ip);
  createSession(res, u.id);
  res.json({ ok: true, user: { id: u.id, username: u.username, name: u.name, role: u.role } });
});

app.post('/api/logout', (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// --- Portti: kaikki muu API ja /offline vaativat kirjautumisen ---
app.use((req, res, next) => {
  const guarded = req.path.startsWith('/api/') || req.path === '/offline';
  if (!guarded) return next();
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Kirjautuminen vaaditaan' });
  req.user = user;
  // Käyttäjähallinta vain ylläpitäjälle; muut kirjoitukset muokkaajalle+.
  if (req.path.startsWith('/api/users') && user.role !== 'admin') {
    return res.status(403).json({ error: 'Vain ylläpitäjä voi hallita käyttäjiä' });
  }
  if (req.method !== 'GET' && !req.path.startsWith('/api/users') &&
      user.role !== 'admin' && user.role !== 'editor') {
    return res.status(403).json({ error: 'Lukijan tunnuksella ei voi muokata' });
  }
  next();
});

// --- Käyttäjähallinta (vain admin, portti yllä) ---
app.get('/api/users', (req, res) => {
  res.json(db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY name').all());
});

app.post('/api/users', (req, res) => {
  const { username, password } = req.body;
  const name = (req.body.name || '').trim();
  const role = ['admin', 'editor', 'viewer'].includes(req.body.role) ? req.body.role : 'viewer';
  if (!name) return res.status(400).json({ error: 'Nimi puuttuu' });
  if (!validCredentials(username, password)) {
    return res.status(400).json({ error: 'Tunnus vähintään 3 ja salasana vähintään 8 merkkiä' });
  }
  try {
    const id = createUser({ username, name, password, role });
    res.json(db.prepare('SELECT id, username, name, role, created_at FROM users WHERE id = ?').get(id));
  } catch (e) {
    res.status(400).json({ error: 'Tunnus on jo käytössä' });
  }
});

app.put('/api/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Käyttäjää ei löydy' });
  const name = req.body.name !== undefined ? (req.body.name || '').trim() || u.name : u.name;
  let role = u.role;
  if (req.body.role !== undefined && ['admin', 'editor', 'viewer'].includes(req.body.role)) {
    // Viimeiseltä ylläpitäjältä ei saa viedä ylläpito-oikeutta.
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (u.role === 'admin' && req.body.role !== 'admin' && admins <= 1) {
      return res.status(400).json({ error: 'Viimeistä ylläpitäjää ei voi alentaa' });
    }
    role = req.body.role;
  }
  db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?').run(name, role, u.id);
  if (typeof req.body.password === 'string' && req.body.password.length > 0) {
    if (req.body.password.length < 8) return res.status(400).json({ error: 'Salasana vähintään 8 merkkiä' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?')
      .run(salt, hashPassword(req.body.password, salt), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // vanhat istunnot ulos
  }
  res.json(db.prepare('SELECT id, username, name, role, created_at FROM users WHERE id = ?').get(u.id));
});

app.delete('/api/users/:id', (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'Et voi poistaa omaa tunnustasi' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// ================= /kirjautuminen =================

// --- Tiedostolataukset (multer) ---
// Sallitut tyypit: PDF, kuvat, Word, Excel. Maksimikoko 50 MB.
const ALLOWED = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Tiedostotyyppiä ei sallita: ' + file.mimetype));
  },
});

const now = () => new Date().toISOString();

// ---------- Roskakori ----------
// Poistettu ohje ei katoa heti: se merkitään poistetuksi ja säilyy liitteineen
// TRASH_DAYS päivää, jonka jälkeen se siivotaan lopullisesti. Näin vuoron
// kiireessä tehty vahinkopoisto on aina peruttavissa.
const TRASH_DAYS = 30;

function purgeTrash() {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const old = db.prepare('SELECT id FROM pages WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff);
  if (!old.length) return 0;
  for (const p of old) deletePageFiles(p.id);
  db.prepare('DELETE FROM pages WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
  return old.length;
}

// ---------- Kategoriat (kohteet) ----------
app.get('/api/categories', (req, res) => {
  // page_count laskee vain näkyvät ohjeet (roskakorissa olevat eivät näy).
  const rows = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM pages p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS page_count
     FROM categories c ORDER BY c.sort_order, c.name`
  ).all();
  res.json(rows);
});

function parseParentId(raw) {
  return (raw != null && raw !== '') ? Number(raw) : null;
}

// Kaikkien alenevien (lasten, lastenlasten, ...) id:t – käytetään sekä
// poistoketjuun että silmukan estoon siirrossa.
function descendantIds(id) {
  const out = [];
  const stack = [id];
  const stmt = db.prepare('SELECT id FROM categories WHERE parent_id = ?');
  while (stack.length) {
    for (const r of stmt.all(stack.pop())) { out.push(r.id); stack.push(r.id); }
  }
  return out;
}

app.post('/api/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nimi puuttuu' });
  const icon = (req.body.icon || '').trim();
  const parentId = parseParentId(req.body.parent_id);
  if (parentId != null && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(parentId)) {
    return res.status(400).json({ error: 'Yläkategoriaa ei löydy' });
  }
  // Järjestysnumero lasketaan sisarusten (saman yläkategorian) kesken.
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS s FROM categories WHERE parent_id IS ?').get(parentId).s;
  const info = db.prepare('INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, icon, cleanColor(req.body.color), sort, parentId);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nimi puuttuu' });
  const icon = (req.body.icon || '').trim();
  const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Kategoriaa ei löydy' });
  let parentId = cur.parent_id;
  if ('parent_id' in req.body) {
    parentId = parseParentId(req.body.parent_id);
    if (parentId != null) {
      if (parentId === id) return res.status(400).json({ error: 'Kategoria ei voi olla oma yläkategoriansa' });
      if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(parentId))
        return res.status(400).json({ error: 'Yläkategoriaa ei löydy' });
      // Silmukan esto: uusi yläkategoria ei saa olla tämän kategorian aleneva.
      if (descendantIds(id).includes(parentId))
        return res.status(400).json({ error: 'Kategoriaa ei voi siirtää oman alakategoriansa alle' });
    }
  }
  const color = ('color' in req.body) ? cleanColor(req.body.color) : (cur.color || '');
  db.prepare('UPDATE categories SET name = ?, icon = ?, color = ?, parent_id = ? WHERE id = ?').run(name, icon, color, parentId, id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});

app.delete('/api/categories/:id', (req, res) => {
  // Kategorian poisto on peruuttamaton ja vie mukanaan sivut/liitteet, joten
  // se on rajattu ylläpitäjälle ja vaatii salasanan vahvistuksena.
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Vain ylläpitäjä voi poistaa kategorioita' });
  }
  const u = db.prepare('SELECT pass_salt, pass_hash FROM users WHERE id = ?').get(req.user.id);
  if (!u || !verifyPassword(String(req.body.password || ''), u.pass_salt, u.pass_hash)) {
    return res.status(403).json({ error: 'Väärä salasana – kategoriaa ei poistettu' });
  }
  // Poistaa kategorian, KAIKKI sen alenevat alakategoriat sekä niiden
  // sivut ja liitteet (levyltä).
  const id = Number(req.params.id);
  const allCatIds = [id, ...descendantIds(id)];
  const placeholders = allCatIds.map(() => '?').join(',');
  const pages = db.prepare(`SELECT id FROM pages WHERE category_id IN (${placeholders})`).all(...allCatIds);
  for (const p of pages) deletePageFiles(p.id);
  db.transaction(() => {
    db.prepare(`DELETE FROM categories WHERE id IN (${placeholders})`).run(...allCatIds);
  })();
  res.json({ ok: true });
});

// ---------- Yhteystiedot (puhelinnumerot) ----------
app.get('/api/contacts', (req, res) => {
  res.json(db.prepare('SELECT * FROM contacts ORDER BY sort_order, label').all());
});

app.post('/api/contacts', (req, res) => {
  const label = (req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Nimi puuttuu' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS s FROM contacts').get().s;
  const info = db.prepare('INSERT INTO contacts (label, phone, note, sort_order) VALUES (?, ?, ?, ?)')
    .run(label, (req.body.phone || '').trim(), (req.body.note || '').trim(), sort);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/contacts/:id', (req, res) => {
  const label = (req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Nimi puuttuu' });
  db.prepare('UPDATE contacts SET label = ?, phone = ?, note = ? WHERE id = ?')
    .run(label, (req.body.phone || '').trim(), (req.body.note || '').trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id));
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Järjestyksen tallennus (↑/↓-napit käyttöliittymässä) ----------
// Body: { ids: [...] } – sort_order asetetaan taulukon järjestyksen mukaan.
function makeReorder(table) {
  return (req, res) => {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids puuttuu' });
    const st = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
    db.transaction(() => ids.forEach((id, i) => st.run(i + 1, id)))();
    res.json({ ok: true });
  };
}
app.post('/api/categories/reorder', makeReorder('categories'));
app.post('/api/contacts/reorder', makeReorder('contacts'));
app.post('/api/links/reorder', makeReorder('links'));
app.post('/api/pages/reorder', makeReorder('pages'));

// ---------- Sivut (työohjeet) ----------
app.get('/api/pages', (req, res) => {
  const { category_id } = req.query;
  let rows;
  if (category_id) {
    // Kategorian sisällä käsin asetettu järjestys, uudet (0) aakkosissa alussa.
    rows = db.prepare('SELECT id, category_id, title, updated_at, updated_by, verified_at FROM pages WHERE category_id = ? AND deleted_at IS NULL ORDER BY sort_order, title').all(category_id);
  } else {
    rows = db.prepare('SELECT id, category_id, title, updated_at, updated_by, verified_at FROM pages WHERE deleted_at IS NULL ORDER BY title').all();
  }
  res.json(rows);
});

// Roskakorin sisältö: uusin poisto ensin, mukana montako päivää säilyy vielä.
app.get('/api/trash', (req, res) => {
  purgeTrash();
  const rows = db.prepare(
    `SELECT p.id, p.title, p.category_id, p.deleted_at, p.deleted_by, c.name AS category_name
     FROM pages p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`
  ).all();
  res.json(rows.map((r) => ({
    ...r,
    days_left: Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(r.deleted_at).getTime()) / 86400000)),
  })));
});

// Palautus roskakorista: ohje palaa kategoriaansa liitteineen ja historioineen.
app.post('/api/pages/:id/restore', (req, res) => {
  const page = db.prepare('SELECT id, deleted_at FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Ohjetta ei löydy' });
  if (!page.deleted_at) return res.status(400).json({ error: 'Ohje ei ole roskakorissa' });
  db.prepare("UPDATE pages SET deleted_at = NULL, deleted_by = '' WHERE id = ?").run(page.id);
  res.json(db.prepare('SELECT * FROM pages WHERE id = ?').get(page.id));
});

// Lopullinen poisto roskakorista: peruuttamaton, joten vain ylläpitäjä
// ja salasanavahvistus (sama linja kuin kategorian poistossa).
app.delete('/api/trash/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Vain ylläpitäjä voi tyhjentää roskakoria' });
  }
  const u = db.prepare('SELECT pass_salt, pass_hash FROM users WHERE id = ?').get(req.user.id);
  if (!u || !verifyPassword(String(req.body.password || ''), u.pass_salt, u.pass_hash)) {
    return res.status(403).json({ error: 'Väärä salasana – ohjetta ei poistettu' });
  }
  const page = db.prepare('SELECT id, deleted_at FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Ohjetta ei löydy' });
  if (!page.deleted_at) return res.status(400).json({ error: 'Ohje ei ole roskakorissa' });
  deletePageFiles(page.id);
  db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
  res.json({ ok: true });
});

// Suosituimmat ohjeet (katselukertojen mukaan). Määriteltävä ennen :id-reittiä.
app.get('/api/pages/popular', (req, res) => {
  const lim = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const rows = db.prepare(
    `SELECT p.id, p.title, p.category_id, p.views, c.name AS category_name
     FROM pages p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.views > 0 AND p.deleted_at IS NULL ORDER BY p.views DESC, p.title LIMIT ?`
  ).all(lim);
  res.json(rows);
});

app.get('/api/pages/:id', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Sivua ei löydy' });
  // Roskakorissa oleva ohje ei aukea normaalina sivuna (esim. vanha linkki).
  if (page.deleted_at) return res.status(404).json({ error: 'Ohje on roskakorissa' });
  // Lasketaan katselu vain kun sivua oikeasti avataan (ei muokkausnäkymässä).
  if (req.query.track) {
    db.prepare('UPDATE pages SET views = views + 1 WHERE id = ?').run(page.id);
    page.views += 1;
  }
  page.attachments = db.prepare('SELECT id, original_name, mimetype, size, uploaded_at, uploaded_by FROM attachments WHERE page_id = ? ORDER BY uploaded_at').all(page.id);
  res.json(page);
});

app.post('/api/pages', (req, res) => {
  const title = (req.body.title || '').trim();
  const category_id = req.body.category_id || null;
  const content = req.body.content || '';
  const author = req.user.name;
  const keywords = (req.body.keywords || '').trim();
  if (!title) return res.status(400).json({ error: 'Otsikko puuttuu' });
  const info = db.prepare(
    'INSERT INTO pages (category_id, title, content, keywords, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(category_id, title, content, keywords, now(), author);
  res.json(db.prepare('SELECT * FROM pages WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/pages/:id', (req, res) => {
  const title = (req.body.title || '').trim();
  const content = req.body.content || '';
  const author = req.user.name;
  const category_id = req.body.category_id || null;
  const keywords = (req.body.keywords || '').trim();
  if (!title) return res.status(400).json({ error: 'Otsikko puuttuu' });
  const old = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Sivua ei löydy' });
  // Versiohistoria: nykyinen versio talteen ennen päällekirjoitusta.
  // saved_at/saved_by = milloin ja kenen toimesta TUO versio aikanaan syntyi.
  db.prepare(
    'INSERT INTO page_revisions (page_id, title, content, keywords, category_id, saved_at, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(old.id, old.title, old.content, old.keywords, old.category_id, old.updated_at, old.updated_by);
  // Tilankäytön rajaus: säilytä enintään 30 viimeisintä versiota per sivu.
  db.prepare(
    `DELETE FROM page_revisions WHERE page_id = ? AND id NOT IN
     (SELECT id FROM page_revisions WHERE page_id = ? ORDER BY id DESC LIMIT 30)`
  ).run(old.id, old.id);
  db.prepare(
    'UPDATE pages SET title = ?, content = ?, keywords = ?, category_id = ?, updated_at = ?, updated_by = ? WHERE id = ?'
  ).run(title, content, keywords, category_id, now(), author, req.params.id);
  res.json(db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id));
});

// Vahvista ohje ajantasaiseksi (leima: kuka ja milloin).
app.post('/api/pages/:id/verify', (req, res) => {
  const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Sivua ei löydy' });
  db.prepare('UPDATE pages SET verified_at = ?, verified_by = ? WHERE id = ?')
    .run(now(), req.user.name, req.params.id);
  res.json(db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id));
});

// ---------- Versiohistoria ----------
app.get('/api/pages/:id/revisions', (req, res) => {
  const rows = db.prepare(
    'SELECT id, page_id, title, saved_at, saved_by FROM page_revisions WHERE page_id = ? ORDER BY id DESC'
  ).all(req.params.id);
  res.json(rows);
});

app.get('/api/revisions/:id', (req, res) => {
  const rev = db.prepare('SELECT * FROM page_revisions WHERE id = ?').get(req.params.id);
  if (!rev) return res.status(404).json({ error: 'Versiota ei löydy' });
  res.json(rev);
});

// Ohjeen poisto = siirto roskakoriin. Vaatii salasanavahvistuksen, jottei
// ohje katoa vahingossa väärään napin painallukseen kiireessä. Sisältö
// säilyy TRASH_DAYS päivää ja on palautettavissa.
app.delete('/api/pages/:id', (req, res) => {
  const page = db.prepare('SELECT id, deleted_at FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Ohjetta ei löydy' });
  const u = db.prepare('SELECT pass_salt, pass_hash FROM users WHERE id = ?').get(req.user.id);
  if (!u || !verifyPassword(String(req.body.password || ''), u.pass_salt, u.pass_hash)) {
    return res.status(403).json({ error: 'Väärä salasana – ohjetta ei poistettu' });
  }
  if (page.deleted_at) return res.json({ ok: true, alreadyDeleted: true });
  db.prepare('UPDATE pages SET deleted_at = ?, deleted_by = ? WHERE id = ?')
    .run(now(), req.user.name, page.id);
  res.json({ ok: true, trashed: true, days: TRASH_DAYS });
});

// ---------- Liitteet ----------
app.post('/api/pages/:id/attachments', upload.array('files', 10), async (req, res) => {
  const page = db.prepare('SELECT id, deleted_at FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Sivua ei löydy' });
  if (page.deleted_at) return res.status(400).json({ error: 'Ohje on roskakorissa – palauta se ensin' });
  const author = req.user.name;
  const stmt = db.prepare(
    'INSERT INTO attachments (page_id, stored_name, original_name, mimetype, size, uploaded_at, uploaded_by, text_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const ids = [];
  for (const f of req.files || []) {
    // Louhitaan tekstisisältö hakua varten (epäonnistuminen ei estä latausta).
    const text = await extractText(path.join(UPLOAD_DIR, f.filename), f.mimetype);
    const info = stmt.run(page.id, f.filename, f.originalname, f.mimetype, f.size, now(), author, text);
    ids.push(info.lastInsertRowid);
  }
  res.json({ ok: true, count: ids.length, ids });
});

app.get('/api/attachments/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!att) return res.status(404).send('Liitettä ei löydy');
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).send('Tiedostoa ei löydy levyltä');
  // inline = näytä selaimessa (esim. PDF/kuva), muut latautuvat.
  const inline = att.mimetype === 'application/pdf' || att.mimetype.startsWith('image/');
  // Turvakovennus: käyttäjän lataama tiedosto (erityisesti SVG) voi sisältää
  // aktiivista sisältöä. Tarjoillaan hiekkalaatikossa ja skriptit estäen,
  // ettei liitettä voi käyttää XSS-vektorina, vaikka se avattaisiin suoraan.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', att.mimetype);
  res.setHeader('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.original_name)}"`);
  fs.createReadStream(filePath).pipe(res);
});

app.delete('/api/attachments/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (att) {
    const filePath = path.join(UPLOAD_DIR, att.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
  }
  res.json({ ok: true });
});

// ---------- Tiedotteet ----------
app.get('/api/announcements', (req, res) => {
  const lim = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  res.json(db.prepare(
    'SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT ?'
  ).all(lim));
});

app.post('/api/announcements', (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Otsikko puuttuu' });
  const info = db.prepare(
    'INSERT INTO announcements (title, content, pinned, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title, req.body.content || '', req.body.pinned ? 1 : 0, now(), req.user.name, now());
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/announcements/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tiedotetta ei löydy' });
  const title = req.body.title !== undefined ? (req.body.title || '').trim() : existing.title;
  if (!title) return res.status(400).json({ error: 'Otsikko puuttuu' });
  const content = req.body.content !== undefined ? req.body.content : existing.content;
  const pinned = req.body.pinned !== undefined ? (req.body.pinned ? 1 : 0) : existing.pinned;
  db.prepare('UPDATE announcements SET title = ?, content = ?, pinned = ?, updated_at = ? WHERE id = ?')
    .run(title, content, pinned, now(), req.params.id);
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id));
});

app.delete('/api/announcements/:id', (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Linkit ----------
app.get('/api/links', (req, res) => {
  res.json(db.prepare('SELECT * FROM links ORDER BY sort_order, label').all());
});

app.post('/api/links', (req, res) => {
  const label = (req.body.label || '').trim();
  const url = normalizeUrl(req.body.url);
  if (!label) return res.status(400).json({ error: 'Nimi puuttuu' });
  if (!url) return res.status(400).json({ error: 'Osoite puuttuu' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS s FROM links').get().s;
  const info = db.prepare('INSERT INTO links (label, url, note, sort_order) VALUES (?, ?, ?, ?)')
    .run(label, url, (req.body.note || '').trim(), sort);
  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/links/:id', (req, res) => {
  const label = (req.body.label || '').trim();
  const url = normalizeUrl(req.body.url);
  if (!label) return res.status(400).json({ error: 'Nimi puuttuu' });
  if (!url) return res.status(400).json({ error: 'Osoite puuttuu' });
  db.prepare('UPDATE links SET label = ?, url = ?, note = ? WHERE id = ?')
    .run(label, url, (req.body.note || '').trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id));
});

app.delete('/api/links/:id', (req, res) => {
  db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Lisää https:// jos protokolla puuttuu.
function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// ---------- Termipankki ----------
app.get('/api/terms', (req, res) => {
  const rows = db.prepare('SELECT * FROM terms').all();
  rows.sort((a, b) => a.term.localeCompare(b.term, 'fi'));
  res.json(rows);
});

app.post('/api/terms', (req, res) => {
  const term = (req.body.term || '').trim();
  if (!term) return res.status(400).json({ error: 'Termi puuttuu' });
  const info = db.prepare('INSERT INTO terms (term, definition, updated_at, updated_by) VALUES (?, ?, ?, ?)')
    .run(term, (req.body.definition || '').trim(), now(), req.user.name);
  res.json(db.prepare('SELECT * FROM terms WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/terms/:id', (req, res) => {
  const term = (req.body.term || '').trim();
  if (!term) return res.status(400).json({ error: 'Termi puuttuu' });
  db.prepare('UPDATE terms SET term = ?, definition = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(term, (req.body.definition || '').trim(), now(), req.user.name, req.params.id);
  res.json(db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id));
});

app.delete('/api/terms/:id', (req, res) => {
  db.prepare('DELETE FROM terms WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Vuoroloki ----------
app.get('/api/shift-notes', (req, res) => {
  const { category_id, limit } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 100, 500);
  let rows;
  if (category_id) {
    rows = db.prepare(
      `SELECT n.*, c.name AS category_name FROM shift_notes n
       LEFT JOIN categories c ON c.id = n.category_id
       WHERE n.category_id = ? ORDER BY n.created_at DESC LIMIT ?`
    ).all(category_id, lim);
  } else {
    rows = db.prepare(
      `SELECT n.*, c.name AS category_name FROM shift_notes n
       LEFT JOIN categories c ON c.id = n.category_id
       ORDER BY n.created_at DESC LIMIT ?`
    ).all(lim);
  }
  res.json(rows);
});

app.post('/api/shift-notes', (req, res) => {
  const content = (req.body.content || '').trim();
  const author = req.user.name;
  const category_id = req.body.category_id || null;
  if (!content) return res.status(400).json({ error: 'Sisältö puuttuu' });
  const info = db.prepare(
    'INSERT INTO shift_notes (category_id, author, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(category_id, author, content, now());
  res.json(db.prepare('SELECT * FROM shift_notes WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/shift-notes/:id', (req, res) => {
  db.prepare('DELETE FROM shift_notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Haku ----------
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ pages: [], notes: [], files: [], announcements: [], terms: [], links: [] });
  // Escapetaan LIKE-jokerimerkit (% _ \), jotta haku on kirjaimellinen –
  // esim. "50%" tai "vika_koodi" osuu vain oikeisiin kohtiin. Jokainen
  // LIKE-lauseke käyttää ESCAPE '\'.
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  // Artikkelit: osuma otsikossa, sisällössä tai avainsanoissa. Mukaan ote.
  const pageRows = db.prepare(
    `SELECT p.id, p.title, p.content, p.keywords, p.category_id, c.name AS category_name
     FROM pages p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\' OR p.keywords LIKE ? ESCAPE '\\')
     ORDER BY p.title LIMIT 50`
  ).all(like, like, like);
  const pages = pageRows.map((p) => ({
    id: p.id, title: p.title, category_id: p.category_id, category_name: p.category_name,
    snippet: makeSnippet(p.content, q)
      || (p.keywords.toLowerCase().includes(q.toLowerCase()) ? 'Avainsanat: ' + p.keywords : ''),
  }));
  const notes = db.prepare(
    `SELECT n.id, n.content, n.author, n.created_at, n.category_id, c.name AS category_name
     FROM shift_notes n LEFT JOIN categories c ON c.id = n.category_id
     WHERE n.content LIKE ? ESCAPE '\\' ORDER BY n.created_at DESC LIMIT 50`
  ).all(like);
  // Liitteet: osuma tiedoston nimessä tai louhitussa sisällössä. Palautetaan
  // myös lyhyt ote (snippet) osumakohdan ympäriltä.
  const fileRows = db.prepare(
    `SELECT a.id, a.original_name, a.mimetype, a.text_content, a.page_id,
            p.title AS page_title, p.category_id, c.name AS category_name
     FROM attachments a
     JOIN pages p ON p.id = a.page_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (a.original_name LIKE ? ESCAPE '\\' OR a.text_content LIKE ? ESCAPE '\\')
     ORDER BY a.original_name LIMIT 50`
  ).all(like, like);
  const files = fileRows.map((f) => ({
    id: f.id, original_name: f.original_name, mimetype: f.mimetype,
    page_id: f.page_id, page_title: f.page_title,
    category_id: f.category_id, category_name: f.category_name,
    snippet: makeSnippet(f.text_content, q),
  }));
  const announcements = db.prepare(
    `SELECT id, title, content, pinned, created_at, created_by FROM announcements
     WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY pinned DESC, created_at DESC LIMIT 20`
  ).all(like, like).map((a) => ({ ...a, snippet: makeSnippet(a.content, q) }));
  const terms = db.prepare(
    "SELECT id, term, definition FROM terms WHERE term LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' LIMIT 20"
  ).all(like, like);
  terms.sort((a, b) => a.term.localeCompare(b.term, 'fi'));
  const links = db.prepare(
    "SELECT * FROM links WHERE label LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' ORDER BY sort_order, label LIMIT 20"
  ).all(like, like, like);
  res.json({ pages, notes, files, announcements, terms, links });
});

// Muodostaa lyhyen otteen hakusanan ympäriltä (Markdown-merkit siivottuna).
function makeSnippet(text, q) {
  if (!text) return '';
  const plain = text.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim();
  const idx = plain.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + q.length + 60);
  return (start > 0 ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '');
}

// ---------- Offline-versio ----------
// Kokoaa koko wikin yhdeksi HTML-tiedostoksi, jonka voi tallentaa puhelimeen
// ja käyttää ilman verkkoa. ?download=1 pakottaa tallennuksen tiedostona.
app.get('/offline', (req, res) => {
  const pages = db.prepare('SELECT * FROM pages WHERE deleted_at IS NULL').all();
  const attStmt = db.prepare('SELECT original_name FROM attachments WHERE page_id = ?');
  for (const p of pages) p.attachments = attStmt.all(p.id);
  const html = buildOfflineHtml({
    generatedAt: now(),
    categories: db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all(),
    pages,
    terms: db.prepare('SELECT * FROM terms').all(),
    contacts: db.prepare('SELECT * FROM contacts ORDER BY sort_order, label').all(),
    announcements: db.prepare('SELECT * FROM announcements').all(),
    links: db.prepare('SELECT * FROM links ORDER BY sort_order, label').all(),
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.query.download) {
    res.setHeader('Content-Disposition', 'attachment; filename="elama-offline.html"');
  }
  res.send(html);
});

// ---------- Apurit ----------
function deletePageFiles(pageId) {
  const atts = db.prepare('SELECT stored_name FROM attachments WHERE page_id = ?').all(pageId);
  for (const a of atts) {
    const fp = path.join(UPLOAD_DIR, a.stored_name);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

// Multer-virheet ihmisluettavaan muotoon.
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// Roskakorin siivous käynnistyksessä ja kerran vuorokaudessa.
// unref(): ajastin ei pidä prosessia (eikä testiajoa) hengissä.
const purged = purgeTrash();
if (purged) console.log(`Roskakorista siivottu ${purged} yli ${TRASH_DAYS} vrk vanhaa ohjetta.`);
setInterval(purgeTrash, 24 * 3600 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Oma dashboard käynnissä: http://localhost:${PORT}`);
});
