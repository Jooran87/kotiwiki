// Kokoaa sandboxin YHDEKSI itsenäiseksi HTML-tiedostoksi, jonka voi
// tuplaklikata auki ilman palvelinta ja ilman muita tiedostoja.
// Lähteet pysyvät yhdessä paikassa (public/styles.css, public/app.js,
// sandbox/store-local.js) – tämä vain niputtaa ne. Aja tyylimuutosten jälkeen:
//   node sandbox/build-single.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
// Designehdotus 2a: fonttien url() korvataan base64-datalla, jotta yhden
// tiedoston sandbox toimii ilman fonts-kansiota ja ilman verkkoa.
const design2a = fs.readFileSync(path.join(root, 'public', 'design2a.css'), 'utf8')
  .replace(/url\('fonts\/([^']+)'\)/g, (m, file) => {
    const buf = fs.readFileSync(path.join(root, 'public', 'fonts', file));
    return `url(data:font/woff2;base64,${buf.toString('base64')})`;
  });
const offlineTpl = fs.readFileSync(path.join(root, 'public', 'offline-template.js'), 'utf8');
const storeLocal = fs.readFileSync(path.join(__dirname, 'store-local.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');
const cardsJs = fs.readFileSync(path.join(root, 'public', 'cards.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="fi" data-design="2a">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Oma dashboard (Sandbox)</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiNlYTZhMWUiLz48dGV4dCB4PSIzMiIgeT0iNDUiIGZvbnQtZmFtaWx5PSJBcmlhbCxIZWx2ZXRpY2Esc2Fucy1zZXJpZiIgZm9udC1zaXplPSIzOCIgZm9udC13ZWlnaHQ9IjgwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+UDwvdGV4dD48L3N2Zz4=" />
  <script>
    /* Teema ennen renderöintiä, ettei sivu välähdä väärällä värillä */
    (function(){try{var t=localStorage.getItem('elama_theme');
      if(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)t='dark';
      document.documentElement.dataset.theme=t==='dark'?'dark':'light';}catch(e){}})();
  </script>
  <style>
${css}
${design2a}
    .sandbox-badge { background:#1c2430; color:#fff; font-size:11px; font-weight:700;
      padding:2px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:.04em; }
  </style>
</head>
<body>
  <header class="topbar">
    <button id="menuToggle" class="icon-btn" title="Valikko" aria-label="Valikko">☰</button>
    <div class="brand" data-nav="home">
      <span class="brand-mark">O</span>
      <span class="brand-text"><strong>Oma</strong><small>DASHBOARD · OHJEET</small></span>
    </div>
    <span class="sandbox-badge" title="Demo: data tallentuu vain tähän selaimeen">Sandbox</span>
    <form id="searchForm" class="search">
      <input id="searchInput" type="search" placeholder="Hae ohjeista, huomioista ja tiedostoista…" autocomplete="off" />
    </form>
    <div id="clock" class="clock" title="Päivämäärä, kello ja viikkonumero"></div>
  <button id="themeToggle" class="icon-btn" title="Tumma tila">🌙</button>
    <span id="userChip" class="user-chip" style="display:none"></span>
    <button id="logoutBtn" class="btn small secondary" style="display:none">Kirjaudu ulos</button>
    <div class="user"><label>Nimesi:</label><input id="authorInput" type="text" placeholder="Etunimi" /></div>
  </header>
  <div class="layout">
    <aside id="sidebar" class="sidebar">
      <nav>
        <button class="nav-link" data-nav="home" data-icon="home"><span>Etusivu</span></button>
        <button class="nav-link" data-nav="announcements" data-icon="announce"><span>Muistutukset</span></button>
        <button class="nav-link" data-nav="shiftlog" data-icon="note"><span>Päiväkirja</span></button>
        <button class="nav-link" data-nav="contacts" data-icon="contact"><span>Tärkeät numerot</span></button>
        <button class="nav-link" data-nav="terms" data-icon="terms"><span>Termipankki</span></button>
        <button class="nav-link" data-nav="links" data-icon="link"><span>Linkit</span></button>
        <button class="nav-link" data-nav="trash" data-icon="trash"><span>Roskakori</span></button>
        <button class="nav-link" data-nav="users" id="usersNav" data-icon="users" style="display:none"><span>Käyttäjät</span></button>
        <button class="nav-link" id="offlineBtn" data-icon="offline" title="Lataa puhelimeen – toimii ilman verkkoa"><span>Offline-versio</span></button>
      </nav>
      <div class="sidebar-section">
        <div class="sidebar-title"><span>Ohjeet</span>
          <span class="sidebar-title-actions">
            <button id="toggleSubcatsBtn" class="icon-btn small" title="Piilota alakategoriat">▾</button>
            <button id="addCategoryBtn" class="icon-btn small" title="Lisää kategoria">＋</button></span></div>
        <ul id="categoryList" class="category-list"></ul>
      </div>
    </aside>
    <main id="content" class="content">
      <div class="card empty" id="jsNotice">
        Ladataan…<br/><br/>
        <strong>Jos tämä teksti ei katoa</strong>, avaamasi esikatselu ei suorita
        JavaScriptiä (näin käy esim. iPhonen Tiedostot-sovelluksen esikatselussa).<br/>
        👉 Avaa tämä tiedosto tietokoneen selaimessa (Chrome, Edge, Firefox).<br/>
        📱 Puhelimeen tarkoitettu versio on <strong>elama-offline.html</strong> –
        sen sisältö näkyy myös esikatselussa.
      </div>
    </main>
    <aside id="rail" class="rail"></aside>
  </div>
  <div id="toast" class="toast"></div>
  <script>
${offlineTpl}
  </script>
  <script>
${storeLocal}
  </script>
  <script>
${dashboard}
  </script>
  <script>
${cardsJs}
  </script>
  <script>
${app}
  </script>
</body>
</html>
`;

const out = path.join(__dirname, 'elama-sandbox.html');
fs.writeFileSync(out, html);
console.log('Koottu:', out, '(' + (html.length / 1024).toFixed(0) + ' kt)');
