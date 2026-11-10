// Tietokantakerros. Käyttää SQLitea (yksi tiedosto: data/elama.db).
// Kotikäyttöön tämä on kevyt ja helppo varmuuskopioida.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ELAMA_DATA_DIR mahdollistaa erillisen kannan esim. testeille.
const DATA_DIR = process.env.ELAMA_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'elama.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id       INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    stored_name   TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mimetype      TEXT NOT NULL,
    size          INTEGER NOT NULL,
    uploaded_at   TEXT NOT NULL,
    uploaded_by   TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS shift_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    author      TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS page_revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    keywords    TEXT NOT NULL DEFAULT '',
    category_id INTEGER,
    saved_at    TEXT NOT NULL,
    saved_by    TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',  -- admin | editor | viewer
    pass_salt  TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    url        TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS terms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    term       TEXT NOT NULL,
    definition TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_revisions_page ON page_revisions(page_id);
  CREATE INDEX IF NOT EXISTS idx_pages_category ON pages(category_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_page ON attachments(page_id);
  CREATE INDEX IF NOT EXISTS idx_shift_notes_created ON shift_notes(created_at DESC);
`);

// Migraatio: liitteen louhittu tekstisisältö hakua varten.
const attCols = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
if (!attCols.includes('text_content')) {
  db.exec("ALTER TABLE attachments ADD COLUMN text_content TEXT NOT NULL DEFAULT ''");
}

// Migraatio: sivun katselukerrat (suosituimmat ohjeet -listaa varten).
const pageCols = db.prepare('PRAGMA table_info(pages)').all().map((c) => c.name);
if (!pageCols.includes('views')) {
  db.exec('ALTER TABLE pages ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
}

// Migraatio: sivun avainsanat hakua varten (pilkuin eroteltu lista).
if (!pageCols.includes('keywords')) {
  db.exec("ALTER TABLE pages ADD COLUMN keywords TEXT NOT NULL DEFAULT ''");
}

// Migraatio: kategorian ikoni.
const catCols = db.prepare('PRAGMA table_info(categories)').all().map((c) => c.name);
if (!catCols.includes('icon')) {
  db.exec("ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
}

// Migraatio: alakategoriat. parent_id viittaa yläkategoriaan (NULL = pääkategoria).
// Tuetaan mielivaltaista syvyyttä (kategoria → alakategoria → ...); silmukan
// esto ja poistoketju hoidetaan palvelinpäässä (descendantIds).
if (!catCols.includes('parent_id')) {
  db.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE');
}

// Migraatio: kategorian väriaksentti (heksana, esim. #ea6a1e; tyhjä = ei väriä).
if (!catCols.includes('color')) {
  db.exec("ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT ''");
}

// Migraatio: ohjeiden käsin asetettava järjestys kategorian sisällä.
if (!pageCols.includes('sort_order')) {
  db.exec('ALTER TABLE pages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}

// Migraatio: "vahvistettu ajantasaiseksi" -leima.
if (!pageCols.includes('verified_at')) {
  db.exec('ALTER TABLE pages ADD COLUMN verified_at TEXT');
  db.exec("ALTER TABLE pages ADD COLUMN verified_by TEXT NOT NULL DEFAULT ''");
}

// Migraatio: roskakori. deleted_at = poistohetki (NULL = näkyvä ohje).
// Poistettu ohje säilyy TRASH_DAYS päivää liitteineen ja versiohistorioineen,
// minkä jälkeen se siivotaan lopullisesti (server.js: purgeTrash).
if (!pageCols.includes('deleted_at')) {
  db.exec('ALTER TABLE pages ADD COLUMN deleted_at TEXT');
  db.exec("ALTER TABLE pages ADD COLUMN deleted_by TEXT NOT NULL DEFAULT ''");
}
// Osittaisindeksi: näkyvien ohjeiden haut ovat ylivoimaisesti yleisimpiä.
db.exec('CREATE INDEX IF NOT EXISTS idx_pages_live ON pages(category_id) WHERE deleted_at IS NULL');

// Migraatio: varmuusvarasto ja kauppalista (koti-routes.js).
// - pantry_items: varaston tuotteet päiväyksineen (best_before = YYYY-MM-DD tai '')
// - pantry_catalog: viivakoodi -> nimi + kategoria, jotta tuttu tuote täyttyy
//   skannatessa itsestään
// - shopping_items: yhteinen kauppalista (done_at NULL = vielä ostamatta)
db.exec(`
  CREATE TABLE IF NOT EXISTS pantry_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    barcode     TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Muu',
    qty         INTEGER NOT NULL DEFAULT 1,
    best_before TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    created_by  TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pantry_catalog (
    barcode    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'Muu',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shopping_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    qty        TEXT NOT NULL DEFAULT '',
    added_by   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    done_at    TEXT,
    done_by    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_pantry_bb ON pantry_items(best_before);
  CREATE INDEX IF NOT EXISTS idx_shopping_done ON shopping_items(done_at);
`);

// Migraatio: varaston tavoitemäärä (0 = ei tavoitetta). Kun tuotetta on alle
// tavoitteen, kauppalista ehdottaa sen ostamista.
const pantryCols = db.prepare('PRAGMA table_info(pantry_items)').all().map((c) => c.name);
if (!pantryCols.includes('target_qty')) {
  db.exec('ALTER TABLE pantry_items ADD COLUMN target_qty INTEGER NOT NULL DEFAULT 0');
}

// Migraatio: kauppalistan osasto (kaupan kiertojärjestys). Tyhjä = ei vielä
// määritetty; koti-routes.js täyttää vanhat rivit käynnistyksessä.
// shopping_sections muistaa käyttäjän itse valitseman osaston tuotteelle.
const shopCols = db.prepare('PRAGMA table_info(shopping_items)').all().map((c) => c.name);
if (!shopCols.includes('section')) {
  db.exec("ALTER TABLE shopping_items ADD COLUMN section TEXT NOT NULL DEFAULT ''");
}
db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_sections (
    name_key TEXT PRIMARY KEY,
    section  TEXT NOT NULL
  );
`);

// Migraatio: toistuvat kotityöt. next_due ja last_done_at ovat YYYY-MM-DD.
// Kuittaus siirtää next_due:n toistovälin päähän kuittauspäivästä.
db.exec(`
  CREATE TABLE IF NOT EXISTS chores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    every_n      INTEGER NOT NULL DEFAULT 1,
    unit         TEXT NOT NULL DEFAULT 'month',  -- day | week | month | year
    next_due     TEXT NOT NULL,
    last_done_at TEXT NOT NULL DEFAULT '',
    last_done_by TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    created_by   TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_chores_due ON chores(next_due);
`);

// Migraatio: etusivun ulkoisten lähteiden välimuisti (dashboard-sources.js).
// Yksi rivi per lähde: viimeisin onnistunut data JSON:na sekä tieto siitä,
// jos uusin haku on epäonnistunut (failed_at; data säilyy silti).
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_cache (
    source     TEXT PRIMARY KEY,
    data       TEXT NOT NULL DEFAULT '',
    fetched_at TEXT,
    failed_at  TEXT,
    error      TEXT NOT NULL DEFAULT ''
  );
`);

module.exports = db;
