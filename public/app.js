'use strict';

// ---------- Pieni apukirjasto ----------
const $ = (sel, root = document) => root.querySelector(sel);
const content = $('#content');

// Datakerros (`Store`) tulee erillisestä tiedostosta: palvelinversiossa
// store-api.js (REST), sandbox-versiossa store-local.js (selaimen tallennus).

// Varoitus tallentamattomista muutoksista. Kattaa KAKSI reittiä ulos:
// 1) selaimen sulkeminen/uudelleenlataus (onbeforeunload)
// 2) siirtyminen wikin sisällä (hash-reititys) – tämä EI laukaise
//    onbeforeunloadia, joten router() kysyy erikseen (kts. unsavedDirty).
let unsavedDirty = false;
function setUnsavedGuard(on) {
  unsavedDirty = !!on;
  window.onbeforeunload = on ? () => true : null;
}

// ---------- Luonnokset: keskeneräinen teksti ei katoa ----------
// Muokkauskentät tallentuvat selaimeen näppäily näppäilyltä. Jos vuoro
// keskeytyy ja käyttäjä poistuu, teksti on palautettavissa.
const draftKey = (id) => 'elama_draft_' + (id || 'uusi');
function saveDraft(id, data) {
  try { localStorage.setItem(draftKey(id), JSON.stringify({ ...data, at: Date.now() })); } catch (_) {}
}
function loadDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch (_) { return null; }
}
function clearDraft(id) {
  try { localStorage.removeItem(draftKey(id)); } catch (_) {}
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' err' : '');
  setTimeout(() => { el.className = 'toast'; }, 2600);
}

