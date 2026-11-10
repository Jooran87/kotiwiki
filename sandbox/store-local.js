'use strict';
// Datakerros SANDBOX-VERSIOLLE: ei palvelinta, kaikki selaimessa.
// - Rakenteinen data (kohteet, sivut, huomiot, liitteiden tiedot) localStorageen
// - Tiedostojen sisältö (blobit) IndexedDB:hen
// Tarjoaa saman `Store`-rajapinnan kuin store-api.js, joten app.js on identtinen.
// TARKOITUS: ulkoasun hiominen ja demo ilman asennusta. Data on vain tässä
// selaimessa; tyhjennä selaimen tallennustila nollataksesi.

// v2: demoon lisättiin varaston ja kauppalistan esimerkkidata.
const LS_KEY = 'elama_sandbox_v2';

// Varaston, kauppalistan ja kotitöiden säännöt tulevat samasta tiedostosta
// kuin palvelimella (public/koti-shared.js), joten ne eivät voi erkaantua.
// Määriteltävä ENNEN alustusta (ensureSeeded): vanhan datan täydennys
// käyttää näitä heti latauksessa.
const K = KotiShared;

// ---------- localStorage-malli ----------
function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (_) { return null; }
}
function save(db) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  catch (e) { console.warn('Tallennus selaimeen ei onnistunut:', e); }
}
let DB = load();

const nowISO = () => new Date().toISOString();
function nextId() { DB.seq += 1; return DB.seq; }
function catName(id) { const c = DB.categories.find((x) => x.id === id); return c ? c.name : null; }
// Väri sallitaan vain heksana (#rrggbb), muuten tyhjä – sama sääntö kuin palvelimella.
function cleanColor(v) { v = String(v || '').trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(v) ? v : ''; }
// Kaikkien alenevien alakategorioiden id:t (poistoketju + silmukan esto).
function localDescendantIds(id) {
  const out = []; const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of DB.categories.filter((x) => x.parent_id === cur)) { out.push(c.id); stack.push(c.id); }
  }
  return out;
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ---------- IndexedDB blobit ----------
// Osa selaimista (mm. Safari file://-tilassa) estää IndexedDB:n. Silloin
// liitteiden sisältö ei ole käytettävissä, mutta KAIKKI MUU toimii –
// virheet eivät saa kaataa sovellusta.
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('elama_sandbox_files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function putBlob(id, blob) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, id);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('Liitteen tallennus ei onnistu tässä selaimessa:', e); }
}
// Muistin säästö: object-URL luodaan vain kerran per liite ja käytetään
// uudelleen (ilman välimuistia jokainen sivun avaus vuotaisi uuden URL:n).
const blobUrlCache = new Map();
async function getBlobUrl(id) {
  if (blobUrlCache.has(id)) return blobUrlCache.get(id);
  try {
    const db = await idb();
    const blob = await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly');
      const rq = tx.objectStore('files').get(id);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    const url = blob ? URL.createObjectURL(blob) : '#';
    blobUrlCache.set(id, url);
    return url;
  } catch (e) { return '#'; }
}
async function delBlob(id) {
  const cached = blobUrlCache.get(id);
  if (cached && cached !== '#') URL.revokeObjectURL(cached);
  blobUrlCache.delete(id);
  try {
    const db = await idb();
    return await new Promise((res) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = () => res();
    });
  } catch (e) { /* ei kriittinen */ }
}

// ---------- Sallitut tiedostotyypit (kuten palvelimessa) ----------
const ALLOWED = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const MAX_SIZE = 50 * 1024 * 1024;
// Roskakori: poistettu ohje säilyy näin monta päivää ennen lopullista siivousta.
const TRASH_DAYS = 30;

// ---------- Alustus + esimerkkidata ----------
const ready = ensureSeeded();

