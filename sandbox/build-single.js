// Kokoaa sandboxin YHDEKSI itsenäiseksi HTML-tiedostoksi, jonka voi
// tuplaklikata auki ilman palvelinta ja ilman muita tiedostoja.
// Lähteet pysyvät yhdessä paikassa (public/styles.css, public/app.js,
// sandbox/store-local.js) – tämä vain niputtaa ne. Aja tyylimuutosten jälkeen:
//   node sandbox/build-single.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
// Välilehden kuvake luetaan tiedostosta, jottei upotettu kopio jää jälkeen.
const favicon = fs.readFileSync(path.join(root, 'public', 'favicon.svg')).toString('base64');
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
const kotiJs = fs.readFileSync(path.join(root, 'public', 'koti.js'), 'utf8');
const kotiCss = fs.readFileSync(path.join(root, 'public', 'koti.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="fi" data-design="2a">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Oma dashboard (Sandbox)</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon}" />
  <script>
    /* Teema ennen renderöintiä, ettei sivu välähdä väärällä värillä */
    (function(){try{var t=localStorage.getItem('elama_theme');
      if(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)t='dark';
      document.documentElement.dataset.theme=t==='dark'?'dark':'light';}catch(e){}})();
  </script>
  <style>
${css}
${design2a}
${kotiCss}
    .sandbox-badge { background:#1c2430; color:#fff; font-size:11px; font-weight:700;
      padding:2px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:.04em; }
  </style>
</head>
<body>
  <header class="topbar">
    <button id="menuToggle" class="icon-btn" title="Valikko" aria-label="Valikko">☰</button>
    <div class="brand" data-nav="home">
      <span class="brand-mark"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 30.5 32 13l19 17.5M18.5 27v24h27V27" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="29.6" cy="43" rx="5.2" ry="3.9" transform="rotate(-22 29.6 43)" fill="currentColor"/><path d="M34.3 42V28.5c4.2.8 6.4 3.6 5.6 7.6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
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
        <button class="nav-link" data-nav="shopping" data-icon="cart"><span>Kauppalista</span></button>
        <button class="nav-link" data-nav="pantry" data-icon="box"><span>Varmuusvarasto</span></button>
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
${kotiJs}
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