// Nimi tallentuu selaimeen, jotta sitä ei tarvitse kirjoittaa joka kerta.
const author = {
  get: () => localStorage.getItem('elama_author') || '',
  set: (v) => localStorage.setItem('elama_author', v),
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Yhtenäinen SVG-ikonisto (perii tekstin värin, sama joka laitteella) ----------
// Käyttöliittymän kuvakkeet (ei kategorioiden käyttäjävalittavia emojeja).
const ICON_PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  announce: '<path d="M3 11v2.5l13 5V6z"/><path d="M16 8.5a3.5 3.5 0 0 1 0 7"/><path d="M7 14v4.5h3V15"/>',
  note: '<path d="M5 3.5h9l5 5V20.5H5z"/><path d="M8 12h8M8 16h5"/>',
  terms: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z"/><path d="M9 3v18"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 18l1-1"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17 14.4a5.5 5.5 0 0 1 3.5 5.1"/>',
  offline: '<path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>',
  popular: '<path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.3-3.8C9 10 9.5 12 11 12c1 0 1-1.2.5-3C11 7.5 12 4.5 12 3z"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  contact: '<path d="M6 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5 5l1.3-2 4.5 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6a2 2 0 0 1 2-2.5z"/>',
  attach: '<path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.2-2.2l7.3-7.3"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.5z"/><path d="M14 8.5 16.5 11"/>',
  trash: '<path d="M4.5 6.5h15M9 6.5V4.5h6v2M6 6.5 7 20h10l1-13.5"/><path d="M10 10v6M14 10v6"/>',
  pin: '<path d="M9 3.5h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14.5V21"/>',
  history: '<path d="M4 12a8 8 0 1 1 2.5 5.8"/><path d="M4 20v-4h4"/><path d="M12 7.5V12l3 2"/>',
  verify: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2 11 14.7l4.5-5"/>',
  toc: '<path d="M8 6h11M8 12h11M8 18h7"/><circle cx="4.2" cy="6" r="1.1"/><circle cx="4.2" cy="12" r="1.1"/><circle cx="4.2" cy="18" r="1.1"/>',
  camera: '<path d="M4 8.5h3l1.5-2h7L17 8.5h3V19H4z"/><circle cx="12" cy="13" r="3.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  moon: '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  warn: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.2"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  chevUp: '<path d="M6 15l6-6 6 6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  filePdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M8.5 17v-3.5h1a1.2 1.2 0 0 1 0 2.4h-1"/>',
  fileImage: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><circle cx="10" cy="13" r="1.3"/><path d="M8 19l3-3 2 2 2-2.5 2 3.5"/>',
  fileWord: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M8 13l1.3 4 1.2-3 1.2 3 1.3-4"/>',
  fileExcel: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M8.5 13.5l4 4M12.5 13.5l-4 4"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  shield: '<path d="M12 3l7 2.5V11c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V5.5z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search2: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
};
function icon(name, cls) {
  const p = ICON_PATHS[name];
  if (!p) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// Korostaa hakusanan otteessa. Osumat etsitään RAAKATEKSTISTÄ ja jokainen pala
// escapetaan erikseen – jos korostus tehtäisiin valmiiksi escapetusta tekstistä,
// haku esim. sanalla "amp" osuisi &amp;-entiteetin sisään ja rikkoisi merkin.
function highlight(text, q) {
  const src = String(text == null ? '' : text);
  if (!q) return esc(src);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  let out = '', last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; } // suoja tyhjältä osumalta
    out += esc(src.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('fi-FI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' t';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' kt';
  return (bytes / 1024 / 1024).toFixed(1) + ' Mt';
}

function fileIcon(mime) {
  if (mime === 'application/pdf') return icon('filePdf');
  if (mime.startsWith('image/')) return icon('fileImage');
  if (mime.includes('word')) return icon('fileWord');
  if (mime.includes('sheet') || mime.includes('excel')) return icon('fileExcel');
  return icon('file');
}

// ---------- Yksinkertainen Markdown-renderöinti (turvallinen: escapeta ensin) ----------
function renderMarkdown(md) {
  const lines = esc(md).split('\n');
  let html = '', inList = false, inCode = false;
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Kuvat ennen linkkejä: liite:ID viittaa wikin omaan liitteeseen,
    // src täytetään jälkikäteen (hydrateDocImages), koska sandboxissa
    // osoite on istuntokohtainen blob-URL.
    .replace(/!\[([^\]]*)\]\(liite:(\d+)\)/g, '<img class="doc-img" alt="$1" data-liite="$2">')
    .replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, '<img class="doc-img" alt="$1" src="$2">')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  for (let raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else { if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += raw + '\n'; continue; }

    const h = raw.match(/^(#{1,3})\s+(.*)$/);
    const li = raw.match(/^\s*[-*]\s+(.*)$/);
    if (h) {
      if (inList) { html += '</ul>'; inList = false; }
      const lvl = h[1].length;
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`;
    } else if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
    } else if (raw.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else if (raw.trim().startsWith('&gt;')) {
      html += `<blockquote>${inline(raw.replace(/^\s*&gt;\s?/, ''))}</blockquote>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(raw)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return html;
}

// Täyttää liite-kuvaviittausten (data-liite) osoitteet renderöinnin jälkeen.
async function hydrateDocImages(root) {
  for (const img of root.querySelectorAll('img[data-liite]')) {
    img.onerror = () => {
      const s = document.createElement('span');
      s.className = 'muted'; s.textContent = '[kuva puuttuu]';
      img.replaceWith(s);
    };
    img.src = await Store.attachments.url(+img.dataset.liite);
  }
}

// ---------- Kirjautuminen (vain palvelinversio; sandboxissa Store.auth=null) ----------
let currentUser = null;
const ROLE_LABELS = { admin: 'Ylläpitäjä', editor: 'Muokkaaja', viewer: 'Lukija' };

function authScreen(inner) {
  // Kirjautumisruutu on riisuttu: CSS piilottaa sivupalkin, haun, nimikentän,
  // reunapalstan ja alapalkin, kun data-auth="out". Näin kirjautumaton käyttäjä
  // ei näe valikkoa, jonka klikkaus antaisi harhaanjohtavan istuntovirheen.
  document.documentElement.dataset.auth = 'out';
  content.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    <div class="brand" style="justify-content:center; margin-bottom:14px">
      <span class="brand-mark">O</span>
      <span class="brand-text"><strong>Oma</strong><small>DASHBOARD · OHJEET</small></span>
    </div>${inner}</div></div>`;
}

function renderLogin(msg) {
  setActiveNav('');
  authScreen(`
    <h2 style="text-align:center; margin:0 0 4px">Kirjaudu sisään</h2>
    ${msg ? `<p class="muted" style="text-align:center">${esc(msg)}</p>` : ''}
    <div class="field"><label>Käyttäjätunnus</label>
      <input type="text" id="loginUser" autocomplete="username" /></div>
    <div class="field"><label>Salasana</label>
      <input type="password" id="loginPass" autocomplete="current-password" /></div>
    <button class="btn" id="loginBtn" style="width:100%">Kirjaudu</button>`);
  const doLogin = async () => {
    try {
      await Store.auth.login({ username: $('#loginUser').value, password: $('#loginPass').value });
      location.reload();
    } catch (err) { toast(err.message, true); }
  };
  $('#loginBtn').onclick = doLogin;
  $('#loginPass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  $('#loginUser').focus();
}

function renderSetup() {
  setActiveNav('');
  authScreen(`
    <h2 style="text-align:center; margin:0 0 4px">Tervetuloa!</h2>
    <p class="muted" style="text-align:center">Wiki otetaan käyttöön ensimmäistä kertaa.<br/>
      Luo itsellesi <strong>pääkäyttäjätili</strong>.</p>
    <div class="field"><label>Koko nimi (näkyy muokkauksissa)</label>
      <input type="text" id="suName" placeholder="Esim. Miska Fofonoff" /></div>
    <div class="field"><label>Käyttäjätunnus (vähintään 3 merkkiä)</label>
      <input type="text" id="suUser" autocomplete="username" /></div>
    <div class="field"><label>Salasana (vähintään 8 merkkiä)</label>
      <input type="password" id="suPass" autocomplete="new-password" /></div>
    <div class="field"><label>Salasana uudelleen</label>
      <input type="password" id="suPass2" autocomplete="new-password" /></div>
    <button class="btn" id="setupBtn" style="width:100%">Luo pääkäyttäjä</button>`);
  $('#setupBtn').onclick = async () => {
    if ($('#suPass').value !== $('#suPass2').value) return toast('Salasanat eivät täsmää', true);
    try {
      await Store.auth.setup({
        name: $('#suName').value, username: $('#suUser').value, password: $('#suPass').value,
      });
      toast('Pääkäyttäjä luotu'); location.reload();
    } catch (err) { toast(err.message, true); }
  };
  $('#suName').focus();
}

function applyUser(user) {
  currentUser = user;
  author.set(user.name);
  document.documentElement.dataset.vrole = user.role;
  document.documentElement.dataset.auth = 'in';
  const chip = $('#userChip');
  if (chip) {
    chip.style.display = '';
    chip.innerHTML = `<strong>${esc(user.name)}</strong> · ${esc(ROLE_LABELS[user.role] || user.role)}`;
  }
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.style.display = '';
    logoutBtn.onclick = async () => { await Store.auth.logout(); location.reload(); };
  }
  const nameBox = document.querySelector('.user');
  if (nameBox) nameBox.style.display = 'none';
  const usersNav = $('#usersNav');
  if (usersNav && user.role === 'admin') usersNav.style.display = '';
}

async function viewUsers(editId) {
  if (!Store.auth) { location.hash = '#/'; return; }
  const users = await Store.users.list();
  const editing = editId ? users.find((u) => u.id === editId) : null;
  content.innerHTML = `
    <h2>${icon('users','ic-lg')} Käyttäjät</h2>
    <p class="muted">Ylläpitäjä hallitsee tunnuksia. Roolit: Ylläpitäjä (kaikki + käyttäjät),
      Muokkaaja (sisällön muokkaus), Lukija (vain luku).</p>
    <div class="card editor-only">
      <h3 style="margin-top:0">${editing ? 'Muokkaa: ' + esc(editing.name) : 'Lisää käyttäjä'}</h3>
      <div class="row" style="align-items:flex-end">
        <div class="field" style="flex:1; min-width:150px; margin-bottom:0"><label>Koko nimi</label>
          <input type="text" id="uName" value="${editing ? esc(editing.name) : ''}" /></div>
        <div class="field" style="flex:1; min-width:130px; margin-bottom:0"><label>Tunnus</label>
          <input type="text" id="uUser" value="${editing ? esc(editing.username) : ''}" ${editing ? 'disabled' : ''} /></div>
        <div class="field" style="min-width:130px; margin-bottom:0"><label>Rooli</label>
          <select id="uRole">
            ${['viewer', 'editor', 'admin'].map((r) =>
              `<option value="${r}" ${editing && editing.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1; min-width:150px; margin-bottom:0">
          <label>${editing ? 'Uusi salasana (tyhjä = ei vaihdeta)' : 'Salasana (väh. 8 merkkiä)'}</label>
          <input type="password" id="uPass" autocomplete="new-password" /></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="uSaveBtn">${editing ? 'Tallenna' : 'Lisää käyttäjä'}</button>
        ${editing ? '<button class="btn secondary" id="uCancelBtn">Peruuta</button>' : ''}
      </div>
    </div>
    <div class="card">
      <ul class="link-list">
        ${users.map((u) => `<li class="link-row">
          <span class="att-icon">${u.role === 'admin' ? icon('shield') : u.role === 'editor' ? icon('edit') : icon('eye')}</span>
          <span class="att-name"><strong>${esc(u.name)}</strong>
            <div class="att-meta">${esc(u.username)} · ${esc(ROLE_LABELS[u.role] || u.role)}${u.id === currentUser.id ? ' · (sinä)' : ''}</div>
          </span>
          <span class="contact-actions">
            <button class="icon-btn small" data-edituser="${u.id}" title="Muokkaa">${icon('edit')}</button>
            ${u.id !== currentUser.id ? `<button class="icon-btn small" data-deluser="${u.id}" title="Poista">${icon('trash')}</button>` : ''}
          </span>
        </li>`).join('')}
      </ul>
    </div>`;

  $('#uSaveBtn').onclick = async () => {
    try {
      if (editing) {
        await Store.users.update(editing.id, {
          name: $('#uName').value, role: $('#uRole').value,
          password: $('#uPass').value || undefined,
        });
        toast('Tallennettu');
      } else {
        await Store.users.create({
          name: $('#uName').value, username: $('#uUser').value,
          role: $('#uRole').value, password: $('#uPass').value,
        });
        toast('Käyttäjä lisätty');
      }
      viewUsers();
    } catch (err) { toast(err.message, true); }
  };
  if (editing) $('#uCancelBtn').onclick = () => viewUsers();
  document.querySelectorAll('[data-edituser]').forEach((b) => b.onclick = () => viewUsers(+b.dataset.edituser));
  document.querySelectorAll('[data-deluser]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko käyttäjä?')) {
      try { await Store.users.remove(b.dataset.deluser); viewUsers(); }
      catch (err) { toast(err.message, true); }
    }
  });
}

// ---------- Tila + reititys ----------
let categories = [];
let currentCategoryId = null;

async function loadCategories() {
  categories = await Store.categories.list();
  renderSidebar();
}

// Kategorioiden siistit SVG-viivakuvakkeet (sama tyyli kuin navigaatiossa).
// Tallennetaan muodossa "svg:<nimi>". Vanhat emoji-valinnat toimivat yhä.
const CAT_ICON_PATHS = {
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  graduation: '<path d="M2.5 8.5 12 4l9.5 4.5L12 13z"/><path d="M6 10.5V16c0 1.3 2.7 2.5 6 2.5s6-1.2 6-2.5v-5.5"/><path d="M21.5 8.5v5"/>',
  building: '<path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5V21"/><path d="M16 9h3.5A1.5 1.5 0 0 1 21 10.5V21"/><path d="M8 7h2M8 11h2M8 15h2M12 7h1M12 11h1M12 15h1M3 21h18"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M5 11v9h14v-9"/><path d="M9.5 20v-5h5v5"/>',
  siren: '<path d="M6 20v-6a6 6 0 0 1 12 0v6z"/><path d="M4 20h16"/><path d="M12 4V2M5 7 3.5 5.5M19 7l1.5-1.5"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 1 6.5 18H19v3H6.5A1.5 1.5 0 0 1 5 19.5z"/>',
  shield: '<path d="M12 3l7 2.5V11c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V5.5z"/><path d="M9 12l2 2 4-4"/>',
  wrench: '<path d="M15 6a4 4 0 0 0-5 5L4 17l3 3 6-6a4 4 0 0 0 5-5l-2.5 2.5L14 11l-.5-2z"/>',
  fire: '<path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.3-3.8C9 10 9.5 12 11 12c1 0 1-1.2.5-3C11 7.5 12 4.5 12 3z"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M15 15l1.5-1.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5z"/>',
  clipboard: '<path d="M8 4.5h8V7H8z"/><path d="M8 5.5H6v14h12v-14h-2"/><path d="M9 11h6M9 15h6"/>',
  phone: '<path d="M6 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5 5l1.3-2 4.5 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6a2 2 0 0 1 2-2.5z"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  snow: '<path d="M12 2v20M4 7l16 10M20 7 4 17"/><path d="M12 2l-2 2m2-2 2 2M4 7v2.5M4 7l2.2.5M20 17v-2.5M20 17l-2.2-.5M4 17l2.2-.5M4 17v-2.5M20 7v2.5M20 7l-2.2.5M12 22l-2-2m2 2 2-2"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  heart: '<path d="M12 20S4 15 4 9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 8 2.5C20 15 12 20 12 20z"/>',
};
// Valittavissa oleva ikonisto (nimet CAT_ICON_PATHSista).
const CAT_ICONS = ['doc', 'graduation', 'building', 'store', 'siren', 'bolt', 'book',
  'shield', 'wrench', 'fire', 'key', 'folder', 'clipboard', 'phone', 'droplet', 'snow', 'plug', 'heart'];

function catSvg(name, cls) {
  const p = CAT_ICON_PATHS[name];
  if (!p) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
// Raaka tallennettu arvo (token tai emoji) – valinnan vertailuun.
const catIcon = (c) => (c && c.icon) ? c.icon : 'svg:folder';
// Render-valmis HTML: SVG-token → viivakuvake, muuten emoji tekstinä.
function catIconHtml(c, cls) {
  const v = (c && c.icon) ? c.icon : 'svg:folder';
  if (v.indexOf('svg:') === 0) {
    const s = catSvg(v.slice(4), cls);
    if (s) return s;
  }
  return `<span class="cat-emoji">${esc(v)}</span>`;
}

// Kategorian väriaksentti: rauhallinen, erottuva paletti. Vältetään kirkasta
// punaista/vihreää, jotka sekoittuvat vaara/ok-merkityksiin. Heksavalidointi
// (HEX_RE) pitää inline-tyylin turvallisena.
const CAT_COLORS = ['#c2410c', '#b45309', '#0f766e', '#0369a1', '#4f46e5', '#7c3aed', '#9d174d', '#475569'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const catColor = (c) => (c && HEX_RE.test(c.color || '')) ? c.color.toLowerCase() : '';
// Palauttaa turvallisen style-attribuutin (tai tyhjän) värille.
const accentStyle = (c) => { const col = catColor(c); return col ? ` style="--cat-accent:${col}"` : ''; };

// Väripalettivalitsin lomakkeisiin. Valinta luetaan elementin data-color-kentästä.
function colorPickerHtml(id, selected) {
  const sel = HEX_RE.test(selected || '') ? selected.toLowerCase() : '';
  return `<div class="color-picker" id="${id}" data-color="${sel}">
    <button type="button" class="swatch swatch-none ${!sel ? 'sel' : ''}" data-c="" title="Ei väriä">∅</button>
    ${CAT_COLORS.map((c) => `<button type="button" class="swatch ${c === sel ? 'sel' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}
  </div>`;
}

// Alakategoriat: mielivaltainen syvyys. Pääkategoriat = parent_id tyhjä.
const topCategories = () => categories.filter((c) => !c.parent_id);
const subCategories = (parentId) => categories.filter((c) => c.parent_id === parentId);
const parentOf = (c) => (c && c.parent_id) ? categories.find((x) => x.id === c.parent_id) : null;
// Yläkategoriat juuresta lähtien (murupolkua varten).
function ancestorsOf(c) {
  const chain = []; let p = parentOf(c);
  while (p) { chain.unshift(p); p = parentOf(p); }
  return chain;
}
// Kaikki alenevat alakategoriat (silmukan esto lomakkeissa).
function descendantsOf(id) {
  const out = []; const stack = [id];
  while (stack.length) { for (const k of subCategories(stack.pop())) { out.push(k); stack.push(k.id); } }
  return out;
}

// Kategorian ja KAIKKIEN alenevien alakategorioiden yhteenlaskettu ohjemäärä.
function totalPageCount(c) {
  let n = c.page_count || 0;
  for (const k of descendantsOf(c.id)) n += (k.page_count || 0);
  return n;
}

// Alakategorioiden näkyvyys sivupalkissa (käyttäjän näkymäasetus, muistetaan).
let subcatsHidden = false;
try { subcatsHidden = localStorage.getItem('elama_hide_subcats') === '1'; } catch (_) {}

function catRowHtml(c, i, total, depth, hiddenSubs) {
  const accent = catColor(c) ? ' has-accent' : '';
  // Kun alakategoriat on piilotettu, pääkategoriassa näkyy pieni merkki niiden määrästä.
  const chip = hiddenSubs ? `<span class="subs-chip" title="${hiddenSubs} alakategoriaa piilotettu">▸${hiddenSubs}</span>` : '';
  return `<li>
      <button class="cat-btn ${depth > 0 ? 'subcat' : ''}${accent} ${c.id === currentCategoryId ? 'active' : ''}" data-cat="${c.id}"${accentStyle(c)}>
        <span class="cat-ico">${catIconHtml(c)}</span>
        <span class="cat-name">${esc(c.name)}</span>
        ${chip}
        <span class="count-badge">${c.page_count != null ? c.page_count : ''}</span>
      </button>
      <span class="row-order">
        ${i > 0 ? `<button class="icon-btn" data-catmove="${c.id}" data-dir="-1" title="Siirrä ylös">${icon('chevUp')}</button>` : ''}
        ${i < total - 1 ? `<button class="icon-btn" data-catmove="${c.id}" data-dir="1" title="Siirrä alas">${icon('chevDown')}</button>` : ''}
      </span>
    </li>`;
}

// Yksi kategoria + sen alipuu (rekursio mahdollistaa monta tasoa).
function catTreeHtml(c, i, total, depth) {
  const kids = subCategories(c.id);
  let html = catRowHtml(c, i, total, depth, 0);
  if (kids.length) {
    html += `<li class="subcat-wrap"><ul class="subcat-list">${
      kids.map((k, j) => catTreeHtml(k, j, kids.length, depth + 1)).join('')}</ul></li>`;
  }
  return html;
}

function renderSidebar() {
  const ul = $('#categoryList');
  const tops = topCategories();
  ul.innerHTML = tops.map((c, i) => {
    if (subcatsHidden) {
      // Piilotettuna: vain pääkategoriat + merkki suorien alakategorioiden määrästä.
      return catRowHtml(c, i, tops.length, 0, subCategories(c.id).length);
    }
    return catTreeHtml(c, i, tops.length, 0);
  }).join('') || '<li class="muted" style="padding:8px 12px">Ei kategorioita vielä</li>';
  updateSubcatToggle();
}

// Päivittää piilotusnapin kuvakkeen/tekstin ja piilottaa sen kokonaan,
// jos alakategorioita ei ole lainkaan.
function updateSubcatToggle() {
  const b = $('#toggleSubcatsBtn');
  if (!b) return;
  const anySubs = categories.some((c) => c.parent_id);
  b.style.display = anySubs ? '' : 'none';
  b.innerHTML = icon(subcatsHidden ? 'chevRight' : 'chevDown');
  b.title = subcatsHidden ? 'Näytä alakategoriat' : 'Piilota alakategoriat';
  b.classList.toggle('active', subcatsHidden);
}

// Siirtää id:n annettuun suuntaan id-listassa; palauttaa uuden listan tai null.
function moveInList(ids, id, dir) {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

// Kuvakevalitsin: siistit SVG-viivakuvakkeet napeiksi. Valinta luetaan
// elementin data-icon-kentästä (muoto "svg:<nimi>").
function iconSelectHtml(id, selected) {
  const sel = selected || 'svg:folder';
  return `<div class="icon-picker" id="${id}" data-icon="${esc(sel)}">
    ${CAT_ICONS.map((n) => {
      const token = 'svg:' + n;
      return `<button type="button" class="ic-opt ${token === sel ? 'sel' : ''}" data-i="${token}" title="${n}" aria-label="Kuvake ${n}">${catSvg(n)}</button>`;
    }).join('')}
  </div>`;
}

// Kategoriapuun optiot hierarkiassa (mikä tahansa syvyys). skip = joukko
// id:itä jotka jätetään pois (esim. kategoria itse + sen alenevat).
function categoryOptionRows(selectedId, skip, parentId, depth) {
  return subCategories(parentId || null).filter((c) => !skip || !skip.has(c.id)).map((c) => {
    const prefix = depth ? '  '.repeat(depth) + '↳ ' : '';
    const row = `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${prefix}${esc(c.name)}</option>`;
    return row + categoryOptionRows(selectedId, skip, c.id, depth + 1);
  }).join('');
}

function categoryOptionsHtml(selectedId) {
  return categoryOptionRows(selectedId, null, null, 0);
}

// Yläkategorian valitsin: tyhjä = pääkategoria. Kelpaavat kaikki PAITSI
// kategoria itse ja sen alenevat (silmukan esto).
function parentSelectHtml(id, selected, excludeId) {
  const skip = new Set();
  if (excludeId != null) {
    skip.add(excludeId);
    for (const d of descendantsOf(excludeId)) skip.add(d.id);
  }
  return `<select id="${id}" class="parent-select" title="Yläkategoria">
    <option value="">— Pääkategoria (ei yläkategoriaa) —</option>
    ${categoryOptionRows(selected, skip, null, 0)}
  </select>`;
}

function setActiveNav(nav) {
  document.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.nav === nav));
  document.querySelectorAll('.bn-item[data-bnav]').forEach((b) => b.classList.toggle('active', b.dataset.bnav === nav));
}

// Reititys hash-osoitteilla: #/, #/kohde/:id, #/sivu/:id, #/muokkaa/:id, #/uusi, #/paivakirja, #/haku?q=
// Oikean reunan kiinnitetty muistiinpanopalsta: näkyy leveillä näytöillä
// muilla sivuilla kuin etusivulla ja päiväkirjassa (niissä merkinnät ovat jo esillä).
const RAIL_ROUTES = ['kohde', 'sivu', 'muistutukset', 'numerot', 'termipankki', 'linkit', 'haku', 'historia', 'versio', 'kayttajat', 'roskakori'];

function railNoteHtml(n) {
  return `<div class="rail-note">
    <div class="muted">${n.author ? esc(n.author) + ' · ' : ''}${esc(fmtDate(n.created_at))}</div>
    <div>${esc(n.content)}</div>
  </div>`;
}

async function updateRail(section) {
  const rail = $('#rail');
  if (!rail) return;
  if (!RAIL_ROUTES.includes(section)) { rail.innerHTML = ''; return; }
  try {
    const notes = await Store.notes.list({ limit: 30 });
    rail.innerHTML = `<div class="card">
      <div class="spread"><h3 style="margin:0">${icon('note')} Muistiinpanot</h3>
        <a class="btn small secondary" href="#/paivakirja">Kaikki</a></div>
      <div class="note-quick">
        <textarea id="railNoteText" placeholder="Kirjaa huomio…"></textarea>
        <button class="btn small" id="railNoteAdd">Lisää merkintä</button>
      </div>
      <div class="rail-scroll">
        ${notes.map(railNoteHtml).join('') || '<p class="empty">Ei merkintöjä vielä.</p>'}
        ${notes.length > 5 ? '<div class="scroll-fade" aria-hidden="true"></div>' : ''}
      </div>
    </div>`;
    $('#railNoteAdd').onclick = async () => {
      const text = $('#railNoteText').value;
      if (!text.trim()) return toast('Kirjoita jotain', true);
      try { await Store.notes.create({ content: text, category_id: null, author: author.get() }); toast('Lisätty'); updateRail(section); }
      catch (err) { toast(err.message, true); }
    };
  } catch (_) { rail.innerHTML = ''; }
}

// Edellinen osoite: tarvitaan, jotta peruutus voi palauttaa käyttäjän takaisin
// muokkausnäkymään ilman että router ajetaan turhaan uudelleen.
let lastHash = location.hash || '#/';
let revertingHash = false;

async function router() {
  // Peruutuksen aiheuttama hash-palautus: ei renderöidä mitään uudelleen.
  if (revertingHash) { revertingHash = false; return; }
  const targetHash = location.hash || '#/';
  // Tallentamattomat muutokset: varmistetaan myös wikin sisäinen siirtyminen.
  if (unsavedDirty && targetHash !== lastHash) {
    const ok = confirm('Ohjeessa on tallentamattomia muutoksia.\n\n'
      + 'Poistutaanko silti? Teksti jää talteen luonnoksena, jonka voit palauttaa '
      + 'kun avaat ohjeen uudelleen muokattavaksi.');
    if (!ok) {
      revertingHash = true;
      location.hash = lastHash;
      return;
    }
  }
  lastHash = targetHash;
  const hash = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  closeSidebarMobile();
  updateRail(parts[0] || '');
  const openCatForm = $('#catForm');
  if (openCatForm) openCatForm.remove();
  setUnsavedGuard(false);

  // Huom: await on pakollinen, jotta catch nappaa myös async-näkymien virheet
  // (esim. poistetun sivun avaaminen).
  try {
    if (parts.length === 0) { setActiveNav('home'); return await viewHome(); }
    if (parts[0] === 'paivakirja') { setActiveNav('shiftlog'); return await viewShiftLog(); }
    if (parts[0] === 'numerot') { setActiveNav('contacts'); return await viewContacts(); }
    if (parts[0] === 'muistutukset') { setActiveNav('announcements'); return await viewAnnouncements(); }
    if (parts[0] === 'termipankki') { setActiveNav('terms'); return await viewTerms(); }
    if (parts[0] === 'linkit') { setActiveNav('links'); return await viewLinks(); }
    if (parts[0] === 'kayttajat') { setActiveNav('users'); return await viewUsers(); }
    if (parts[0] === 'roskakori') { setActiveNav('trash'); return await viewTrash(); }
    if (parts[0] === 'historia') { setActiveNav(''); return await viewHistory(+parts[1]); }
    if (parts[0] === 'versio') { setActiveNav(''); return await viewRevision(+parts[1]); }
    if (parts[0] === 'kohde') { setActiveNav(''); currentCategoryId = +parts[1]; renderSidebar(); return await viewCategory(+parts[1]); }
    if (parts[0] === 'sivu') { setActiveNav(''); return await viewPage(+parts[1]); }
    if (parts[0] === 'muokkaa') { setActiveNav(''); return await viewPageEdit(+parts[1]); }
    if (parts[0] === 'uusi') { setActiveNav(''); const q = new URLSearchParams(queryPart); return await viewPageEdit(null, q.get('kohde')); }
    if (parts[0] === 'haku') { setActiveNav(''); const q = new URLSearchParams(queryPart); return await viewSearch(q.get('q') || ''); }
  } catch (e) {
    if (e && e.status === 401 && Store.auth) return renderLogin('Istunto on vanhentunut – kirjaudu uudelleen.');
    content.innerHTML = `<div class="card empty">Virhe: ${esc(e.message)} · <a href="#/">Palaa etusivulle</a></div>`;
  }
}

// ---------- Näkymät ----------
// ---------- Etusivu ----------
// Lyhyt päivämäärä (25.7.) tunnuslukuihin ja korttien metatietoihin.
const shortDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`;
};

// Poikkeuksen tilamerkki. Nykyisessä datassa ei ole voimassaoloaikoja
// (ne ovat designin toivelistalla), joten kiinnitetty = voimassa nyt.
function noticeBadge(a) {
  return a.pinned
    ? '<span class="d2-badge now">Voimassa</span>'
    : '<span class="d2-badge soon">Tiedote</span>';
}

async function viewHome() {
  currentCategoryId = null; renderSidebar();
  const pages = await Store.pages.list();
  const now = new Date();
  const tervehdys = now.getHours() < 5 ? 'Hyvää yötä'
    : now.getHours() < 10 ? 'Huomenta'
    : now.getHours() < 17 ? 'Päivää' : 'Iltaa';
  content.innerHTML = `
    <div class="d2-head">
      <div>
        <div class="d2-eyebrow">${esc(now.toLocaleDateString('fi-FI', { weekday: 'long' }))}</div>
        <h1 class="d2-title">${esc(tervehdys)}</h1>
      </div>
      <div class="d2-stats">
        <div class="d2-stat"><b>${pages.length}</b><span>Ohjetta</span></div>
        <div class="d2-stat"><b>${isoWeek(now)}</b><span>Viikko</span></div>
      </div>
    </div>
    <div id="dashRoot"></div>`;
  await Dashboard.render($('#dashRoot'));
}


// Yhteystietorivien käsittelijät (etusivu JA Tärkeät numerot -sivu).
function bindContactHandlers(contacts, refresh) {
  const addBtn = $('#addContactBtn');
  if (addBtn) addBtn.onclick = () => editContact(null, refresh);
  document.querySelectorAll('[data-editcontact]').forEach((b) => b.onclick = () => {
    editContact(contacts.find((c) => String(c.id) === b.dataset.editcontact), refresh);
  });
  document.querySelectorAll('[data-delcontact]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko yhteystieto?')) { await Store.contacts.remove(b.dataset.delcontact); refresh(); }
  });
  document.querySelectorAll('[data-cmove]').forEach((b) => b.onclick = async () => {
    const ids = moveInList(contacts.map((c) => c.id), +b.dataset.cmove, +b.dataset.dir);
    if (ids) { await Store.contacts.reorder(ids); refresh(); }
  });
}

// Oma sivu tärkeille numeroille: koko lista + hallinta yhdessä paikassa.
async function viewContacts() {
  const contacts = await Store.contacts.list();
  content.innerHTML = `
    <h2>${icon('contact', 'ic-lg')} Tärkeät numerot</h2>
    <p class="muted">Hälytyskeskuksen yhteystiedot. Numerot näkyvät myös etusivulla
      ja puhelimeen ladattavassa offline-versiossa. Järjestä ▲▼-napeilla.</p>
    <div class="card">
      <div class="spread"><h3 style="margin:0">Yhteystiedot (${contacts.length})</h3>
        <button class="icon-btn small" id="addContactBtn" title="Lisää yhteystieto">${icon('add')}</button></div>
      <div id="contactFormWrap"></div>
      <ul class="contact-list">
        ${contacts.map(contactHtml).join('') || '<li class="muted" style="border:none">Ei yhteystietoja vielä. Lisää ensimmäinen ＋-napista.</li>'}
      </ul>
    </div>`;
  bindContactHandlers(contacts, viewContacts);
}

// Yhteystiedon lisäys/muokkaus: lomake kortin sisään (ei prompt-ikkunoita).
function editContact(existing, refresh) {
  const wrap = $('#contactFormWrap');
  if (!wrap) return;
  if (wrap.innerHTML && !existing) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="contact-form">
    <input type="text" id="cfLabel" placeholder="Nimi / rooli (esim. IT-tuki)" value="${existing ? esc(existing.label) : ''}" />
    <input type="text" id="cfPhone" placeholder="Puhelinnumero" value="${existing ? esc(existing.phone) : ''}" />
    <input type="text" id="cfNote" placeholder="Lisätieto (valinnainen)" value="${existing ? esc(existing.note) : ''}" />
    <div class="row">
      <button class="btn small" id="cfSave">${existing ? 'Tallenna' : 'Lisää'}</button>
      <button class="btn small secondary" id="cfCancel">Peruuta</button>
    </div>
  </div>`;
  $('#cfSave').onclick = async () => {
    const data = { label: $('#cfLabel').value.trim(), phone: $('#cfPhone').value.trim(), note: $('#cfNote').value.trim() };
    if (!data.label) return toast('Anna nimi', true);
    try {
      if (existing) await Store.contacts.update(existing.id, data);
      else await Store.contacts.create(data);
      toast('Tallennettu'); (refresh || viewHome)();
    } catch (err) { toast(err.message, true); }
  };
  $('#cfCancel').onclick = () => { wrap.innerHTML = ''; };
  $('#cfLabel').focus();
}

function categoryName(id) {
  const c = categories.find((x) => x.id === id);
  return c ? c.name : 'Yleinen';
}

async function viewCategory(id) {
  const cat = categories.find((c) => c.id === id);
  if (!cat) {
    content.innerHTML = '<div class="card empty">Kategoriaa ei löydy (se on ehkä poistettu). <a href="#/">Palaa etusivulle</a></div>';
    return;
  }
  const pages = await Store.pages.list(id);
  const parent = parentOf(cat);
  const subs = subCategories(id);
  // Murupolku koko ketjulla (Etusivu › isoisä › isä › nykyinen).
  const crumbs = '<a href="#/">Etusivu</a>'
    + ancestorsOf(cat).map((a) => `<span class="sep">›</span><a href="#/kohde/${a.id}">${esc(a.name)}</a>`).join('')
    + `<span class="sep">›</span><span>${esc(cat.name)}</span>`;
  content.innerHTML = `
    <div class="crumbs">${crumbs}</div>
    <div class="spread">
      <h2 style="margin:0">${catIconHtml(cat, 'ic-lg')} ${esc(cat.name)}</h2>
      <div class="row">
        <button class="btn small" id="newPageBtn">＋ Uusi ohje</button>
        <button class="btn small secondary" id="newSubBtn">＋ Alakategoria</button>
        <button class="btn small secondary" id="renameCatBtn">${icon('edit')} Muokkaa</button>
        <button class="btn small danger" id="delCatBtn">Poista kategoria</button>
      </div>
    </div>
    <div id="catEditRow"></div>
    ${subs.length ? `<div class="cat-grid">
      ${subs.map((s) => `<a class="cat-card${catColor(s) ? ' has-accent' : ''}" href="#/kohde/${s.id}"${accentStyle(s)}>
        <span class="cc-ico">${catIconHtml(s, 'cc-svg')}</span>
        <span class="cc-name">${esc(s.name)}</span>
        <span class="cc-count">${s.page_count || 0} ohjetta</span>
      </a>`).join('')}
    </div>` : ''}
    <div class="card">
      ${subs.length ? '<div class="spread"><h3 style="margin:0 0 4px">Kategorian omat ohjeet</h3></div>' : ''}
      <ul class="page-list">
        ${pages.map((p, i) => `<li class="orderable">
          <button class="page-link" data-page="${p.id}">
            <span>${esc(p.title)}</span>
            <span class="muted">${esc(fmtDate(p.updated_at))}</span>
          </button>
          <span class="row-order">
            ${i > 0 ? `<button class="icon-btn" data-pmove="${p.id}" data-dir="-1" title="Siirrä ylös">${icon('chevUp')}</button>` : ''}
            ${i < pages.length - 1 ? `<button class="icon-btn" data-pmove="${p.id}" data-dir="1" title="Siirrä alas">${icon('chevDown')}</button>` : ''}
          </span>
        </li>`).join('')
          || `<li class="empty">${subs.length ? 'Ei ohjeita suoraan tässä kategoriassa – valitse alakategoria yltä.' : 'Ei ohjeita tässä kategoriassa. Luo ensimmäinen.'}</li>`}
      </ul>
    </div>`;

  document.querySelectorAll('[data-pmove]').forEach((b) => b.onclick = async () => {
    const ids = moveInList(pages.map((p) => p.id), +b.dataset.pmove, +b.dataset.dir);
    if (ids) { await Store.pages.reorder(ids); viewCategory(id); }
  });

  $('#newPageBtn').onclick = () => { location.hash = `#/uusi?kohde=${id}`; };
  const subBtn = $('#newSubBtn');
  if (subBtn) subBtn.onclick = () => {
    const row = $('#catEditRow');
    if (row.dataset.mode === 'sub') { row.innerHTML = ''; row.dataset.mode = ''; return; }
    row.dataset.mode = 'sub';
    row.innerHTML = `<div class="card">
      <div class="row" style="flex-wrap:wrap">
        <input type="text" id="subCatName" placeholder="Alakategorian nimi (esim. asiakas)"
          style="flex:1; min-width:180px; padding:8px 10px; border:1px solid var(--border); border-radius:6px" />
        <button class="btn small" id="subCatSave">Lisää alakategoria</button>
      </div>
      <label class="muted" style="display:block;margin:10px 0 4px">Kuvake</label>
      ${iconSelectHtml('subCatIcon', 'svg:store')}
      <label class="muted" style="display:block;margin:10px 0 4px">Väri</label>
      ${colorPickerHtml('subCatColor', '')}
    </div>`;
    $('#subCatSave').onclick = async () => {
      const name = $('#subCatName').value.trim();
      if (!name) return toast('Anna nimi', true);
      try {
        const c = await Store.categories.create({ name, icon: $('#subCatIcon').dataset.icon, color: $('#subCatColor').dataset.color, parent_id: id });
        row.innerHTML = ''; row.dataset.mode = '';
        await loadCategories(); location.hash = '#/kohde/' + c.id; toast('Alakategoria lisätty');
      } catch (err) { toast(err.message, true); }
    };
    $('#subCatName').focus();
  };
  // Kategorian muokkaus: siisti lomake promptin sijaan. Kategorian voi siirtää
  // minkä tahansa toisen kategorian alle (paitsi oman alakategoriansa – valitsin
  // jättää ne pois, ja palvelin estää silmukan).
  $('#renameCatBtn').onclick = () => {
    const row = $('#catEditRow');
    if (row.dataset.mode === 'edit') { row.innerHTML = ''; row.dataset.mode = ''; return; }
    row.dataset.mode = 'edit';
    row.innerHTML = `<div class="card">
      <div class="row" style="flex-wrap:wrap">
        <input type="text" id="editCatName" value="${esc(cat.name)}"
          style="flex:1; min-width:180px; padding:8px 10px; border:1px solid var(--border); border-radius:6px" />
        <button class="btn small" id="editCatSave">Tallenna</button>
      </div>
      <label class="muted" style="display:block;margin:10px 0 4px">Kuvake</label>
      ${iconSelectHtml('editCatIcon', catIcon(cat))}
      <label class="muted" style="display:block;margin:10px 0 4px">Väri</label>
      ${colorPickerHtml('editCatColor', cat.color || '')}
      <label class="muted" style="display:block;margin:10px 0 4px">Yläkategoria</label>
      ${parentSelectHtml('editCatParent', cat.parent_id || null, id)}
    </div>`;
    $('#editCatSave').onclick = async () => {
      const name = $('#editCatName').value.trim();
      if (!name) return toast('Anna nimi', true);
      const data = { name, icon: $('#editCatIcon').dataset.icon, color: $('#editCatColor').dataset.color,
        parent_id: $('#editCatParent').value || null };
      try {
        await Store.categories.update(id, data);
        await loadCategories(); viewCategory(id); toast('Tallennettu');
      } catch (err) { toast(err.message, true); }
    };
    $('#editCatName').focus();
  };
  const allSubCount = descendantsOf(id).length;
  const delMsg = allSubCount
    ? `Poistetaanko kategoria, sen ${allSubCount} alakategoriaa (kaikki tasot) ja KAIKKI niiden ohjeet ja liitteet? Tätä ei voi perua.`
    : 'Poistetaanko kategoria ja KAIKKI sen ohjeet ja liitteet? Tätä ei voi perua.';
  const doDeleteCat = async (password) => {
    try {
      await Store.categories.remove(id, password);
      await loadCategories();
      location.hash = parent ? '#/kohde/' + parent.id : '#/';
      toast('Kategoria poistettu');
    } catch (err) { toast(err.message, true); }
  };
  $('#delCatBtn').onclick = () => {
    // Palvelinversiossa poisto vain ylläpitäjälle ja salasanaa vastaan.
    if (Store.auth) {
      if (currentUser && currentUser.role !== 'admin') return toast('Vain ylläpitäjä voi poistaa kategorioita', true);
      const row = $('#catEditRow');
      if (row.dataset.mode === 'del') { row.innerHTML = ''; row.dataset.mode = ''; return; }
      row.dataset.mode = 'del';
      row.innerHTML = `<div class="card danger-zone">
        <p style="margin:0 0 10px"><strong>${icon('warn')} ${esc(delMsg)}</strong></p>
        <div class="row" style="flex-wrap:wrap">
          <input type="password" id="delCatPass" placeholder="Vahvista omalla salasanallasi" autocomplete="current-password"
            style="flex:1; min-width:200px; padding:8px 10px; border:1px solid var(--border); border-radius:6px" />
          <button class="btn small danger" id="delCatConfirm">Poista lopullisesti</button>
          <button class="btn small secondary" id="delCatCancel">Peruuta</button>
        </div>
      </div>`;
      const submit = () => {
        const pw = $('#delCatPass').value;
        if (!pw) return toast('Anna salasanasi', true);
        doDeleteCat(pw);
      };
      $('#delCatConfirm').onclick = submit;
      $('#delCatPass').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      $('#delCatCancel').onclick = () => { row.innerHTML = ''; row.dataset.mode = ''; };
      $('#delCatPass').focus();
      return;
    }
    // Sandbox-demo: ei kirjautumista, riittää vahvistus.
    if (confirm(delMsg)) doDeleteCat(null);
  };
}

// Sisällysluettelo pitkiin ohjeisiin: rakentaa otsikoista (h1–h3) linkkilistan
// ja korostaa vierityksen mukaan sen osion, joka on näkyvissä.
let tocObserver = null;
function buildToc() {
  if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
  const docEl = $('#content .doc');
  const holder = $('#tocHolder');
  if (!docEl || !holder) return;
  const heads = Array.from(docEl.querySelectorAll('h1, h2, h3'));
  if (heads.length < 3) return; // lyhyille ohjeille ei tarvita luetteloa
  heads.forEach((h, i) => { if (!h.id) h.id = 'osio-' + i; h.classList.add('doc-head'); });
  holder.innerHTML = `<nav class="toc-card" aria-label="Sisällys">
    <div class="toc-title">${icon('toc')} Tällä sivulla</div>
    <ul>${heads.map((h) => `<li class="toc-${h.tagName.toLowerCase()}">
      <a href="#" data-toc="${h.id}">${esc(h.textContent)}</a></li>`).join('')}</ul>
  </nav>`;
  const links = new Map(heads.map((h) => [h.id, holder.querySelector(`[data-toc="${h.id}"]`)]));
  holder.querySelectorAll('[data-toc]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    const t = document.getElementById(a.dataset.toc);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  tocObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      holder.querySelectorAll('[data-toc]').forEach((a) => a.classList.remove('on'));
      const a = links.get(en.target.id); if (a) a.classList.add('on');
    });
  }, { rootMargin: '-72px 0px -70% 0px' });
  heads.forEach((h) => tocObserver.observe(h));
}