async function ensureSeeded() {
  if (DB) { migrateExisting(); return; }
  DB = { seq: 0, categories: [], pages: [], notes: [], attachments: [], contacts: [], revisions: [], announcements: [], terms: [], links: [], pantry: [], pantryCatalog: {}, shopping: [], shopSections: {}, chores: [] };

  // Elämän osa-alueet. Vaihda omiksesi – tämä on vain runko.
  const koti = { id: nextId(), name: 'Koti', icon: 'svg:building', color: '#0369a1', sort_order: 0, parent_id: null };
  const auto = { id: nextId(), name: 'Auto ja liikkuminen', icon: 'svg:wrench', color: '#b45309', sort_order: 1, parent_id: null };
  const talous = { id: nextId(), name: 'Talous', icon: 'svg:folder', color: '#0f766e', sort_order: 2, parent_id: null };
  const terveys = { id: nextId(), name: 'Terveys', icon: 'svg:heart', color: '#9d174d', sort_order: 3, parent_id: null };
  const vapaa = { id: nextId(), name: 'Vapaa-aika', icon: 'svg:book', color: '#7c3aed', sort_order: 4, parent_id: null };
  DB.categories.push(koti, auto, talous, terveys, vapaa);

  // Alakategoriat (monta tasoa on tuettu, kuten pohjaprojektissa).
  const kotiLaitteet = { id: nextId(), name: 'Laitteet ja huolto', icon: 'svg:plug', sort_order: 1, parent_id: koti.id };
  const kotiRuoka = { id: nextId(), name: 'Ruoka ja reseptit', icon: 'svg:clipboard', sort_order: 2, parent_id: koti.id };
  const talousSop = { id: nextId(), name: 'Sopimukset', icon: 'svg:doc', sort_order: 1, parent_id: talous.id };
  // Kolmas taso: Koti > Laitteet ja huolto > huonekohtaisesti
  const laitKeittio = { id: nextId(), name: 'Keittiö', icon: 'svg:store', sort_order: 1, parent_id: kotiLaitteet.id };
  const laitPesu = { id: nextId(), name: 'Pesutupa', icon: 'svg:droplet', sort_order: 2, parent_id: kotiLaitteet.id };
  DB.categories.push(kotiLaitteet, kotiRuoka, talousSop, laitKeittio, laitPesu);

  mkPage(laitKeittio.id, 'Astianpesukoneen suodattimen puhdistus', `# Astianpesukoneen suodatin

**Väli:** kerran kuussa.

1. Ota alakori pois
2. Kierrä suodatin irti (vastapäivään)
3. Huuhtele juoksevan veden alla
4. Aseta takaisin ja varmista että lukittuu`, 'Minä', 'astianpesukone, suodatin, keittiö');

  mkPage(laitPesu.id, 'Pyykinpesukoneen nukkasihti', `# Nukkasihdin puhdistus

**Väli:** muutaman kuukauden välein.

1. Aseta matala astia luukun eteen – vettä tulee
2. Avaa etupaneelin alaluukku
3. Kierrä sihti irti ja puhdista
4. Kierrä takaisin tiukasti, muuten vuotaa`, 'Minä', 'pyykinpesukone, nukkasihti');

  mkPage(kotiLaitteet.id, 'Lämminvesivaraajan nollaus', `# Lämminvesivaraajan nollaus

Kun lämmintä vettä ei tule, kokeile tässä järjestyksessä.

## 1. Tarkista sulake
Sähkökaapissa varaajan oma sulake. Jos se on lauennut, kytke takaisin
ja odota **2–3 tuntia** – vesi ei lämpene hetkessä.

## 2. Ylikuumenemissuoja
Varaajan kyljessä on pieni punainen nappi suojakannen alla.
Paina kunnes kuuluu naksahdus.

## 3. Jos ei auta
Soita huoltoon. Kerro varaajan **malli ja valmistusvuosi**.

> Muista: älä avaa varaajan sähköosia itse.`, 'Minä', 'lämminvesi, varaaja, sulake');

  mkPage(kotiLaitteet.id, 'Ilmanvaihdon suodattimien vaihto', `# Suodattimien vaihto

**Väli:** noin 6 kk.

- Sammuta koneet ennen luukun avaamista
- Merkitse vaihtopäivä suodattimeen
- Tilaa uudet heti vaihdon jälkeen`, 'Minä', 'suodatin, ilmanvaihto, huolto');

  mkPage(kotiRuoka.id, 'Perusleipä', `# Perusleipä

## Aineet
- 5 dl vettä
- 25 g hiivaa
- 1 tl suolaa
- noin 12 dl jauhoja

## Ohje
1. Liuota hiiva kädenlämpöiseen veteen
2. Sekoita jauhot, vaivaa 10 min
3. Kohota 1 h
4. Paista 225 °C noin 25 min`, 'Minä', 'leipä, resepti');

  mkPage(auto.id, 'Katsastus ja määräaikaishuolto', `# Katsastus ja huolto

## Ennen katsastusta
- Valot ja vilkut
- Renkaiden urasyvyys (talvella vähintään 3 mm)
- Pyyhkijät ja pesuneste

## Mukaan
- Rekisteriote`, 'Minä', 'katsastus, huolto, auto');

  mkPage(talousSop.id, 'Sopimusten uusiminen', `# Sopimusten uusiminen

Käy läpi kerran vuodessa:

- **Sähkö** – sopimustyyppi ja päättymispäivä
- **Vakuutukset** – koti, auto, matka
- **Puhelin ja netti**

Merkitse päättymispäivät muistutuksiin.`, 'Minä', 'sopimus, vakuutus, kilpailutus');

  mkPage(terveys.id, 'Kotiapteekin tarkistus', `# Kotiapteekin tarkistus

**Väli:** kerran vuodessa.

- Tarkista viimeiset käyttöpäivät
- Vanhentuneet apteekkiin, ei roskiin
- Täydennä särkylääke, laastarit, kuumemittari`, 'Minä', 'kotiapteekki, lääkkeet');

  mkPage(vapaa.id, 'Retkeilyn pakkauslista', `# Retkeilyn pakkauslista

## Aina mukaan
- Kartta ja kompassi
- Vettä ja evästä
- Ensiapupakkaus
- Otsalamppu

## Talvella lisäksi
- Termospullo
- Varasukat ja -lapaset`, 'Minä', 'retkeily, pakkaus, luonto');

  const seedTerms = [
    ['Euribor', 'Euroalueen viitekorko. Asuntolainan korko on usein euribor + marginaali.'],
    ['Marginaali', 'Pankin oma lisä viitekoron päälle.'],
    ['Omavastuu', 'Osuus vahingosta, jonka maksat itse ennen kuin vakuutus korvaa.'],
    ['Spot-hinta', 'Sähkön pörssihinta, joka vaihtelee tunneittain.'],
  ];
  for (const [term, definition] of seedTerms) {
    DB.terms.push({ id: nextId(), term, definition, updated_at: nowISO(), updated_by: 'Minä' });
  }

  DB.contacts = defaultContacts();

  const seedLinks = [
    ['Omakanta', 'https://www.kanta.fi', 'reseptit ja terveystiedot'],
    ['Vero', 'https://www.vero.fi', 'veroilmoitus ja verokortti'],
    ['Ilmatieteen laitos', 'https://www.ilmatieteenlaitos.fi', 'säävaroitukset ja ennusteet'],
  ];
  for (const [label, url, note] of seedLinks) {
    DB.links.push({ id: nextId(), label, url, note, sort_order: DB.links.length + 1 });
  }

  mkNote(null, 'Minä', 'Suodattimet vaihdettu, seuraava kerta puolen vuoden päästä.');
  mkNote(auto.id, 'Minä', 'Renkaissa urasyvyyttä 4 mm – kestävät vielä ensi talven.');
  mkNote(koti.id, 'Minä', 'Varaajan malli ja vuosi kirjattu ohjeeseen.');

  DB.announcements.push(
    { id: nextId(), title: 'Auton katsastus umpeutuu maaliskuussa', content: 'Varaa aika hyvissä ajoin – ruuhka-aikaan vapaita aikoja on vähän.', pinned: 1, created_at: nowISO(), created_by: 'Minä', updated_at: nowISO() },
    { id: nextId(), title: 'Sähkösopimus päättyy syksyllä', content: 'Kilpailuta ennen automaattista jatkumista.', pinned: 0, created_at: nowISO(), created_by: 'Minä', updated_at: nowISO() }
  );

  // Esimerkkejä toistuvista kotitöistä (yksi myöhässä, jotta kuittaus näkyy demossa).
  const today = K.todayISO();
  const inDays = (days) => K.addInterval(today, days, 'day');
  const chore = (title, every_n, unit, days, note) => DB.chores.push({
    id: nextId(), title, note: note || '', every_n, unit, next_due: inDays(days),
    last_done_at: '', last_done_by: '', created_at: nowISO(), created_by: 'Minä' });
  chore('Puhdista liesituulettimen suodatin', 3, 'month', -4);
  chore('Testaa palovaroittimet', 1, 'month', 6);
  chore('Vaihda palovaroittimen paristo', 1, 'year', 120, '9 V paristo');

  // Esimerkkivarasto: mukana vanhentunut, pian vanheneva ja kaksi alle
  // tavoitemäärän olevaa tuotetta, jotta ostoehdotukset näkyvät heti.
  const pantry = (name, category, qty, days, target_qty, barcode) => {
    DB.pantry.push({ id: nextId(), name, barcode: barcode || '', category, qty, target_qty: target_qty || 0,
      best_before: days === null ? '' : inDays(days), created_at: nowISO(), created_by: 'Minä', updated_at: nowISO() });
    if (barcode) DB.pantryCatalog[barcode] = { barcode, name, category };
  };
  pantry('Vesi 1,5 l', 'Juomavesi', 8, 400, 20);
  pantry('Hernekeitto 435 g', 'Ruoka', 4, 12, 0, '6408430000258');
  pantry('Tonnikala', 'Ruoka', 6, 700);
  pantry('Näkkileipä', 'Ruoka', 2, 200);
  pantry('Särkylääke', 'Ensiapu ja lääkkeet', 1, -5);
  pantry('Paristot AA', 'Paristot ja valo', 2, null, 8);

  // Esimerkkikauppalista usealta osastolta + yksi jo ostettu.
  const shop = (text, qty, done) => DB.shopping.push({
    id: nextId(), text, qty: qty || '', section: K.guessSection(text), added_by: 'Minä', created_at: nowISO(),
    done_at: done ? nowISO() : null, done_by: done ? 'Minä' : '' });
  shop('Maito', '2 l'); shop('Banaanit'); shop('Ruisleipä'); shop('Jauheliha', '400 g');
  shop('Kahvi'); shop('Pakastepizza', '2 kpl'); shop('Tiskiaine'); shop('Kananmunat', '', true);

  save(DB);
}