async function viewPage(id) {
  const p = await Store.pages.get(id, { track: true });
  // Kuvaliitteet omaan galleriaan (pikkukuvat + lightbox), muut listaan.
  const imgAtts = p.attachments.filter((a) => (a.mimetype || '').startsWith('image/'));
  const otherAtts = p.attachments.filter((a) => !(a.mimetype || '').startsWith('image/'));
  content.innerHTML = `
    <div class="spread">
      <div>
        <div class="crumbs"><a href="#/">Etusivu</a><span class="sep">›</span>${p.category_id
          ? `<a href="#/kohde/${p.category_id}">${esc(categoryName(p.category_id))}</a>`
          : esc(categoryName(p.category_id))}<span class="sep">›</span><span>${esc(p.title)}</span></div>
        <h2 style="margin:4px 0 0">${esc(p.title)}</h2>
      </div>
      <div class="row">
        <button class="btn small secondary" id="editBtn">${icon('edit')} Muokkaa</button>
        <a class="btn small secondary" href="#/historia/${p.id}">${icon('history')} Historia</a>
        <button class="btn small danger" id="delBtn">Poista</button>
      </div>
    </div>
    <p class="muted">Päivitetty ${esc(fmtDate(p.updated_at))}${p.updated_by ? ' · ' + esc(p.updated_by) : ''}</p>
    <div id="pageDelRow"></div>
    <div class="row" style="margin-bottom:12px">
      ${verifyBadge(p)}
      <button class="btn small secondary" id="verifyBtn">${icon('verify')} Vahvista ajantasaiseksi</button>
    </div>
    ${(p.keywords || '').trim() ? `<div class="tags">${p.keywords.split(',').map((k) => k.trim()).filter(Boolean)
      .map((k) => `<a class="tag-chip" href="#/haku?q=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>` : ''}
    <div id="tocHolder"></div>
    <div class="card doc">${p.content.trim() ? renderMarkdown(p.content) : '<p class="muted">Ei sisältöä. Klikkaa Muokkaa.</p>'}</div>
    <div class="card">
      <div class="spread"><h3 style="margin:0">${icon('attach')} Liitteet (${p.attachments.length})</h3></div>
      ${imgAtts.length ? `<div class="att-gallery">${imgAtts.map((a, i) => `
        <figure class="att-thumb" data-img="${i}" title="${esc(a.original_name)}">
          <img src="${esc(a.url)}" alt="${esc(a.original_name)}" loading="lazy" />
          <button class="att-thumb-del" data-delatt="${a.id}" title="Poista liite">${icon('trash', 'ic-sm')}</button>
        </figure>`).join('')}</div>` : ''}
      <ul class="attach-list">
        ${otherAtts.map(attHtml).join('') || (imgAtts.length ? '' : '<li class="muted" style="border:none">Ei liitteitä.</li>')}
      </ul>
      <div id="uploadForm" class="row" style="margin-top:12px">
        <input type="file" id="fileInput" name="files" multiple style="display:none"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx" />
        <button class="btn small" type="button" id="pickFilesBtn">${icon('attach')} Valitse tiedostot</button>
        <span class="muted">PDF, kuvat, Word, Excel · max 50 Mt</span>
      </div>
      <p class="muted" style="margin:8px 0 0">Tästä lisätty kuva näkyy liitteenä.
        Jos haluat kuvan <strong>tekstin sekaan</strong> (kuten Wordissa), avaa
        ${icon('edit', 'ic-sm')} <strong>Muokkaa</strong> ja klikkaa kuvaa kohdasta
        “Jo liitetyt kuvat” – tai lisää se suoraan <strong>Lisää kuva</strong> -napista.</p>
    </div>`;

  hydrateDocImages($('#content'));
  buildToc();

  // Kuvagalleria: pikkukuvan klikkaus avaa lightboxin (paitsi poistonappi).
  const galleryImgs = imgAtts.map((a) => ({ url: a.url, name: a.original_name }));
  document.querySelectorAll('.att-thumb').forEach((fig) => fig.onclick = (e) => {
    if (e.target.closest('[data-delatt]')) return;
    openLightbox(galleryImgs, +fig.dataset.img);
  });
  // Artikkelin sisällön kuvat suurenevat myös klikkaamalla.
  $('#content').querySelectorAll('.doc img.doc-img').forEach((im) => {
    im.classList.add('zoomable');
    im.onclick = () => {
      const all = Array.from($('#content').querySelectorAll('.doc img.doc-img'));
      openLightbox(all.map((x) => ({ url: x.currentSrc || x.src, name: x.alt || 'kuva' })), all.indexOf(im));
    };
  });

  $('#verifyBtn').onclick = async () => {
    if (!author.get()) return toast('Kirjoita ensin nimesi oikeaan yläkulmaan', true);
    await Store.pages.verify(id, author.get());
    toast('Vahvistettu ajantasaiseksi'); viewPage(id);
  };
  $('#editBtn').onclick = () => { location.hash = '#/muokkaa/' + id; };
  // Poisto = siirto roskakoriin. Palvelinversiossa vaaditaan salasana, jottei
  // ohje katoa vahingossa kiireessä; sandboxissa riittää vahvistus.
  const doDeletePage = async (password) => {
    try {
      await Store.pages.remove(id, password);
      clearDraft(id); // ei jätetä poistetun ohjeen luonnosta roikkumaan
      await loadCategories(); // sivupalkin ohjemäärät ajan tasalle
      // Kategoriattomasta ohjeesta palataan etusivulle (#/kohde/null olisi rikki).
      location.hash = p.category_id ? '#/kohde/' + p.category_id : '#/';
      toast('Siirretty roskakoriin – palautettavissa 30 vrk');
    } catch (err) { toast(err.message, true); }
  };
  $('#delBtn').onclick = () => {
    const row = $('#pageDelRow');
    if (!Store.auth) {
      if (confirm('Siirretäänkö ohje roskakoriin? Se on palautettavissa 30 vrk.')) doDeletePage(null);
      return;
    }
    if (row.dataset.mode === 'del') { row.innerHTML = ''; row.dataset.mode = ''; return; }
    row.dataset.mode = 'del';
    row.innerHTML = `<div class="card danger-zone">
      <p style="margin:0 0 10px"><strong>${icon('trash')} Siirretäänkö “${esc(p.title)}” roskakoriin?</strong></p>
      <p class="muted" style="margin:0 0 10px">Ohje liitteineen ja versiohistorioineen säilyy
        <strong>30 vuorokautta</strong> ja on palautettavissa Roskakori-sivulta.</p>
      <div class="row" style="flex-wrap:wrap">
        <input type="password" id="delPagePass" placeholder="Vahvista omalla salasanallasi" autocomplete="current-password"
          style="flex:1; min-width:200px; padding:8px 10px; border:1px solid var(--border); border-radius:6px" />
        <button class="btn small danger" id="delPageConfirm">Siirrä roskakoriin</button>
        <button class="btn small secondary" id="delPageCancel">Peruuta</button>
      </div>
    </div>`;
    const submit = () => {
      const pw = $('#delPagePass').value;
      if (!pw) return toast('Anna salasanasi', true);
      doDeletePage(pw);
    };
    $('#delPageConfirm').onclick = submit;
    $('#delPagePass').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    $('#delPageCancel').onclick = () => { row.innerHTML = ''; row.dataset.mode = ''; };
    $('#delPagePass').focus();
  };
  document.querySelectorAll('[data-delatt]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko liite?')) { await Store.attachments.remove(b.dataset.delatt); viewPage(id); }
  });
  // Lataus alkaa heti tiedostojen valinnasta – erillistä "Lataa"-nappia ei ole,
  // koska se olisi voinut tuottaa vain virheen ennen valintaa.
  const pickBtn = $('#pickFilesBtn');
  pickBtn.onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const label = pickBtn.innerHTML;
    pickBtn.disabled = true;
    pickBtn.textContent = files.length > 1 ? `Ladataan ${files.length} tiedostoa…` : 'Ladataan…';
    try {
      await Store.attachments.upload(id, files, author.get());
      toast(files.length > 1 ? `${files.length} liitettä ladattu` : 'Liite ladattu');
      viewPage(id);
    } catch (err) {
      toast(err.message, true);
      pickBtn.disabled = false; pickBtn.innerHTML = label;
      e.target.value = '';   // sama tiedosto voidaan valita uudelleen
    }
  };
}

async function viewPageEdit(id, presetCat) {
  // Lukija ei voi muokata (palvelin estää joka tapauksessa) – näytetään selkeä
  // viesti tyhjän lomakkeen sijaan.
  if (Store.auth && currentUser && currentUser.role === 'viewer') {
    content.innerHTML = '<div class="card empty">Sinulla on lukuoikeus, joten et voi muokata ohjeita. '
      + 'Pyydä tarvittaessa oikeuksia ylläpitäjältä. <a href="#/">Palaa etusivulle</a></div>';
    return;
  }
  let p = { title: '', content: '', category_id: presetCat ? +presetCat : (categories[0] && categories[0].id) };
  if (id) p = await Store.pages.get(id);
  // Jo liitetyt kuvat voi pudottaa tekstiin ilman uutta latausta (muuten
  // samasta kuvasta syntyisi turha kaksoiskappale).
  const imgAtts = (p.attachments || []).filter((a) => (a.mimetype || '').startsWith('image/'));
  // Tallentamaton luonnos edelliseltä kerralta: tarjotaan palautettavaksi.
  const draft = loadDraft(id);
  const draftDiffers = draft && (draft.title !== p.title || draft.content !== p.content
    || (draft.keywords || '') !== (p.keywords || ''));
  content.innerHTML = `
    <h2 id="editHeading">${id ? 'Muokkaa ohjetta' : 'Uusi ohje'}</h2>
    ${draftDiffers ? `<div class="card draft-note" id="draftNote">
      <strong>${icon('warn')} Tallentamaton luonnos löytyi</strong>
      <p class="muted" style="margin:6px 0 10px">Muokkaus keskeytyi ${esc(fmtDate(new Date(draft.at).toISOString()))}.
        Voit jatkaa siitä mihin jäit tai hylätä luonnoksen.</p>
      <div class="row">
        <button class="btn small" id="draftRestore">Palauta luonnos</button>
        <button class="btn small secondary" id="draftDiscard">Hylkää</button>
      </div>
    </div>` : ''}
    <div class="card">
      <div class="field">
        <label>Otsikko</label>
        <input type="text" id="titleInput" value="${esc(p.title)}" placeholder="Esim. Laitteen X käynnistys" />
      </div>
      <div class="field">
        <label>Kategoria</label>
        <select id="catSelect">
          ${categoryOptionsHtml(p.category_id)}
        </select>
      </div>
      <div class="field">
        <label>Avainsanat (pilkuin eroteltuna – haku löytää artikkelin myös näillä)</label>
        <input type="text" id="keywordsInput" value="${esc(p.keywords || '')}" placeholder="Esim. ISM, laatu, toimintajärjestelmä" />
      </div>
      <div class="field">
        <div class="spread" style="margin-bottom:4px">
          <label style="margin-bottom:0">Sisältö (Markdown: # otsikko, **lihavointi**, - lista)</label>
          <span class="row">
            <button type="button" class="btn small secondary" id="insertImgBtn" title="Lisää kuva tiedostosta – tai liitä kuvakaappaus suoraan tekstikenttään (Ctrl/Cmd+V)">${icon('camera')} Lisää kuva</button>
            <button type="button" class="btn small secondary" id="previewToggle">${icon('eye')} Esikatselu</button>
          </span>
        </div>
        <input type="file" id="imgFileInput" accept="image/*" multiple style="display:none" />
        <textarea id="contentInput" placeholder="Kirjoita työohje tähän…">${esc(p.content)}</textarea>
        <div id="previewBox" class="doc preview-box" style="display:none"></div>
        <p class="muted" style="margin:6px 0 0">Kuva tekstin sekaan: <strong>Lisää kuva</strong> -napista,
          tai liitä kuvakaappaus suoraan tekstiin (Ctrl/Cmd+V). Kuva ilmestyy siihen kohtaan, missä kursori on.</p>
      </div>
      ${imgAtts.length ? `<div class="field">
        <label>Jo liitetyt kuvat – klikkaa lisätäksesi tekstiin kursorin kohdalle</label>
        <div class="att-pick">
          ${imgAtts.map((a) => `<button type="button" class="att-pick-item" data-insert="${a.id}"
            title="Lisää tekstiin: ${esc(a.original_name)}">
            <img src="${esc(a.url)}" alt="${esc(a.original_name)}" loading="lazy" />
            <span>${esc(a.original_name)}</span>
          </button>`).join('')}
        </div>
      </div>` : ''}
      <div class="row">
        <button class="btn" id="saveBtn">Tallenna</button>
        <button class="btn secondary" id="cancelBtn">Peruuta</button>
      </div>
    </div>`;

  // Nykyiset kenttäarvot yhtenä oliona (luonnoksen tallennusta varten).
  const formData = () => ({
    title: $('#titleInput').value, content: $('#contentInput').value,
    keywords: $('#keywordsInput').value, category_id: $('#catSelect').value,
  });
  // Jos jotain on muutettu: varoitus poistuttaessa JA luonnos talteen.
  const markDirty = () => { setUnsavedGuard(true); saveDraft(id, formData()); };
  ['titleInput', 'keywordsInput', 'contentInput'].forEach((fid) => {
    const el = $('#' + fid);
    if (el) el.addEventListener('input', markDirty);
  });
  $('#catSelect').addEventListener('change', markDirty);

  if (draftDiffers) {
    $('#draftRestore').onclick = () => {
      $('#titleInput').value = draft.title || '';
      $('#contentInput').value = draft.content || '';
      $('#keywordsInput').value = draft.keywords || '';
      if (draft.category_id) $('#catSelect').value = draft.category_id;
      $('#draftNote').remove();
      setUnsavedGuard(true);
      toast('Luonnos palautettu');
    };
    $('#draftDiscard').onclick = () => { clearDraft(id); $('#draftNote').remove(); toast('Luonnos hylätty'); };
  }

  // Vierittää tekstikentän annettuun kohtaan, jotta käyttäjä NÄKEE mitä
  // tapahtui. Ilman tätä lisäys voi tapahtua näkymän ulkopuolella, jolloin
  // vaikuttaa ettei mitään tapahtunut – ja tulee klikatuksi uudelleen.
  function scrollToPos(ta, pos) {
    const line = ta.value.slice(0, pos).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
  }

  // Mitkä liitteet ovat jo tekstissä.
  const usedIds = () => new Set(
    ($('#contentInput').value.match(/!\[[^\]]*\]\(liite:(\d+)\)/g) || [])
      .map((m) => +(m.match(/liite:(\d+)/) || [])[1]));

  // Merkitsee valitsimeen, mitkä kuvat ovat jo tekstissä.
  function refreshPickState() {
    const used = usedIds();
    document.querySelectorAll('[data-insert]').forEach((b) => {
      const on = used.has(+b.dataset.insert);
      b.classList.toggle('used', on);
      b.title = on ? 'Tämä kuva on jo tekstissä – klikkaus näyttää sen kohdan'
        : 'Lisää tekstiin kursorin kohdalle';
    });
  }

  // Kirjoittaa kuvaviittaukset tekstiin kursorin kohdalle ja siirtää kursorin
  // lisätyn kohdan perään, jotta kirjoittamista voi jatkaa saumattomasti.
  function insertRefs(ids) {
    const ta = $('#contentInput');
    const pos = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
    const md = ids.map((aid) => `\n![kuva](liite:${aid})\n`).join('');
    ta.value = ta.value.slice(0, pos) + md + ta.value.slice(pos);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = pos + md.length;
    scrollToPos(ta, pos + md.length);
    markDirty(); // kuvaviittaus on muutos kuten kirjoittaminenkin
    refreshPickState();
  }

  // Liite tarvitsee ohjeen, johon se kiinnittyy. Uutta ohjetta kirjoitettaessa
  // sitä ei vielä ole, joten ohje tallennetaan tässä kohtaa automaattisesti –
  // käyttäjän ei pidä joutua keskeyttämään kirjoittamista kuvan takia.
  // Palauttaa true jos ohje on olemassa ja kuvia voi liittää.
  async function ensureSaved() {
    if (id) return true;
    const title = $('#titleInput').value.trim();
    if (!title) { toast('Anna ensin otsikko, niin kuva voidaan liittää ohjeeseen', true); return false; }
    try {
      const saved = await Store.pages.create({
        title, content: $('#contentInput').value, keywords: $('#keywordsInput').value,
        category_id: +$('#catSelect').value, author: author.get(),
      });
      clearDraft(null);          // "uusi"-luonnos siirtyy nyt ohjeen omaksi
      id = saved.id;             // lomake jatkaa saman ohjeen muokkaamisena
      await loadCategories();    // ohjemäärä sivupalkkiin
      // Osoite vastaamaan tilannetta ilman uudelleenrenderöintiä.
      history.replaceState(null, '', '#/muokkaa/' + id);
      lastHash = location.hash;
      const hd = $('#editHeading');
      if (hd) hd.textContent = 'Muokkaa ohjetta';   // ei ole enää uusi
      toast('Ohje tallennettiin, jotta kuva voidaan liittää');
      return true;
    } catch (err) { toast(err.message, true); return false; }
  }

  // Kuvien lisäys: lataa liitteeksi ja lisää viittaus tekstiin kursorin kohdalle.
  async function insertImages(files) {
    const imgs = Array.from(files).filter((f) => f.type.indexOf('image/') === 0);
    if (!imgs.length) return;
    if (!(await ensureSaved())) return;
    try {
      const res = await Store.attachments.upload(id, imgs, author.get());
      insertRefs(res.ids || []);
      toast(imgs.length > 1 ? 'Kuvat lisätty' : 'Kuva lisätty');
    } catch (err) { toast(err.message, true); }
  }

  // Jo liitetty kuva tekstiin: ei uutta latausta, vain viittaus.
  // Jos kuva on JO tekstissä, klikkaus ei monista sitä vaan näyttää missä se on
  // (toistuva klikkaus täytti aiemmin tekstin samoilla viittauksilla).
  document.querySelectorAll('[data-insert]').forEach((b) => b.onclick = () => {
    const aid = +b.dataset.insert;
    const ta = $('#contentInput');
    if (usedIds().has(aid)) {
      const re = new RegExp('!\\[[^\\]]*\\]\\(liite:' + aid + '\\)');
      const m = re.exec(ta.value);
      if (m) {
        ta.focus();
        ta.selectionStart = m.index;
        ta.selectionEnd = m.index + m[0].length;
        scrollToPos(ta, m.index);
      }
      toast('Kuva on jo tekstissä – kohta korostettu');
      return;
    }
    insertRefs([aid]);
    toast('Kuva lisätty tekstiin');
  });
  // Merkinnät ajan tasalle myös kun viittaus poistetaan käsin tekstistä.
  $('#contentInput').addEventListener('input', refreshPickState);
  refreshPickState();
  $('#insertImgBtn').onclick = () => $('#imgFileInput').click();
  $('#imgFileInput').onchange = (e) => { insertImages(e.target.files); e.target.value = ''; };
  // Kuvakaappauksen liittäminen suoraan tekstikenttään (Ctrl/Cmd+V).
  $('#contentInput').addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const item of items) {
      if (item.type && item.type.indexOf('image/') === 0) {
        const f = item.getAsFile();
        if (f) files.push(new File([f], 'kuvakaappaus-' + Date.now() + '.png', { type: f.type }));
      }
    }
    if (files.length) { e.preventDefault(); insertImages(files); }
  });

  // Esikatselu: näyttää miltä Markdown-muotoilu näyttää ennen tallennusta.
  $('#previewToggle').onclick = () => {
    const ta = $('#contentInput'), box = $('#previewBox'), btn = $('#previewToggle');
    const showPreview = box.style.display === 'none';
    if (showPreview) {
      box.innerHTML = renderMarkdown(ta.value) || '<p class="muted">Ei sisältöä vielä.</p>';
      hydrateDocImages(box);
      box.style.display = ''; ta.style.display = 'none';
      btn.innerHTML = icon('edit') + ' Muokkaa tekstiä';
    } else {
      box.style.display = 'none'; ta.style.display = '';
      btn.innerHTML = icon('eye') + ' Esikatselu';
    }
  };

  $('#saveBtn').onclick = async () => {
    const body = {
      title: $('#titleInput').value,
      content: $('#contentInput').value,
      keywords: $('#keywordsInput').value,
      category_id: +$('#catSelect').value,
      author: author.get(),
    };
    if (!body.title.trim()) return toast('Anna otsikko', true);
    try {
      const saved = id
        ? await Store.pages.update(id, body)
        : await Store.pages.create(body);
      // Tallennus onnistui: luonnosta ei enää tarvita eikä poistumisesta varoiteta.
      clearDraft(id);
      setUnsavedGuard(false);
      // Uusi ohje tai kategorian vaihto muuttaa sivupalkin ohjemääriä.
      await loadCategories();
      toast('Tallennettu'); location.hash = '#/sivu/' + saved.id;
    } catch (err) { toast(err.message, true); }
  };
  // Peruuta on tietoinen valinta: ei kysytä uudelleen. Luonnos jää silti
  // talteen, joten vahingossa painettu Peruuta ei hukkaa tekstiä.
  $('#cancelBtn').onclick = () => { setUnsavedGuard(false); history.back(); };
}

async function viewShiftLog() {
  const notes = await Store.notes.list({ limit: 200 });
  content.innerHTML = `
    <h2>${icon('note','ic-lg')} Päiväkirja</h2>
    <p class="muted">Juokseva lista omista merkinnöistä. Uusin näkyy ylimpänä.</p>
    <div class="card editor-only">
      <div class="field">
        <label>Kategoria (valinnainen)</label>
        <select id="noteCat">
          <option value="">– Yleinen –</option>
          ${categoryOptionsHtml(null)}
        </select>
      </div>
      <div class="field">
        <label>Huomio</label>
        <textarea id="noteText" style="min-height:90px" placeholder="Mitä haluat muistaa?"></textarea>
      </div>
      <button class="btn" id="addNoteBtn">Lisää merkintä</button>
    </div>
    <div id="notesList">
      ${notes.map(noteHtml).join('') || '<p class="empty">Ei merkintöjä vielä.</p>'}
    </div>`;

  $('#addNoteBtn').onclick = async () => {
    const body = { content: $('#noteText').value, category_id: $('#noteCat').value || null, author: author.get() };
    if (!body.content.trim()) return toast('Kirjoita jotain', true);
    try { await Store.notes.create(body); toast('Lisätty'); viewShiftLog(); }
    catch (err) { toast(err.message, true); }
  };
  bindNoteDelete(viewShiftLog);
}

// Roskakori: poistetut ohjeet säilyvät 30 vrk ja ovat palautettavissa.
// Lopullinen poisto on peruuttamaton → vain ylläpitäjä + salasana.
async function viewTrash() {
  const rows = await Store.trash.list();
  const isAdmin = !Store.auth || (currentUser && currentUser.role === 'admin');
  content.innerHTML = `
    <h2>${icon('trash', 'ic-lg')} Roskakori</h2>
    <p class="muted">Poistetut ohjeet säilyvät <strong>30 vuorokautta</strong> liitteineen ja
      versiohistorioineen. Sen jälkeen ne poistuvat lopullisesti automaattisesti.</p>
    <div id="trashDelRow"></div>
    <div class="card">
      <ul class="page-list">
        ${rows.map((r) => `<li class="trash-row">
          <span class="att-name">
            <strong>${esc(r.title)}</strong>
            <div class="att-meta">${esc(r.category_name || 'Yleinen')} · poistettu
              ${esc(fmtDate(r.deleted_at))}${r.deleted_by ? ' · ' + esc(r.deleted_by) : ''}</div>
          </span>
          <span class="trash-left ${r.days_left <= 5 ? 'soon' : ''}">${r.days_left} vrk jäljellä</span>
          <span class="row">
            <button class="btn small secondary" data-restore="${r.id}">${icon('history')} Palauta</button>
            ${isAdmin ? `<button class="btn small danger" data-purge="${r.id}" data-title="${esc(r.title)}">Poista lopullisesti</button>` : ''}
          </span>
        </li>`).join('')
        || '<li class="empty">Roskakori on tyhjä. Poistetut ohjeet näkyvät täällä 30 vuorokautta.</li>'}
      </ul>
    </div>`;

  document.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
    try {
      await Store.pages.restore(b.dataset.restore);
      await loadCategories(); // ohjemäärät kategorioihin takaisin
      toast('Ohje palautettu'); viewTrash();
    } catch (err) { toast(err.message, true); }
  });
  document.querySelectorAll('[data-purge]').forEach((b) => b.onclick = () => {
    const pid = b.dataset.purge;
    const row = $('#trashDelRow');
    const purge = async (password) => {
      try {
        await Store.trash.remove(pid, password);
        row.innerHTML = ''; row.dataset.mode = '';
        toast('Poistettu lopullisesti'); viewTrash();
      } catch (err) { toast(err.message, true); }
    };
    if (!Store.auth) {
      if (confirm('Poistetaanko ohje LOPULLISESTI? Tätä ei voi perua.')) purge(null);
      return;
    }
    if (row.dataset.mode === pid) { row.innerHTML = ''; row.dataset.mode = ''; return; }
    row.dataset.mode = pid;
    row.innerHTML = `<div class="card danger-zone">
      <p style="margin:0 0 10px"><strong>${icon('warn')} Poistetaanko “${esc(b.dataset.title)}” lopullisesti?</strong></p>
      <p class="muted" style="margin:0 0 10px">Ohje, sen liitteet ja koko versiohistoria katoavat pysyvästi. Tätä ei voi perua.</p>
      <div class="row" style="flex-wrap:wrap">
        <input type="password" id="purgePass" placeholder="Vahvista omalla salasanallasi" autocomplete="current-password"
          style="flex:1; min-width:200px; padding:8px 10px; border:1px solid var(--border); border-radius:6px" />
        <button class="btn small danger" id="purgeConfirm">Poista lopullisesti</button>
        <button class="btn small secondary" id="purgeCancel">Peruuta</button>
      </div>
    </div>`;
    const submit = () => {
      const pw = $('#purgePass').value;
      if (!pw) return toast('Anna salasanasi', true);
      purge(pw);
    };
    $('#purgeConfirm').onclick = submit;
    $('#purgePass').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    $('#purgeCancel').onclick = () => { row.innerHTML = ''; row.dataset.mode = ''; };
    $('#purgePass').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function viewHistory(pageId) {
  const [p, revs] = await Promise.all([Store.pages.get(pageId), Store.pages.revisions(pageId)]);
  content.innerHTML = `
    <div class="muted"><a href="#/sivu/${p.id}">${icon('back','ic-sm')} ${esc(p.title)}</a></div>
    <h2 style="margin-top:4px">${icon('history','ic-lg')} Versiohistoria</h2>
    <div class="card">
      <ul class="page-list">
        <li><button class="page-link" data-page="${p.id}">
          <span><strong>Nykyinen versio</strong></span>
          <span class="muted">${esc(fmtDate(p.updated_at))}${p.updated_by ? ' · ' + esc(p.updated_by) : ''}</span>
        </button></li>
        ${revs.map((r) => `<li><button class="page-link" data-rev="${r.id}">
          <span>${esc(r.title)}</span>
          <span class="muted">${esc(fmtDate(r.saved_at))}${r.saved_by ? ' · ' + esc(r.saved_by) : ''}</span>
        </button></li>`).join('')
        || '<li class="empty">Ei aiempia versioita. Versio tallentuu aina kun ohjetta muokataan.</li>'}
      </ul>
    </div>`;
  document.querySelectorAll('[data-rev]').forEach((b) => b.onclick = () => {
    location.hash = '#/versio/' + b.dataset.rev;
  });
}

async function viewRevision(revId) {
  const rev = await Store.revisions.get(revId);
  content.innerHTML = `
    <div class="muted"><a href="#/historia/${rev.page_id}">${icon('back','ic-sm')} Versiohistoria</a></div>
    <div class="spread">
      <h2 style="margin:4px 0 0">${esc(rev.title)}</h2>
      <button class="btn small" id="restoreBtn">${icon('history')} Palauta tämä versio</button>
    </div>
    <p class="muted">Vanha versio · tallennettu ${esc(fmtDate(rev.saved_at))}${rev.saved_by ? ' · ' + esc(rev.saved_by) : ''}</p>
    <div class="card doc">${rev.content.trim() ? renderMarkdown(rev.content) : '<p class="muted">Tyhjä sisältö.</p>'}</div>`;
  hydrateDocImages($('#content'));

  $('#restoreBtn').onclick = async () => {
    if (!confirm('Palautetaanko tämä versio? Nykyinen versio tallentuu historiaan.')) return;
    try {
      await Store.pages.update(rev.page_id, {
        title: rev.title, content: rev.content, keywords: rev.keywords || '',
        category_id: rev.category_id, author: author.get(),
      });
      toast('Versio palautettu'); location.hash = '#/sivu/' + rev.page_id;
    } catch (err) { toast(err.message, true); }
  };
}

async function viewAnnouncements(editId) {
  const anns = await Store.announcements.list();
  const editing = editId ? anns.find((a) => a.id === editId) : null;
  content.innerHTML = `
    <h2>${icon('announce','ic-lg')} Muistutukset</h2>
    <p class="muted">Kiinnitetyt muistutukset pysyvät listan ja etusivun kärjessä.</p>
    <div class="card editor-only">
      <h3 style="margin-top:0">${editing ? 'Muokkaa muistutusta' : 'Uusi muistutus'}</h3>
      <div class="field">
        <label>Otsikko</label>
        <input type="text" id="annTitle" value="${editing ? esc(editing.title) : ''}" placeholder="Esim. Kohteen 4021 huoltokatko 12.7." />
      </div>
      <div class="field">
        <label>Sisältö</label>
        <textarea id="annContent" style="min-height:110px" placeholder="Tiedotteen teksti…">${editing ? esc(editing.content) : ''}</textarea>
      </div>
      <label class="row" style="margin-bottom:12px; cursor:pointer">
        <input type="checkbox" id="annPinned" ${editing && editing.pinned ? 'checked' : ''} />
        ${icon('pin')} Kiinnitä tärkeänä (pysyy kärjessä)
      </label>
      <div class="row">
        <button class="btn" id="annSaveBtn">${editing ? 'Tallenna muutokset' : 'Lisää muistutus'}</button>
        ${editing ? '<button class="btn secondary" id="annCancelBtn">Peruuta</button>' : ''}
      </div>
    </div>
    <div id="annList">
      ${anns.map((a) => announcementHtml(a)).join('') || '<p class="empty">Ei tiedotteita vielä.</p>'}
    </div>`;

  $('#annSaveBtn').onclick = async () => {
    const body = {
      title: $('#annTitle').value, content: $('#annContent').value,
      pinned: $('#annPinned').checked, author: author.get(),
    };
    if (!body.title.trim()) return toast('Anna otsikko', true);
    try {
      if (editing) await Store.announcements.update(editing.id, body);
      else await Store.announcements.create(body);
      toast(editing ? 'Tallennettu' : 'Muistutus lisätty'); viewAnnouncements();
    } catch (err) { toast(err.message, true); }
  };
  if (editing) $('#annCancelBtn').onclick = () => viewAnnouncements();
  bindAnnouncementActions(() => viewAnnouncements());
}

function bindAnnouncementActions(refresh) {
  document.querySelectorAll('[data-pin]').forEach((b) => b.onclick = async () => {
    await Store.announcements.update(+b.dataset.pin, { pinned: b.dataset.pinned !== '1' });
    toast(b.dataset.pinned !== '1' ? 'Kiinnitetty' : 'Kiinnitys poistettu'); refresh();
  });
  document.querySelectorAll('[data-editann]').forEach((b) => b.onclick = () => viewAnnouncements(+b.dataset.editann));
  document.querySelectorAll('[data-delann]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko muistutus?')) { await Store.announcements.remove(b.dataset.delann); refresh(); }
  });
}

async function viewTerms(editId) {
  const terms = await Store.terms.list();
  const editing = editId ? terms.find((t) => t.id === editId) : null;
  // Ryhmittely alkukirjaimen mukaan
  const groups = {};
  for (const t of terms) {
    const letter = (t.term[0] || '?').toUpperCase();
    (groups[letter] = groups[letter] || []).push(t);
  }
  content.innerHTML = `
    <h2>${icon('terms','ic-lg')} Termipankki</h2>
    <p class="muted">Talon termit, lyhenteet ja käsitteet selkokielellä – erityisesti uusille työntekijöille. Haku löytää myös termit.</p>
    <div class="card editor-only">
      <h3 style="margin-top:0">${editing ? 'Muokkaa termiä' : 'Lisää termi'}</h3>
      <div class="row" style="align-items:flex-start">
        <div class="field" style="flex:1; min-width:180px; margin-bottom:0">
          <label>Termi / lyhenne</label>
          <input type="text" id="termInput" value="${editing ? esc(editing.term) : ''}" placeholder="Esim. Kipa" />
        </div>
        <div class="field" style="flex:3; min-width:260px; margin-bottom:0">
          <label>Selitys</label>
          <input type="text" id="defInput" value="${editing ? esc(editing.definition) : ''}" placeholder="Mitä termi tarkoittaa meillä" />
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="termSaveBtn">${editing ? 'Tallenna' : 'Lisää'}</button>
        ${editing ? '<button class="btn secondary" id="termCancelBtn">Peruuta</button>' : ''}
      </div>
    </div>
    <div class="card">
      ${Object.keys(groups).map((letter) => `
        <div class="term-letter">${esc(letter)}</div>
        <dl class="term-list">
          ${groups[letter].map((t) => `
            <div class="term-row">
              <dt>${esc(t.term)}</dt>
              <dd>${esc(t.definition)}</dd>
              <span class="term-actions">
                <button class="icon-btn small" data-editterm="${t.id}" title="Muokkaa">${icon('edit')}</button>
                <button class="icon-btn small" data-delterm="${t.id}" title="Poista">${icon('trash')}</button>
              </span>
            </div>`).join('')}
        </dl>`).join('') || '<p class="empty">Ei termejä vielä. Lisää ensimmäinen yllä.</p>'}
    </div>`;

  $('#termSaveBtn').onclick = async () => {
    const body = { term: $('#termInput').value, definition: $('#defInput').value, author: author.get() };
    if (!body.term.trim()) return toast('Anna termi', true);
    try {
      if (editing) await Store.terms.update(editing.id, body);
      else await Store.terms.create(body);
      toast('Tallennettu'); viewTerms();
    } catch (err) { toast(err.message, true); }
  };
  if (editing) $('#termCancelBtn').onclick = () => viewTerms();
  document.querySelectorAll('[data-editterm]').forEach((b) => b.onclick = () => viewTerms(+b.dataset.editterm));
  document.querySelectorAll('[data-delterm]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko termi?')) { await Store.terms.remove(b.dataset.delterm); viewTerms(); }
  });
}

async function viewLinks(editId) {
  const links = await Store.links.list();
  const editing = editId ? links.find((l) => l.id === editId) : null;
  content.innerHTML = `
    <h2>${icon('link','ic-lg')} Linkit</h2>
    <p class="muted">Usein tarvitut osoitteet: järjestelmät, häiriökartat, intranet ym.</p>
    <div class="card editor-only">
      <h3 style="margin-top:0">${editing ? 'Muokkaa linkkiä' : 'Lisää linkki'}</h3>
      <div class="row" style="align-items:flex-start">
        <div class="field" style="flex:1; min-width:160px; margin-bottom:0">
          <label>Nimi</label>
          <input type="text" id="linkLabel" value="${editing ? esc(editing.label) : ''}" placeholder="Esim. Sähköyhtiön häiriökartta" />
        </div>
        <div class="field" style="flex:1; min-width:200px; margin-bottom:0">
          <label>Osoite (URL)</label>
          <input type="text" id="linkUrl" value="${editing ? esc(editing.url) : ''}" placeholder="esim. hairiokartta.fi" />
        </div>
        <div class="field" style="flex:1; min-width:180px; margin-bottom:0">
          <label>Kuvaus (valinnainen)</label>
          <input type="text" id="linkNote" value="${editing ? esc(editing.note) : ''}" placeholder="Mihin linkkiä käytetään" />
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="linkSaveBtn">${editing ? 'Tallenna' : 'Lisää'}</button>
        ${editing ? '<button class="btn secondary" id="linkCancelBtn">Peruuta</button>' : ''}
      </div>
    </div>
    <div class="card">
      <ul class="link-list">
        ${links.map(linkHtml).join('') || '<li class="empty">Ei linkkejä vielä. Lisää ensimmäinen yllä.</li>'}
      </ul>
    </div>`;

  $('#linkSaveBtn').onclick = async () => {
    const body = { label: $('#linkLabel').value, url: $('#linkUrl').value, note: $('#linkNote').value };
    if (!body.label.trim()) return toast('Anna nimi', true);
    if (!body.url.trim()) return toast('Anna osoite', true);
    try {
      if (editing) await Store.links.update(editing.id, body);
      else await Store.links.create(body);
      toast('Tallennettu'); viewLinks();
    } catch (err) { toast(err.message, true); }
  };
  if (editing) $('#linkCancelBtn').onclick = () => viewLinks();
  document.querySelectorAll('[data-editlink]').forEach((b) => b.onclick = () => viewLinks(+b.dataset.editlink));
  document.querySelectorAll('[data-dellink]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko linkki?')) { await Store.links.remove(b.dataset.dellink); viewLinks(); }
  });
  document.querySelectorAll('[data-lmove]').forEach((b) => b.onclick = async () => {
    const ids = moveInList(links.map((l) => l.id), +b.dataset.lmove, +b.dataset.dir);
    if (ids) { await Store.links.reorder(ids); viewLinks(); }
  });
}

function linkHtml(l) {
  return `<li class="link-row">
    <span class="att-icon">${icon('link')}</span>
    <span class="att-name">
      <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>
      <div class="att-meta">${esc(l.url)}${l.note ? ' · ' + esc(l.note) : ''}</div>
    </span>
    <span class="contact-actions">
      <span class="row-order">
        <button class="icon-btn" data-lmove="${l.id}" data-dir="-1" title="Siirrä ylös">${icon('chevUp')}</button>
        <button class="icon-btn" data-lmove="${l.id}" data-dir="1" title="Siirrä alas">${icon('chevDown')}</button>
      </span>
      <button class="icon-btn small" data-editlink="${l.id}" title="Muokkaa">${icon('edit')}</button>
      <button class="icon-btn small" data-dellink="${l.id}" title="Poista">${icon('trash')}</button>
    </span>
  </li>`;
}

async function viewSearch(q) {
  $('#searchInput').value = q;
  const r = await Store.search(q);
  content.innerHTML = `
    <h2>Hakutulokset: "${esc(q)}"</h2>
    <div class="card">
      <h3 style="margin-top:0">Työohjeet (${r.pages.length})</h3>
      <ul class="page-list">
        ${r.pages.map((p) => `<li><button class="page-link result" data-page="${p.id}">
          <span class="result-main">
            <span>${esc(p.title)}</span>
            ${p.snippet ? `<span class="snippet">${highlight(p.snippet, q)}</span>` : ''}
          </span>
          <span class="muted">${esc(p.category_name || 'Yleinen')}</span></button></li>`).join('')
          || '<li class="empty">Ei osumia ohjeista.</li>'}
      </ul>
    </div>
    <div class="card">
      <h3 style="margin-top:0">${icon('attach')} Tiedostot (${r.files.length})</h3>
      <ul class="attach-list">
        ${r.files.map((f) => `<li>
          <span class="att-icon">${fileIcon(f.mimetype)}</span>
          <span class="att-name">
            <a href="${f.url}" target="_blank" rel="noopener">${esc(f.original_name)}</a>
            <div class="att-meta">Sivulla: <a href="#/sivu/${f.page_id}">${esc(f.page_title)}</a>
              ${f.category_name ? ' · ' + esc(f.category_name) : ''}</div>
            ${f.snippet ? `<div class="snippet">${highlight(f.snippet, q)}</div>` : ''}
          </span>
        </li>`).join('') || '<li class="muted" style="border:none">Ei osumia tiedostoista.</li>'}
      </ul>
    </div>
    ${(r.links || []).length ? `<div class="card">
      <h3 style="margin-top:0">${icon('link')} Linkit (${r.links.length})</h3>
      <ul class="link-list">
        ${r.links.map((l) => `<li class="link-row">
          <span class="att-icon">${icon('link')}</span>
          <span class="att-name">
            <a href="${esc(l.url)}" target="_blank" rel="noopener">${highlight(l.label, q)}</a>
            <div class="att-meta">${esc(l.url)}${l.note ? ' · ' + esc(l.note) : ''}</div>
          </span>
        </li>`).join('')}
      </ul>
    </div>` : ''}
    ${(r.terms || []).length ? `<div class="card">
      <h3 style="margin-top:0">${icon('terms')} Termit (${r.terms.length})</h3>
      <dl class="term-list">
        ${r.terms.map((t) => `<div class="term-row">
          <dt>${highlight(t.term, q)}</dt>
          <dd>${highlight(t.definition, q)}</dd>
          <span class="term-actions"><a class="btn small secondary" href="#/termipankki">Termipankki</a></span>
        </div>`).join('')}
      </dl>
    </div>` : ''}
    <div class="card">
      <h3 style="margin-top:0">${icon('announce')} Muistutukset (${(r.announcements || []).length})</h3>
      ${(r.announcements || []).map((a) => announcementHtml(a, { compact: true })).join('')
        || '<p class="empty">Ei osumia tiedotteista.</p>'}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Merkinnät (${r.notes.length})</h3>
      ${r.notes.map(noteHtml).join('') || '<p class="empty">Ei osumia huomioista.</p>'}
    </div>`;
  bindNoteDelete(() => viewSearch(q));
}

// ---------- Osittaiset HTML-palaset ----------
// Ajantasaisuusmerkki: vihreä jos vahvistettu ≤ 180 pv sitten, punainen jos
// vahvistus on sitä vanhempi, harmaa jos ei koskaan vahvistettu.
const VERIFY_MAX_DAYS = 180;
function verifyBadge(p) {
  if (!p.verified_at) {
    return '<span class="verify-badge never">Ei vahvistettu ajantasaiseksi</span>';
  }
  const days = Math.floor((Date.now() - new Date(p.verified_at).getTime()) / 86400000);
  const meta = esc(fmtDate(p.verified_at)) + (p.verified_by ? ' · ' + esc(p.verified_by) : '');
  if (days > VERIFY_MAX_DAYS) {
    return `<span class="verify-badge stale">${icon('warn','ic-sm')} Vahvistus vanhentunut (${meta})</span>`;
  }
  return `<span class="verify-badge ok">${icon('verify','ic-sm')} Vahvistettu ajantasaiseksi ${meta}</span>`;
}

function announcementHtml(a, { compact } = {}) {
  return `<div class="ann ${a.pinned ? 'pinned' : ''}">
    <div class="ann-head">
      <strong class="ann-title">${a.pinned ? icon('pin', 'ic-sm') + ' ' : ''}${esc(a.title)}</strong>
      <span class="ann-actions">
        ${compact ? '' : `<button class="icon-btn small" data-pin="${a.id}" data-pinned="${a.pinned ? 1 : 0}"
          title="${a.pinned ? 'Poista kiinnitys' : 'Kiinnitä'}" ${a.pinned ? 'aria-pressed="true"' : ''}>${icon('pin')}</button>
        <button class="icon-btn small" data-editann="${a.id}" title="Muokkaa">${icon('edit')}</button>
        <button class="icon-btn small" data-delann="${a.id}" title="Poista">${icon('trash')}</button>`}
      </span>
    </div>
    ${a.content.trim() ? `<div class="ann-body">${esc(a.content)}</div>` : ''}
    <div class="ann-meta">${esc(fmtDate(a.created_at))}${a.created_by ? ' · ' + esc(a.created_by) : ''}</div>
  </div>`;
}

function noteHtml(n) {
  return `<div class="note">
    <div class="note-head">
      <span>${n.author ? '<strong>' + esc(n.author) + '</strong> · ' : ''}${esc(fmtDate(n.created_at))}
        ${n.category_name ? '· <span class="tag">' + esc(n.category_name) + '</span>' : ''}</span>
      <button class="icon-btn small" data-delnote="${n.id}" title="Poista">${icon('trash')}</button>
    </div>
    <div class="note-body">${esc(n.content)}</div>
  </div>`;
}

function contactHtml(c) {
  const tel = c.phone ? c.phone.replace(/[^\d+]/g, '') : '';
  return `<li class="contact">
    <div class="contact-main">
      <div class="contact-label">${esc(c.label)}</div>
      ${c.phone ? `<a class="contact-phone" href="tel:${esc(tel)}">${esc(c.phone)}</a>` : ''}
      ${c.note ? `<div class="att-meta">${esc(c.note)}</div>` : ''}
    </div>
    <div class="contact-actions">
      <span class="row-order">
        <button class="icon-btn" data-cmove="${c.id}" data-dir="-1" title="Siirrä ylös">${icon('chevUp')}</button>
        <button class="icon-btn" data-cmove="${c.id}" data-dir="1" title="Siirrä alas">${icon('chevDown')}</button>
      </span>
      <button class="icon-btn small" data-editcontact="${c.id}" title="Muokkaa">${icon('edit')}</button>
      <button class="icon-btn small" data-delcontact="${c.id}" title="Poista">${icon('trash')}</button>
    </div>
  </li>`;
}

function attHtml(a) {
  return `<li>
    <span class="att-icon">${fileIcon(a.mimetype)}</span>
    <span class="att-name">
      <a href="${a.url}" target="_blank" rel="noopener">${esc(a.original_name)}</a>
      <div class="att-meta">${fmtSize(a.size)} · ${esc(fmtDate(a.uploaded_at))}${a.uploaded_by ? ' · ' + esc(a.uploaded_by) : ''}</div>
    </span>
    <button class="btn small danger" data-delatt="${a.id}">Poista</button>
  </li>`;
}

function bindNoteDelete(refresh) {
  document.querySelectorAll('[data-delnote]').forEach((b) => b.onclick = async () => {
    if (confirm('Poistetaanko merkintä?')) { await Store.notes.remove(b.dataset.delnote); refresh(); }
  });
}

// ---------- Kuvien lightbox ----------
// images: [{url, name}]. Nuolet/nuolinäppäimet selaavat, Esc/tausta sulkee.
function openLightbox(images, start) {
  if (!images || !images.length) return;
  let i = start || 0;
  let ov = $('#lightbox');
  if (!ov) { ov = document.createElement('div'); ov.id = 'lightbox'; ov.className = 'lightbox'; document.body.appendChild(ov); }
  const multi = images.length > 1;
  const close = () => { ov.classList.remove('open'); document.removeEventListener('keydown', onKey); setTimeout(() => { ov.innerHTML = ''; }, 180); };
  const step = (d) => { i = (i + d + images.length) % images.length; render(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (multi && e.key === 'ArrowLeft') step(-1);
    else if (multi && e.key === 'ArrowRight') step(1);
  };
  function render() {
    ov.innerHTML = `
      <button class="lb-close" title="Sulje (Esc)" aria-label="Sulje">${icon('close', 'ic-lg')}</button>
      ${multi ? `<button class="lb-nav lb-prev" title="Edellinen" aria-label="Edellinen">${icon('back')}</button>` : ''}
      <img class="lb-img" src="${esc(images[i].url)}" alt="${esc(images[i].name)}" />
      ${multi ? `<button class="lb-nav lb-next" title="Seuraava" aria-label="Seuraava">${icon('chevRight')}</button>` : ''}
      <div class="lb-caption">${esc(images[i].name)}${multi ? ` · ${i + 1}/${images.length}` : ''}</div>`;
    ov.querySelector('.lb-close').onclick = close;
    const pv = ov.querySelector('.lb-prev'); if (pv) pv.onclick = (e) => { e.stopPropagation(); step(-1); };
    const nx = ov.querySelector('.lb-next'); if (nx) nx.onclick = (e) => { e.stopPropagation(); step(1); };
  }
  ov.onclick = (e) => { if (e.target === ov || e.target.classList.contains('lb-img')) close(); };
  document.addEventListener('keydown', onKey);
  render();
  requestAnimationFrame(() => ov.classList.add('open'));
}

// ---------- Puhelimen alapalkki (näkyy vain kapealla näytöllä) ----------
(function initBottomNav() {
  const bar = document.createElement('nav');
  bar.id = 'bottomNav';
  bar.className = 'bottom-nav';
  bar.setAttribute('aria-label', 'Päävalikko');
  const items = [
    { nav: 'home', ic: 'home', label: 'Etusivu' },
    { nav: 'shiftlog', ic: 'note', label: 'Päiväkirja' },
    { act: 'search', ic: 'search2', label: 'Haku' },
    { nav: 'announcements', ic: 'announce', label: 'Muistutukset' },
    { act: 'menu', ic: 'menu', label: 'Valikko' },
  ];
  bar.innerHTML = items.map((it) =>
    `<button class="bn-item" ${it.nav ? `data-bnav="${it.nav}"` : `data-bact="${it.act}"`}>
      ${icon(it.ic)}<span>${it.label}</span></button>`).join('');
  document.body.appendChild(bar);
  bar.querySelectorAll('[data-bnav]').forEach((b) => b.onclick = () => {
    const routes = { home: '#/', shiftlog: '#/paivakirja', announcements: '#/muistutukset' };
    location.hash = routes[b.dataset.bnav] || '#/';
    window.scrollTo({ top: 0 });
  });
  bar.querySelector('[data-bact="search"]').onclick = () => { window.scrollTo({ top: 0 }); const s = $('#searchInput'); if (s) s.focus(); };
  bar.querySelector('[data-bact="menu"]').onclick = () => $('#sidebar').classList.toggle('open');
})();

// ---------- Globaalit tapahtumat ----------
function closeSidebarMobile() { $('#sidebar').classList.remove('open'); }

document.addEventListener('click', async (e) => {
  // Värivalitsin: valitse sävy ja tallenna se pickerin data-color-kenttään.
  const swatch = e.target.closest('.color-picker .swatch');
  if (swatch) {
    e.preventDefault();
    const picker = swatch.closest('.color-picker');
    picker.dataset.color = swatch.dataset.c || '';
    picker.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === swatch));
    return;
  }
  // Kuvakevalitsin: valitse SVG-kuvake ja tallenna token pickerin data-icon-kenttään.
  const icOpt = e.target.closest('.icon-picker .ic-opt');
  if (icOpt) {
    e.preventDefault();
    const picker = icOpt.closest('.icon-picker');
    picker.dataset.icon = icOpt.dataset.i || 'svg:folder';
    picker.querySelectorAll('.ic-opt').forEach((o) => o.classList.toggle('sel', o === icOpt));
    return;
  }
  const catMove = e.target.closest('[data-catmove]');
  if (catMove) {
    // Järjestys vaihdetaan vain sisarusten (saman yläkategorian) kesken.
    const cid = +catMove.dataset.catmove;
    const moved = categories.find((c) => c.id === cid);
    const siblingIds = categories.filter((c) => (c.parent_id || null) === (moved.parent_id || null)).map((c) => c.id);
    const ids = moveInList(siblingIds, cid, +catMove.dataset.dir);
    if (ids) { await Store.categories.reorder(ids); await loadCategories(); }
    return;
  }
  const page = e.target.closest('[data-page]');
  if (page) { location.hash = '#/sivu/' + page.dataset.page; return; }
  const cat = e.target.closest('[data-cat]');
  if (cat) { location.hash = '#/kohde/' + cat.dataset.cat; return; }
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const routes = { home: '#/', shiftlog: '#/paivakirja', contacts: '#/numerot', announcements: '#/muistutukset', terms: '#/termipankki', links: '#/linkit', users: '#/kayttajat', trash: '#/roskakori' };
    location.hash = routes[nav.dataset.nav] || '#/';
    return;
  }
});

// Kategorian lisäys: siisti pikalomake sivupalkkiin (ei selaimen prompt-ikkunaa).
// Piilota/näytä alakategoriat sivupalkissa (siistimpi näkymä; asetus muistetaan).
const toggleSubcatsBtn = $('#toggleSubcatsBtn');
if (toggleSubcatsBtn) toggleSubcatsBtn.onclick = () => {
  subcatsHidden = !subcatsHidden;
  try { localStorage.setItem('elama_hide_subcats', subcatsHidden ? '1' : '0'); } catch (_) {}
  renderSidebar();
};

$('#addCategoryBtn').onclick = () => {
  const existing = $('#catForm');
  if (existing) { existing.remove(); return; }
  const wrap = document.createElement('div');
  wrap.id = 'catForm'; wrap.className = 'cat-form';
  wrap.innerHTML = `<input id="newCatName" type="text" placeholder="Kategorian nimi" style="width:100%" />
    <label class="picker-label">Kuvake</label>
    ${iconSelectHtml('newCatIcon', 'svg:folder')}
    ${parentSelectHtml('newCatParent', null, null)}
    <label class="picker-label">Väri</label>
    ${colorPickerHtml('newCatColor', '')}
    <button class="btn small" id="newCatSave" style="width:100%">Lisää kategoria</button>`;
  $('#categoryList').before(wrap);
  const saveCat = async () => {
    const name = $('#newCatName').value.trim();
    if (!name) return toast('Anna nimi', true);
    try {
      const c = await Store.categories.create({ name, icon: $('#newCatIcon').dataset.icon, color: $('#newCatColor').dataset.color, parent_id: $('#newCatParent').value || null });
      wrap.remove(); await loadCategories();
      location.hash = '#/kohde/' + c.id; toast('Kategoria lisätty');
    } catch (err) { toast(err.message, true); }
  };
  $('#newCatSave').onclick = saveCat;
  $('#newCatName').onkeydown = (e) => { if (e.key === 'Enter') saveCat(); };
  $('#newCatName').focus();
};

$('#searchForm').onsubmit = (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (q) location.hash = '#/haku?q=' + encodeURIComponent(q);
};

// Live-haku: parhaat osumat pudotusvalikossa jo kirjoittaessa (nopea löytö).
(function initLiveSearch() {
  const input = $('#searchInput');
  const form = $('#searchForm');
  if (!input || !form) return;
  form.classList.add('has-drop');
  const drop = document.createElement('div');
  drop.id = 'searchDrop';
  drop.className = 'search-drop';
  drop.style.display = 'none';
  drop.setAttribute('role', 'listbox');
  drop.setAttribute('aria-label', 'Hakuehdotukset');
  form.appendChild(drop);
  // Saavutettavuus: yhdistelmäruutu (combobox) ruudunlukijoita varten.
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'searchDrop');
  input.setAttribute('aria-expanded', 'false');
  let items = [];   // näkyvät rivit järjestyksessä (näppäinnavigointia varten)
  let hi = -1;      // korostettu rivi
  let timer = null;
  let lastQ = '';

  const hide = () => {
    drop.style.display = 'none'; hi = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const highlight = () => drop.querySelectorAll('.sd-item').forEach((el, i) => {
    const on = i === hi;
    el.classList.toggle('hl', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) input.setAttribute('aria-activedescendant', el.id);
  });
  const go = (href) => { hide(); location.hash = href; };

  async function run(q) {
    if (q.length < 2) { hide(); return; }
    let r;
    try { r = await Store.search(q); } catch (_) { hide(); return; }
    if (q !== lastQ) return; // vanhentunut vastaus – ohitetaan
    const groups = [];
    if (r.pages.length) groups.push(['Ohjeet', r.pages.slice(0, 6).map((p) => ({
      href: '#/sivu/' + p.id, label: p.title, meta: p.category_name || 'Yleinen' }))]);
    if (r.terms.length) groups.push(['Termit', r.terms.slice(0, 3).map((t) => ({
      href: '#/haku?q=' + encodeURIComponent(t.term), label: t.term, meta: 'termi' }))]);
    if (r.files.length) groups.push(['Liitteet', r.files.slice(0, 3).map((f) => ({
      href: '#/sivu/' + f.page_id, label: f.original_name, meta: f.page_title || 'liite' }))]);
    items = [];
    if (!groups.length) {
      drop.innerHTML = '<div class="sd-empty">Ei osumia – paina Enter täydelle haulle</div>';
      drop.style.display = ''; hi = -1; input.setAttribute('aria-expanded', 'true'); return;
    }
    let html = '';
    for (const [name, rows] of groups) {
      html += `<div class="sd-grp">${esc(name)}</div>`;
      for (const row of rows) {
        const idx = items.length; items.push(row);
        html += `<a class="sd-item" id="sd-opt-${idx}" role="option" aria-selected="false" data-i="${idx}" href="${esc(row.href)}">
          <span class="sd-label">${esc(row.label)}</span><span class="sd-meta">${esc(row.meta)}</span></a>`;
      }
    }
    html += `<button type="button" class="sd-all">Näytä kaikki tulokset “${esc(q)}” ${icon('arrowRight','ic-sm')}</button>`;
    drop.innerHTML = html;
    drop.style.display = ''; hi = -1; input.setAttribute('aria-expanded', 'true');
    // mousedown (ei click), jotta navigointi ehtii ennen kentän blur-piilotusta
    drop.querySelectorAll('.sd-item').forEach((a) =>
      a.onmousedown = (e) => { e.preventDefault(); go(a.getAttribute('href')); });
    const allBtn = drop.querySelector('.sd-all');
    if (allBtn) allBtn.onmousedown = (e) => { e.preventDefault(); go('#/haku?q=' + encodeURIComponent(q)); };
  }

  input.addEventListener('input', () => {
    lastQ = input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(() => run(lastQ), 160);
  });
  input.addEventListener('keydown', (e) => {
    if (drop.style.display === 'none') return;
    const links = drop.querySelectorAll('.sd-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, links.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, -1); highlight(); }
    else if (e.key === 'Enter') { if (hi >= 0 && items[hi]) { e.preventDefault(); go(items[hi].href); } }
    else if (e.key === 'Escape') { hide(); }
  });
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('focus', () => { const q = input.value.trim(); if (q.length >= 2) run(q); });
})();

$('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');

// Injektoi kiinteät SVG-ikonit chromeen (navigaatio, valikko, lisää-nappi).
(function initChromeIcons() {
  document.querySelectorAll('.nav-link[data-icon]').forEach((b) =>
    b.insertAdjacentHTML('afterbegin', icon(b.dataset.icon)));
  const menu = $('#menuToggle'); if (menu) menu.innerHTML = icon('menu', 'ic-lg');
  const addCat = $('#addCategoryBtn'); if (addCat) addCat.innerHTML = icon('add');
  // Myös alakategorioiden piilotusnappi heti: muuten se jäisi raa'aksi ▾-merkiksi
  // niissä tilanteissa, joissa sivupalkkia ei renderöidä (esim. kirjautumisruutu).
  const tSub = $('#toggleSubcatsBtn'); if (tSub) tSub.innerHTML = icon('chevDown');
})();

// ---------- Yläpalkin kello: päivämäärä, kellonaika ja viikkonumero ----------
// Vuorotyössä viikkonumero on arjen kieltä ("vaihdetaan vk 31 alusta"), ja
// kellonaika halutaan samasta paikasta kuin kirjaukset tehdään.
// ISO 8601 -viikkonumero: viikko alkaa maanantaista ja vuoden 1. viikko on se,
// johon osuu ensimmäinen torstai. Siksi torstain kautta laskeminen.
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;            // sunnuntai 0 -> 7
  t.setUTCDate(t.getUTCDate() + 4 - day);    // saman viikon torstai
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

(function initClock() {
  const el = $('#clock');
  if (!el) return;
  const paint = () => {
    const now = new Date();
    const pvm = now.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const klo = now.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<span class="clock-time">${esc(klo)}</span>`
      + `<span class="clock-date">${esc(pvm)}</span>`
      + `<span class="clock-week">vko ${isoWeek(now)}</span>`;
    el.setAttribute('datetime', now.toISOString());
  };
  paint();
  // Päivitys minuutin vaihtuessa: ensin kohdistus tasaminuuttiin, sitten
  // kerran minuutissa – näin kello ei näytä minuuttia jäljessä.
  setTimeout(() => { paint(); setInterval(paint, 60000); }, (60 - new Date().getSeconds()) * 1000);
})();

// Teema: tallennettu valinta > käyttöjärjestelmän asetus.
function applyTheme() {
  let saved = null;
  try { saved = localStorage.getItem('elama_theme'); } catch (_) {}
  const dark = saved ? saved === 'dark'
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('#themeToggle');
  if (btn) { btn.innerHTML = icon(dark ? 'sun' : 'moon'); btn.title = dark ? 'Vaalea tila' : 'Tumma tila'; }
}
const themeToggle = $('#themeToggle');
if (themeToggle) themeToggle.onclick = () => {
  const nowDark = document.documentElement.dataset.theme === 'dark';
  try { localStorage.setItem('elama_theme', nowDark ? 'light' : 'dark'); } catch (_) {}
  applyTheme();
};
applyTheme();
// Seuraa käyttöjärjestelmän teemanvaihtoa, jos käyttäjä ei ole valinnut itse.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    let saved = null;
    try { saved = localStorage.getItem('elama_theme'); } catch (_) {}
    if (!saved) applyTheme();
  });
}

// Pikanäppäin: / vie hakukenttään.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault(); $('#searchInput').focus();
  }
});

// Takaisin ylös -nappi pitkillä sivuilla.
const backTop = document.createElement('button');
backTop.id = 'backTop'; backTop.title = 'Takaisin ylös'; backTop.innerHTML = icon('chevUp');
document.body.appendChild(backTop);
backTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
window.addEventListener('scroll', () => backTop.classList.toggle('show', window.scrollY > 600), { passive: true });