// Oletusyhteystiedot (esimerkkidata + migraatio vanhaan dataan).
function defaultContacts() {
  return [
    { id: nextId(), label: 'Hätänumero', phone: '112', note: 'henkeä uhkaavat tilanteet', sort_order: 1 },
    { id: nextId(), label: 'Myrkytystietokeskus', phone: '0800 147 111', note: 'ympäri vuorokauden, maksuton', sort_order: 2 },
    { id: nextId(), label: 'Päivystysapu', phone: '116 117', note: 'kiireellinen hoidon tarve', sort_order: 3 },
    { id: nextId(), label: 'Taloyhtiön huolto', phone: '', note: 'täytä oma numerosi', sort_order: 4 },
    { id: nextId(), label: 'Vakuutusyhtiö', phone: '', note: 'täytä oma numerosi', sort_order: 5 },
    { id: nextId(), label: 'Sähköyhtiön vikailmoitus', phone: '', note: 'täytä oma numerosi', sort_order: 6 },
  ];
}


// Täydentää vanhat tallennukset uusilla kentillä ilman datan menetystä.
function migrateExisting() {
  let changed = false;
  if (!DB.contacts) { DB.contacts = defaultContacts(); changed = true; }
  if (!DB.revisions) { DB.revisions = []; changed = true; }
  if (!DB.announcements) { DB.announcements = []; changed = true; }
  if (!DB.terms) { DB.terms = []; changed = true; }
  if (!DB.links) { DB.links = []; changed = true; }
  if (!DB.pantry) { DB.pantry = []; changed = true; }
  if (!DB.pantryCatalog) { DB.pantryCatalog = {}; changed = true; }
  if (!DB.shopping) { DB.shopping = []; changed = true; }
  if (!DB.shopSections) { DB.shopSections = {}; changed = true; }
  if (!DB.chores) { DB.chores = []; changed = true; }
  DB.pantry.forEach((it) => { if (typeof it.target_qty !== 'number') { it.target_qty = 0; changed = true; } });
  DB.shopping.forEach((it) => { if (!K.cleanSection(it.section)) { it.section = sectionFor(it.text); changed = true; } });
  DB.categories.forEach((c) => { if (typeof c.icon !== 'string') { c.icon = ''; changed = true; } });
  DB.categories.forEach((c) => { if (c.parent_id === undefined) { c.parent_id = null; changed = true; } });
  DB.categories.forEach((c) => { if (typeof c.color !== 'string') { c.color = ''; changed = true; } });
  DB.pages.forEach((p) => {
    if (typeof p.views !== 'number') { p.views = 0; changed = true; }
    if (typeof p.keywords !== 'string') { p.keywords = ''; changed = true; }
    if (p.verified_at === undefined) { p.verified_at = null; p.verified_by = ''; changed = true; }
    if (typeof p.sort_order !== 'number') { p.sort_order = 0; changed = true; }
    if (p.deleted_at === undefined) { p.deleted_at = null; p.deleted_by = ''; changed = true; }
  });
  if (changed) save(DB);
}