// Offline-versio: yksi HTML-tiedosto puhelimeen, toimii ilman verkkoa.
const offlineBtn = $('#offlineBtn');
if (offlineBtn) offlineBtn.onclick = async () => {
  if (Store.mode === 'server') { window.location.href = '/offline?download=1'; return; }
  // Sandbox: koostetaan tiedosto selaimen datasta.
  toast('Kootaan offline-versiota…');
  try {
    const [cats, pageList, terms, contacts, anns, links] = await Promise.all([
      Store.categories.list(), Store.pages.list(), Store.terms.list(),
      Store.contacts.list(), Store.announcements.list(), Store.links.list(),
    ]);
    const pages = [];
    for (const p of pageList) pages.push(await Store.pages.get(p.id));
    const html = buildOfflineHtml({
      generatedAt: new Date().toISOString(),
      categories: cats, pages, terms, contacts, announcements: anns, links,
    });
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'elama-offline.html';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Offline-versio ladattu');
  } catch (err) { toast(err.message, true); }
};

const authorInput = $('#authorInput');
authorInput.value = author.get();
authorInput.oninput = () => author.set(authorInput.value);

window.addEventListener('hashchange', router);

// ---------- Käynnistys ----------
(async function init() {
  try {
    if (Store.auth) {
      const st = await Store.auth.status();
      if (st.setupRequired) return renderSetup();
      if (!st.user) return renderLogin();
      applyUser(st.user);
    }
    await loadCategories();
    router();
  } catch (e) {
    content.innerHTML = `<div class="card empty">Sovelluksen käynnistys epäonnistui: ${esc(e.message)}.<br/>
      Kokeile toista selainta (Chrome/Edge/Firefox) tai tyhjennä sivuston selaintiedot.</div>`;
  }
})();