function mkPage(catId, title, content, by, keywords) {
  const p = { id: nextId(), category_id: catId, title, content, keywords: keywords || '', updated_at: nowISO(), updated_by: by || '', views: 0, verified_at: null, verified_by: '', deleted_at: null, deleted_by: '' };
  DB.pages.push(p); return p;
}
function mkNote(catId, author, content) {
  DB.notes.push({ id: nextId(), category_id: catId, author: author || '', content, created_at: nowISO() });
}

// ---------- Hakuapurit (samat kuin palvelimen logiikka) ----------
function includesCI(hay, q) { return (hay || '').toLowerCase().includes(q.toLowerCase()); }
// Järjestyksen tallennus: sort_order asetetaan annetun id-listan mukaan.
function applyReorder(arr, ids) {
  ids.forEach((id, i) => {
    const item = arr.find((x) => x.id === Number(id));
    if (item) item.sort_order = i + 1;
  });
}

function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function makeSnippet(text, q) {
  if (!text) return '';
  const plain = text.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim();
  const idx = plain.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + q.length + 60);
  return (start > 0 ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '');
}

// Saman tuotteen muut rivit (sama nimi, eri päiväys).
const pantrySiblings = (name, exceptId) =>
  DB.pantry.filter((r) => r.id !== exceptId && K.nameKey(r.name) === K.nameKey(name));
// Osasto uudelle kauppalistan riville (sama järjestys kuin palvelimella).
function sectionFor(text, pantryCategory) {
  const key = K.nameKey(text);
  if (K.cleanSection(DB.shopSections[key])) return DB.shopSections[key];
  let cat = K.PANTRY_CATEGORIES.includes(pantryCategory) ? pantryCategory : '';
  if (!cat) {
    const known = [...Object.values(DB.pantryCatalog), ...DB.pantry].find((r) => K.nameKey(r.name) === key);
    if (known) cat = known.category;
  }
  return K.guessSection(text, cat);
}

// ---------- Store-rajapinta ----------
const Store = {
  mode: 'sandbox',

  // Sandboxissa ei ole kirjautumista – app.js ohittaa auth-vaiheen.
  auth: null,

  categories: {
    async list() {
      await ready;
      return clone(DB.categories)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((c) => ({ ...c, parent_id: c.parent_id != null ? c.parent_id : null, color: c.color || '',
          page_count: DB.pages.filter((p) => p.category_id === c.id && !p.deleted_at).length }));
    },
    async create(data) {
      await ready;
      const name = (data.name || '').trim();
      if (!name) throw new Error('Nimi puuttuu');
      const parentId = (data.parent_id != null && data.parent_id !== '') ? Number(data.parent_id) : null;
      if (parentId != null && !DB.categories.find((x) => x.id === parentId)) throw new Error('Yläkategoriaa ei löydy');
      const siblings = DB.categories.filter((x) => (x.parent_id || null) === parentId);
      const c = { id: nextId(), name, icon: (data.icon || '').trim(), color: cleanColor(data.color), parent_id: parentId,
        sort_order: (Math.max(0, ...siblings.map((x) => x.sort_order)) + 1) };
      DB.categories.push(c); save(DB); return clone(c);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const c = DB.categories.find((x) => x.id === id);
      if (!c) throw new Error('Kategoriaa ei löydy');
      const name = (data.name || '').trim();
      if (!name) throw new Error('Nimi puuttuu');
      if ('parent_id' in data) {
        const parentId = (data.parent_id != null && data.parent_id !== '') ? Number(data.parent_id) : null;
        if (parentId != null) {
          if (parentId === id) throw new Error('Kategoria ei voi olla oma yläkategoriansa');
          if (!DB.categories.find((x) => x.id === parentId)) throw new Error('Yläkategoriaa ei löydy');
          if (localDescendantIds(id).includes(parentId)) throw new Error('Kategoriaa ei voi siirtää oman alakategoriansa alle');
        }
        c.parent_id = parentId;
      }
      if ('color' in data) c.color = cleanColor(data.color);
      c.name = name; c.icon = (data.icon || '').trim();
      save(DB); return clone(c);
    },
    async remove(id) {
      await ready; id = Number(id);
      const allCatIds = [id, ...localDescendantIds(id)];
      const pageIds = DB.pages.filter((p) => allCatIds.includes(p.category_id)).map((p) => p.id);
      for (const pid of pageIds) await removePageInternal(pid);
      DB.categories = DB.categories.filter((c) => !allCatIds.includes(c.id));
      save(DB); return { ok: true };
    },
    async reorder(ids) { await ready; applyReorder(DB.categories, ids); save(DB); return { ok: true }; },
  },

  pages: {
    async list(categoryId) {
      await ready;
      const pick = ({ id, category_id, title, updated_at, updated_by, verified_at }) =>
        ({ id, category_id, title, updated_at, updated_by, verified_at });
      let rows = DB.pages.filter((p) => !p.deleted_at); // roskakori ei näy listoissa
      if (categoryId) {
        categoryId = Number(categoryId);
        rows = rows.filter((p) => p.category_id === categoryId);
        return clone(rows)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.title.localeCompare(b.title))
          .map(pick);
      }
      return clone(rows).sort((a, b) => a.title.localeCompare(b.title)).map(pick);
    },
    async get(id, { track } = {}) {
      await ready; id = Number(id);
      const p = DB.pages.find((x) => x.id === id);
      if (!p) throw new Error('Sivua ei löydy');
      if (p.deleted_at) throw new Error('Ohje on roskakorissa');
      if (track) { p.views = (p.views || 0) + 1; save(DB); }
      const out = clone(p);
      out.attachments = [];
      for (const a of DB.attachments.filter((x) => x.page_id === id)) {
        out.attachments.push({
          id: a.id, original_name: a.original_name, mimetype: a.mimetype, size: a.size,
          uploaded_at: a.uploaded_at, uploaded_by: a.uploaded_by, url: await getBlobUrl(a.id),
        });
      }
      return out;
    },
    async create(data) {
      await ready;
      const p = mkPage(data.category_id ? Number(data.category_id) : null, (data.title || '').trim(), data.content || '', (data.author || '').trim(), (data.keywords || '').trim());
      save(DB); return clone(p);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const p = DB.pages.find((x) => x.id === id);
      if (!p) throw new Error('Sivua ei löydy');
      // Versiohistoria: nykyinen versio talteen ennen päällekirjoitusta.
      DB.revisions.push({
        id: nextId(), page_id: p.id, title: p.title, content: p.content,
        keywords: p.keywords || '', category_id: p.category_id,
        saved_at: p.updated_at, saved_by: p.updated_by,
      });
      // Tilankäytön rajaus (localStorage ~5 Mt): enintään 10 versiota per sivu.
      const mine = DB.revisions.filter((r) => r.page_id === p.id).sort((a, b) => b.id - a.id);
      if (mine.length > 10) {
        const keep = new Set(mine.slice(0, 10).map((r) => r.id));
        DB.revisions = DB.revisions.filter((r) => r.page_id !== p.id || keep.has(r.id));
      }
      p.title = (data.title || '').trim();
      p.content = data.content || '';
      p.keywords = (data.keywords || '').trim();
      p.category_id = data.category_id ? Number(data.category_id) : null;
      p.updated_at = nowISO(); p.updated_by = (data.author || '').trim();
      save(DB); return clone(p);
    },
    // Poisto = siirto roskakoriin. Sandboxissa ei ole kirjautumista, joten
    // salasanaa ei vaadita (vrt. kategorian poisto) – palvelinversiossa vaaditaan.
    async remove(id) {
      await ready; id = Number(id);
      const p = DB.pages.find((x) => x.id === id);
      if (!p) throw new Error('Sivua ei löydy');
      if (!p.deleted_at) { p.deleted_at = nowISO(); p.deleted_by = ''; save(DB); }
      return { ok: true, trashed: true, days: TRASH_DAYS };
    },
    async restore(id) {
      await ready; id = Number(id);
      const p = DB.pages.find((x) => x.id === id);
      if (!p) throw new Error('Ohjetta ei löydy');
      if (!p.deleted_at) throw new Error('Ohje ei ole roskakorissa');
      p.deleted_at = null; p.deleted_by = ''; save(DB); return clone(p);
    },
    async reorder(ids) { await ready; applyReorder(DB.pages, ids); save(DB); return { ok: true }; },
    async verify(id, byAuthor) {
      await ready; id = Number(id);
      const p = DB.pages.find((x) => x.id === id);
      if (!p) throw new Error('Sivua ei löydy');
      p.verified_at = nowISO(); p.verified_by = (byAuthor || '').trim();
      save(DB); return clone(p);
    },
    async revisions(id) {
      await ready; id = Number(id);
      return clone(DB.revisions.filter((r) => r.page_id === id))
        .sort((a, b) => b.id - a.id)
        .map(({ id: rid, page_id, title, saved_at, saved_by }) => ({ id: rid, page_id, title, saved_at, saved_by }));
    },
  },

  attachments: {
    async url(id) { await ready; return getBlobUrl(Number(id)); },
    async upload(pageId, files, author) {
      await ready; pageId = Number(pageId);
      const target = DB.pages.find((p) => p.id === pageId);
      if (!target) throw new Error('Sivua ei löydy');
      if (target.deleted_at) throw new Error('Ohje on roskakorissa – palauta se ensin');
      for (const f of files) {
        if (!ALLOWED.has(f.type)) throw new Error('Tiedostotyyppiä ei sallita: ' + (f.type || 'tuntematon'));
        if (f.size > MAX_SIZE) throw new Error('Tiedosto on liian suuri (max 50 Mt)');
      }
      const newIds = [];
      for (const f of files) {
        const id = nextId();
        newIds.push(id);
        // Selaimessa ei louhita PDF/Office-tekstiä; text-tyypeistä luetaan sisältö.
        // Katto 200 kt merkkejä, ettei localStorage täyty.
        let text = '';
        if (f.type.startsWith('text/')) {
          try { text = (await f.text()).slice(0, 200000); } catch (_) {}
        }
        DB.attachments.push({
          id, page_id: pageId, original_name: f.name, mimetype: f.type,
          size: f.size, uploaded_at: nowISO(), uploaded_by: author || '', text_content: text,
        });
        await putBlob(id, f);
      }
      save(DB); return { ok: true, count: newIds.length, ids: newIds };
    },
    async remove(id) {
      await ready; id = Number(id);
      DB.attachments = DB.attachments.filter((a) => a.id !== id);
      await delBlob(id); save(DB); return { ok: true };
    },
  },

  links: {
    async list() {
      await ready;
      return clone(DB.links).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'fi'));
    },
    async create(data) {
      await ready;
      const label = (data.label || '').trim();
      const url = normalizeUrl(data.url);
      if (!label) throw new Error('Nimi puuttuu');
      if (!url) throw new Error('Osoite puuttuu');
      const l = { id: nextId(), label, url, note: (data.note || '').trim(),
        sort_order: (Math.max(0, ...DB.links.map((x) => x.sort_order)) + 1) };
      DB.links.push(l); save(DB); return clone(l);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const l = DB.links.find((x) => x.id === id);
      if (!l) throw new Error('Linkkiä ei löydy');
      const label = (data.label || '').trim();
      const url = normalizeUrl(data.url);
      if (!label) throw new Error('Nimi puuttuu');
      if (!url) throw new Error('Osoite puuttuu');
      l.label = label; l.url = url; l.note = (data.note || '').trim();
      save(DB); return clone(l);
    },
    async remove(id) {
      await ready; id = Number(id);
      DB.links = DB.links.filter((l) => l.id !== id); save(DB); return { ok: true };
    },
    async reorder(ids) { await ready; applyReorder(DB.links, ids); save(DB); return { ok: true }; },
  },

  terms: {
    async list() {
      await ready;
      return clone(DB.terms).sort((a, b) => a.term.localeCompare(b.term, 'fi'));
    },
    async create(data) {
      await ready;
      const term = (data.term || '').trim();
      if (!term) throw new Error('Termi puuttuu');
      const t = { id: nextId(), term, definition: (data.definition || '').trim(), updated_at: nowISO(), updated_by: (data.author || '').trim() };
      DB.terms.push(t); save(DB); return clone(t);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const t = DB.terms.find((x) => x.id === id);
      if (!t) throw new Error('Termiä ei löydy');
      const term = (data.term || '').trim();
      if (!term) throw new Error('Termi puuttuu');
      t.term = term; t.definition = (data.definition || '').trim();
      t.updated_at = nowISO(); t.updated_by = (data.author || '').trim();
      save(DB); return clone(t);
    },
    async remove(id) {
      await ready; id = Number(id);
      DB.terms = DB.terms.filter((t) => t.id !== id); save(DB); return { ok: true };
    },
  },

  revisions: {
    async get(id) {
      await ready; id = Number(id);
      const r = DB.revisions.find((x) => x.id === id);
      if (!r) throw new Error('Versiota ei löydy');
      return clone(r);
    },
  },

  announcements: {
    async list(limit) {
      await ready;
      const rows = clone(DB.announcements)
        .sort((a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at));
      return limit ? rows.slice(0, limit) : rows;
    },
    async create(data) {
      await ready;
      const title = (data.title || '').trim();
      if (!title) throw new Error('Otsikko puuttuu');
      const a = {
        id: nextId(), title, content: data.content || '', pinned: data.pinned ? 1 : 0,
        created_at: nowISO(), created_by: (data.author || '').trim(), updated_at: nowISO(),
      };
      DB.announcements.push(a); save(DB); return clone(a);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const a = DB.announcements.find((x) => x.id === id);
      if (!a) throw new Error('Muistutusta ei löydy');
      if (data.title !== undefined) {
        const t = (data.title || '').trim();
        if (!t) throw new Error('Otsikko puuttuu');
        a.title = t;
      }
      if (data.content !== undefined) a.content = data.content;
      if (data.pinned !== undefined) a.pinned = data.pinned ? 1 : 0;
      a.updated_at = nowISO();
      save(DB); return clone(a);
    },
    async remove(id) {
      await ready; id = Number(id);
      DB.announcements = DB.announcements.filter((a) => a.id !== id);
      save(DB); return { ok: true };
    },
  },

  contacts: {
    async list() { await ready; return clone(DB.contacts).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)); },
    async create(data) {
      await ready;
      const c = { id: nextId(), label: (data.label || '').trim(), phone: (data.phone || '').trim(), note: (data.note || '').trim(),
        sort_order: (Math.max(0, ...DB.contacts.map((x) => x.sort_order)) + 1) };
      DB.contacts.push(c); save(DB); return clone(c);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const c = DB.contacts.find((x) => x.id === id);
      if (c) { c.label = (data.label || '').trim(); c.phone = (data.phone || '').trim(); c.note = (data.note || '').trim(); }
      save(DB); return clone(c);
    },
    async remove(id) {
      await ready; id = Number(id);
      DB.contacts = DB.contacts.filter((c) => c.id !== id); save(DB); return { ok: true };
    },
    async reorder(ids) { await ready; applyReorder(DB.contacts, ids); save(DB); return { ok: true }; },
  },

  // ---------- Varmuusvarasto (sama rajapinta kuin palvelimella) ----------
  pantry: {
    async list() {
      await ready;
      const items = clone(DB.pantry).sort((a, b) =>
        (a.best_before === '') - (b.best_before === '') || a.best_before.localeCompare(b.best_before) || a.name.localeCompare(b.name, 'fi'));
      return { categories: K.PANTRY_CATEGORIES, items };
    },
    async lookup(code) { await ready; const c = DB.pantryCatalog[code]; return c ? clone(c) : null; },
    async create(data) {
      await ready;
      const f = K.pantryFields(data);
      if (!f.name) throw new Error('Nimi puuttuu');
      const same = pantrySiblings(f.name);
      // Uusi erä perii tuotteen tavoitteen ja korvaa "loppu"-muistilapun.
      if (!f.target_qty) f.target_qty = Math.max(0, ...same.map((r) => r.target_qty));
      DB.pantry = DB.pantry.filter((r) => !(same.includes(r) && r.qty === 0));
      same.forEach((r) => { r.target_qty = f.target_qty; });
      const it = { id: nextId(), ...f, created_at: nowISO(), created_by: '', updated_at: nowISO() };
      DB.pantry.push(it);
      if (f.barcode) DB.pantryCatalog[f.barcode] = { barcode: f.barcode, name: f.name, category: f.category };
      save(DB); return clone(it);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const it = DB.pantry.find((x) => x.id === id);
      if (!it) throw new Error('Tuotetta ei löydy');
      const f = K.pantryFields(data);
      if (!f.name) throw new Error('Nimi puuttuu');
      const same = pantrySiblings(f.name, id);
      // Nimen vaihto toiseksi tuotteeksi: rivi perii uuden tuotteensa tavoitteen.
      if (!f.target_qty && K.nameKey(it.name) !== K.nameKey(f.name)) {
        f.target_qty = Math.max(0, ...same.map((r) => r.target_qty));
      }
      Object.assign(it, f, { updated_at: nowISO() });
      same.forEach((r) => { r.target_qty = f.target_qty; });
      if (f.barcode) DB.pantryCatalog[f.barcode] = { barcode: f.barcode, name: f.name, category: f.category };
      save(DB); return clone(it);
    },
    // Viimeinen kappale poistaa rivin, paitsi jos tuotteella on tavoitemäärä
    // eikä muita eriä ole: silloin rivi jää määrällä 0 muistuttamaan ostamisesta.
    async useOne(id) {
      await ready; id = Number(id);
      const it = DB.pantry.find((x) => x.id === id);
      if (!it) throw new Error('Tuotetta ei löydy');
      if (it.qty > 1) it.qty -= 1;
      else if (it.target_qty > 0 && !pantrySiblings(it.name, id).length) { it.qty = 0; it.best_before = ''; }
      else {
        DB.pantry = DB.pantry.filter((x) => x.id !== id);
        save(DB); return { id, qty: 0, removed: true };
      }
      it.updated_at = nowISO();
      save(DB); return clone(it);
    },
    async remove(id) { await ready; id = Number(id); DB.pantry = DB.pantry.filter((x) => x.id !== id); save(DB); return { ok: true }; },
  },

  // ---------- Kauppalista ----------
  shopping: {
    async list() {
      await ready;
      const open = DB.shopping.filter((i) => !i.done_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const done = DB.shopping.filter((i) => i.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
      return clone([...open, ...done]);
    },
    async add(text, qty, category) {
      await ready;
      text = String(text || '').trim().slice(0, 200);
      if (!text) throw new Error('Kirjoita tuote');
      const dup = DB.shopping.find((i) => !i.done_at && K.nameKey(i.text) === K.nameKey(text));
      if (dup) return { ...clone(dup), duplicate: true };
      const it = { id: nextId(), text, qty: String(qty || '').trim().slice(0, 40), section: sectionFor(text, category),
        added_by: '', created_at: nowISO(), done_at: null, done_by: '' };
      DB.shopping.push(it); save(DB); return clone(it);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const it = DB.shopping.find((x) => x.id === id);
      if (!it) throw new Error('Riviä ei löydy');
      if (data.text !== undefined) it.text = String(data.text).trim().slice(0, 200) || it.text;
      if (data.qty !== undefined) it.qty = String(data.qty).trim().slice(0, 40);
      // Käsin vaihdettu osasto muistetaan tälle tuotteelle.
      const section = K.cleanSection(data.section);
      if (section && section !== it.section) { it.section = section; DB.shopSections[K.nameKey(it.text)] = section; }
      if (data.done === true && !it.done_at) it.done_at = nowISO();
      if (data.done === false) it.done_at = null;
      save(DB); return clone(it);
    },
    async remove(id) { await ready; id = Number(id); DB.shopping = DB.shopping.filter((x) => x.id !== id); save(DB); return { ok: true }; },
    async clearDone() {
      await ready;
      const before = DB.shopping.length;
      DB.shopping = DB.shopping.filter((i) => !i.done_at);
      save(DB); return { removed: before - DB.shopping.length };
    },
  },

  // ---------- Toistuvat kotityöt ----------
  chores: {
    async list() {
      await ready;
      return clone(DB.chores).sort((a, b) => a.next_due.localeCompare(b.next_due) || a.title.localeCompare(b.title, 'fi'));
    },
    async create(data) {
      await ready;
      const f = K.choreFields(data, K.todayISO());
      if (!f.title) throw new Error('Anna tehtävälle nimi');
      const c = { id: nextId(), ...f, last_done_at: '', last_done_by: '', created_at: nowISO(), created_by: '' };
      DB.chores.push(c); save(DB); return clone(c);
    },
    async update(id, data) {
      await ready; id = Number(id);
      const c = DB.chores.find((x) => x.id === id);
      if (!c) throw new Error('Tehtävää ei löydy');
      const f = K.choreFields(data, K.todayISO());
      if (!f.title) throw new Error('Anna tehtävälle nimi');
      Object.assign(c, f);
      save(DB); return clone(c);
    },
    async done(id, date) {
      await ready; id = Number(id);
      const c = DB.chores.find((x) => x.id === id);
      if (!c) throw new Error('Tehtävää ei löydy');
      const day = K.doneDate(date, K.todayISO());
      c.last_done_at = day; c.last_done_by = '';
      c.next_due = K.addInterval(day, c.every_n, c.unit);
      save(DB); return clone(c);
    },
    async remove(id) { await ready; id = Number(id); DB.chores = DB.chores.filter((x) => x.id !== id); save(DB); return { ok: true }; },
  },

  // Sandboxissa ei ole palvelinta eikä muita laitteita → ei reaaliaikaisuutta.
  events: null,

  notes: {
    async list({ categoryId, limit } = {}) {
      await ready;
      let rows = clone(DB.notes);
      if (categoryId) { categoryId = Number(categoryId); rows = rows.filter((n) => n.category_id === categoryId); }
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (limit) rows = rows.slice(0, limit);
      return rows.map((n) => ({ ...n, category_name: catName(n.category_id) }));
    },
    async create(data) {
      await ready;
      const n = { id: nextId(), category_id: data.category_id ? Number(data.category_id) : null, author: (data.author || '').trim(), content: (data.content || '').trim(), created_at: nowISO() };
      DB.notes.push(n); save(DB); return clone(n);
    },
    async remove(id) {
      await ready; id = Number(id);
      DB.notes = DB.notes.filter((n) => n.id !== id); save(DB); return { ok: true };
    },
  },

  // ---------- Roskakori ----------
  trash: {
    async list() {
      await ready;
      purgeTrashLocal();
      return clone(DB.pages).filter((p) => p.deleted_at)
        .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)))
        .map((p) => ({
          id: p.id, title: p.title, category_id: p.category_id,
          category_name: catName(p.category_id), deleted_at: p.deleted_at, deleted_by: p.deleted_by || '',
          days_left: Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(p.deleted_at).getTime()) / 86400000)),
        }));
    },
    // Lopullinen poisto. Sandboxissa ei ole salasanoja, joten parametri ohitetaan.
    async remove(id) {
      await ready; id = Number(id);
      const p = DB.pages.find((x) => x.id === id);
      if (!p) throw new Error('Ohjetta ei löydy');
      if (!p.deleted_at) throw new Error('Ohje ei ole roskakorissa');
      await removePageInternal(id); save(DB); return { ok: true };
    },
  },

  async search(q) {
    await ready;
    q = (q || '').trim();
    if (!q) return { pages: [], notes: [], files: [], announcements: [], terms: [], links: [] };
    const pages = DB.pages.filter((p) => !p.deleted_at &&
      (includesCI(p.title, q) || includesCI(p.content, q) || includesCI(p.keywords, q)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => ({
        id: p.id, title: p.title, category_id: p.category_id, category_name: catName(p.category_id),
        snippet: makeSnippet(p.content, q)
          || (includesCI(p.keywords, q) ? 'Avainsanat: ' + p.keywords : ''),
      }));
    const notes = DB.notes.filter((n) => includesCI(n.content, q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((n) => ({ ...clone(n), category_name: catName(n.category_id) }));
    const files = [];
    for (const a of DB.attachments.filter((x) => includesCI(x.original_name, q) || includesCI(x.text_content, q))) {
      const page = DB.pages.find((p) => p.id === a.page_id);
      if (page && page.deleted_at) continue; // roskakorissa olevan ohjeen liite ei näy haussa
      files.push({
        id: a.id, original_name: a.original_name, mimetype: a.mimetype,
        page_id: a.page_id, page_title: page ? page.title : '',
        category_id: page ? page.category_id : null, category_name: page ? catName(page.category_id) : null,
        snippet: makeSnippet(a.text_content, q), url: await getBlobUrl(a.id),
      });
    }
    const announcements = clone(DB.announcements)
      .filter((a) => includesCI(a.title, q) || includesCI(a.content, q))
      .sort((a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at))
      .map((a) => ({ ...a, snippet: makeSnippet(a.content, q) }));
    const terms = clone(DB.terms)
      .filter((t) => includesCI(t.term, q) || includesCI(t.definition, q))
      .sort((a, b) => a.term.localeCompare(b.term, 'fi'));
    const links = clone(DB.links)
      .filter((l) => includesCI(l.label, q) || includesCI(l.url, q) || includesCI(l.note, q))
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'fi'));
    return { pages, notes, files, announcements, terms, links };
  },
};

// Siivoaa yli TRASH_DAYS vrk roskakorissa olleet ohjeet lopullisesti.
// Kutsutaan roskakoria avattaessa (sandboxissa ei ole taustaprosessia).
function purgeTrashLocal() {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const old = DB.pages.filter((p) => p.deleted_at && p.deleted_at < cutoff);
  if (!old.length) return;
  // Tarkoituksella tulinen: blobien poisto on asynkroninen, mutta listaus ei
  // odota sitä – data katoaa joka tapauksessa seuraavaan tallennukseen mennessä.
  Promise.all(old.map((p) => removePageInternal(p.id))).then(() => save(DB));
}

async function removePageInternal(id) {
  const atts = DB.attachments.filter((a) => a.page_id === id);
  for (const a of atts) await delBlob(a.id);
  DB.attachments = DB.attachments.filter((a) => a.page_id !== id);
  DB.revisions = DB.revisions.filter((r) => r.page_id !== id);
  DB.pages = DB.pages.filter((p) => p.id !== id);
}
