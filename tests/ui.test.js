// Selaintestit sandbox-versiolle (Chromium + playwright-core).
// Kokoaa ensin yhden tiedoston sandboxin ja ajaa sen selaimessa.
// Jos Chromiumia ei löydy, testit OHITETAAN (exit 0) – rajapintatestit
// kattavat silloin logiikan. Selaimen polun voi antaa: CHROMIUM_PATH=...
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  try {
    const { chromium } = require('playwright-core');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (_) {}
  const guesses = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return guesses.find((g) => fs.existsSync(g)) || null;
}

// Kelvollinen PNG (200x60) testikuvaksi. 1x1-lorem ei riitä: sillä ei voi
// todeta latautuuko kuva oikeasti, ja rikkinäinen PNG näyttää samalta kuin bugi.
function makePng() {
  const zlib = require('zlib');
  const w = 200, h = 60;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const v = ((x / 10 | 0) + (y / 10 | 0)) % 2 ? 255 : 40;
      row[1 + x * 3] = v; row[2 + x * 3] = v; row[3 + x * 3] = v;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  // crc32 ilman zlib.crc32-tukea (Node < 20.12)
  function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' – ' + extra : '')); }
};

// Lataa kategoriat uudelleen (ohjemäärät) ja avaa kategorian sivu.
async function loadCatsFresh(page, catId) {
  await page.evaluate(async (c) => { await loadCategories(); location.hash = '#/kohde/' + c; }, catId);
  await page.waitForTimeout(600);
}

async function main() {
  const exe = findChromium();
  if (!exe) {
    console.log('OHITETAAN selaintestit: Chromiumia ei löytynyt (aseta CHROMIUM_PATH).');
    process.exit(0);
  }
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch (_) {
    console.log('OHITETAAN selaintestit: playwright-core puuttuu (npm install).');
    process.exit(0);
  }

  execSync('node sandbox/build-single.js', { cwd: ROOT, stdio: 'ignore' });
  const fileUrl = 'file://' + path.join(ROOT, 'sandbox', 'elama-sandbox.html');

  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Dialogien käsittely on ohjattavissa testeittäin (osa testeistä haluaa
  // nimenomaan perua vahvistuksen). dialogCount kertoo kysyttiinkö mitään.
  let dialogAction = 'accept';
  let dialogCount = 0;
  page.on('dialog', (d) => { dialogCount++; return dialogAction === 'dismiss' ? d.dismiss() : d.accept(); });

  try {
    await page.goto(fileUrl);
    await page.evaluate(() => {
      localStorage.clear();
      return new Promise((r) => {
        const d = indexedDB.deleteDatabase('elama_sandbox_files');
        d.onsuccess = r; d.onerror = r; d.onblocked = r;
      });
    });
    await page.reload();
    await page.waitForTimeout(900);

    // Peruskäynnistys
    const cats = await page.$$eval('#categoryList .cat-btn:not(.subcat) .cat-name', (els) => els.map((e) => e.textContent));
    ok('sovellus käynnistyy, pääkategoriat näkyvät', cats.length === 5, JSON.stringify(cats));
    ok('kategoriakortit etusivulla (vain pääkategoriat)',
      (await page.$$('.d2-cat:not(.all)')).length === 5);

    // Alakategoriat: sisennetyt alakategoriat sivupalkissa (myös useampi taso)
    const subs = await page.$$eval('#categoryList .cat-btn.subcat .cat-name', (els) => els.map((e) => e.textContent.trim()));
    ok('alakategoriat näkyvät sivupalkissa', subs.length >= 2 && subs.some((s) => s.includes('Laitteet ja huolto')), JSON.stringify(subs));
    ok('kolmas taso näkyy sivupalkissa (Keittiö)', subs.some((s) => s.includes('Keittiö')), JSON.stringify(subs));

    // XSS: hyökkäävä otsikko näkyy tekstinä eikä suoritu
    await page.fill('#authorInput', 'Testaaja');
    await page.click('#categoryList >> text=Talous');
    await page.waitForTimeout(300);
    await page.click('#newPageBtn');
    await page.waitForTimeout(300);
    await page.fill('#titleInput', '<img src=x onerror=alert(1)> XSS');
    await page.fill('#contentInput', '# Otsikko\n\n**lihava**');
    await page.click('#saveBtn');
    await page.waitForTimeout(600);
    ok('XSS-otsikko renderöityy tekstinä', (await page.$eval('h2', (e) => e.textContent)).includes('<img'));
    ok('ei injektoituja elementtejä', (await page.$$('#content img')).length === 0);

    // Erikoismerkit haussa
    for (const q of ['(test', 'a+b', '**']) {
      await page.fill('#searchInput', q);
      await page.press('#searchInput', 'Enter');
      await page.waitForTimeout(200);
    }
    ok('erikoismerkkihaut eivät kaada', errors.length === 0, errors.join(','));

    // Poistetut kohteet käsitellään siististi
    const base = page.url().split('#')[0];
    await page.goto(base + '#/sivu/99999'); await page.waitForTimeout(400);
    ok('poistettu sivu -> virheviesti', (await page.$eval('#content', (e) => e.textContent)).includes('Sivua ei löydy'));
    await page.goto(base + '#/kohde/99999'); await page.waitForTimeout(400);
    ok('poistettu kategoria -> viesti', (await page.$eval('#content', (e) => e.textContent)).includes('Kategoriaa ei löydy'));

    // Navigaatiosweep
    for (const r of ['#/', '#/muistutukset', '#/paivakirja', '#/termipankki', '#/linkit', '#/haku?q=varaaja']) {
      await page.goto(base + r); await page.waitForTimeout(200);
    }
    ok('navigaatiosweep ilman JS-virheitä', errors.length === 0, errors.join(','));

    // Teema vaihtuu ja säilyy
    await page.goto(base + '#/'); await page.waitForTimeout(400);
    await page.click('#themeToggle'); await page.waitForTimeout(200);
    ok('tumma tila kytkeytyy', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
    await page.reload(); await page.waitForTimeout(700);
    ok('teema säilyy uudelleenlatauksessa', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));

    // Esikatselu muokkauksessa
    await page.click('#categoryList >> text=Terveys'); await page.waitForTimeout(300);
    await page.click('text=Kotiapteekin tarkistus'); await page.waitForTimeout(400);
    await page.click('#editBtn'); await page.waitForTimeout(300);
    await page.click('#previewToggle'); await page.waitForTimeout(200);
    ok('Markdown-esikatselu renderöi', (await page.$eval('#previewBox h1', (e) => e.textContent)).includes('Kotiapteekin'));

    // Kuvan lisäys artikkeliin: 📷-nappi -> liite:ID tekstiin -> renderöityy img-elementiksi
    await page.goto(base + '#/'); await page.waitForTimeout(400);
    await page.click('#categoryList >> text=Ruoka ja reseptit'); await page.waitForTimeout(300);
    await page.click('text=Perusleipä'); await page.waitForTimeout(400);
    await page.click('#editBtn'); await page.waitForTimeout(300);
    const pngBuf = makePng();
    await page.setInputFiles('#imgFileInput', { name: 'ruutukaappaus.png', mimeType: 'image/png', buffer: pngBuf });
    await page.waitForTimeout(600);
    const taValue = await page.$eval('#contentInput', (e) => e.value);
    ok('kuvaviittaus lisättiin tekstiin', taValue.includes('![kuva](liite:'));
    await page.click('#saveBtn'); await page.waitForTimeout(600);
    await page.waitForTimeout(400);
    const imgOk = await page.$eval('.doc img.doc-img',
      (e) => ({ src: e.getAttribute('src') || '', ladattu: e.complete && e.naturalWidth > 0 })).catch(() => null);
    ok('kuva renderöityy artikkelissa', !!imgOk && imgOk.src.indexOf('blob:') === 0, imgOk && imgOk.src);
    // Tärkeä ero: src voi olla oikea vaikka kuva ei lataudu (rikkinäinen liite).
    ok('artikkelin kuva myös latautuu', !!imgOk && imgOk.ladattu, JSON.stringify(imgOk));

    // Alakategoriat: Koti-näkymässä alakategoriakortit, ja alakategorian
    // murupolku näyttää yläkategorian. Uuden alakategorian luonti UI:sta.
    await page.goto(base + '#/'); await page.waitForTimeout(400);
    await page.click('#categoryList >> text=Koti'); await page.waitForTimeout(400);
    ok('yläkategoriassa näkyy alakategoriakortteja', (await page.$$('.cat-card')).length >= 2);
    await page.click('.cat-card >> text=Laitteet ja huolto'); await page.waitForTimeout(400);
    const crumbTxt = await page.$eval('.crumbs', (e) => e.textContent);
    ok('alakategorian murupolku näyttää yläkategorian', crumbTxt.includes('Koti') && crumbTxt.includes('Laitteet ja huolto'), crumbTxt);
    // Luo uusi alakategoria Kodin alle napista
    await page.goto(base + '#/'); await page.waitForTimeout(300);
    await page.click('#categoryList >> text=Koti'); await page.waitForTimeout(400);
    await page.click('#newSubBtn'); await page.waitForTimeout(200);
    await page.fill('#subCatName', 'Autotalli – Testi');
    await page.click('#subCatSave'); await page.waitForTimeout(500);
    const crumb2 = await page.$eval('.crumbs', (e) => e.textContent);
    ok('uusi alakategoria luotu ja avattu', crumb2.includes('Koti') && crumb2.includes('Autotalli'), crumb2);
    ok('uusi alakategoria näkyy sivupalkissa',
      (await page.$$eval('#categoryList .cat-btn.subcat .cat-name', (els) => els.map((e) => e.textContent))).some((t) => t.includes('Autotalli')));
    // Kolmas taso: luo alakategoria juuri luodun alakategorian (Autotalli) alle
    await page.click('#newSubBtn'); await page.waitForTimeout(200);
    await page.fill('#subCatName', 'Työkalut');
    await page.click('#subCatSave'); await page.waitForTimeout(500);
    const crumb3 = await page.$eval('.crumbs', (e) => e.textContent);
    ok('kolmannen tason murupolku (Koti › Autotalli › Työkalut)',
      crumb3.includes('Koti') && crumb3.includes('Autotalli') && crumb3.includes('Työkalut'), crumb3);

    // Alakategorioiden piilotusnappi: piilottaa alakategoriat + näyttää merkin, muistetaan
    const subsBefore = (await page.$$('#categoryList .cat-btn.subcat')).length;
    await page.click('#toggleSubcatsBtn'); await page.waitForTimeout(200);
    ok('piilotusnappi piilottaa alakategoriat', (await page.$$('#categoryList .cat-btn.subcat')).length === 0 && subsBefore > 0);
    ok('piilotettuna näkyy määrämerkki', (await page.$$('.subs-chip')).length >= 1);
    await page.reload(); await page.waitForTimeout(900);
    ok('piilotusvalinta muistetaan latauksessa', (await page.$$('#categoryList .cat-btn.subcat')).length === 0);
    await page.click('#toggleSubcatsBtn'); await page.waitForTimeout(200);
    ok('napista alakategoriat takaisin näkyviin', (await page.$$('#categoryList .cat-btn.subcat')).length === subsBefore);

    // Väriaksentit: seed-kategorioilla on värillinen reuna sivupalkissa ja korteissa
    await page.goto(base + '#/'); await page.waitForTimeout(400);
    ok('kategorioilla väriaksentti sivupalkissa', (await page.$$('#categoryList .cat-btn.has-accent')).length >= 5);
    ok('väriaksentti korteissa etusivulla', (await page.$$eval('.d2-cat:not(.all)',
      (els) => els.filter((e) => /^#[0-9a-f]{6}$/i.test(
        (e.getAttribute('style') || '').replace(/.*--cat-accent:\s*/, '').trim())).length)) >= 5);
    // Kategoriakuvakkeet ovat siistejä SVG-viivakuvakkeita (ei emojia)
    ok('kategoriakuvakkeet ovat SVG sivupalkissa', (await page.$$('#categoryList .cat-ico svg.ic')).length >= 5);
    await page.goto(base + '#/kohde/1'); await page.waitForTimeout(500);
    ok('kategoriakuvakkeet ovat SVG alakategoriakorteissa',
      (await page.$$('.cat-card .cc-ico svg.ic')).length >= 2);
    await page.goto(base + '#/'); await page.waitForTimeout(400);
    // Kuvakevalitsimella luotu kategoria saa valitun SVG-kuvakkeen
    await page.click('#addCategoryBtn'); await page.waitForTimeout(200);
    await page.fill('#newCatName', 'Turvakategoria');
    await page.click('#newCatIcon .ic-opt[data-i="svg:shield"]'); await page.waitForTimeout(150);
    await page.click('#newCatSave'); await page.waitForTimeout(500);
    ok('uuden kategorian kuvake renderöityy SVG:nä',
      (await page.$$('#categoryList .cat-btn .cat-ico svg.ic')).length >= 6);

    // Live-haku: pudotusvalikko näyttää osumat ja rivin klikkaus vie ohjeeseen
    await page.fill('#searchInput', 'suodat'); await page.waitForTimeout(400);
    ok('live-haun pudotus näkyy', await page.isVisible('#searchDrop'));
    const sdItems = await page.$$eval('#searchDrop .sd-item .sd-label', (els) => els.map((e) => e.textContent));
    ok('live-haku löytää ohjeita', sdItems.some((t) => /suodat/i.test(t)), JSON.stringify(sdItems));
    // Saavutettavuus: combobox-roolit ja aria-activedescendant nuolinäppäimellä
    ok('haku on combobox ja auki', await page.getAttribute('#searchInput', 'role') === 'combobox'
      && await page.getAttribute('#searchInput', 'aria-expanded') === 'true');
    ok('pudotus on listbox ja rivit optioita', await page.getAttribute('#searchDrop', 'role') === 'listbox'
      && (await page.$$('#searchDrop .sd-item[role="option"]')).length >= 1);
    await page.focus('#searchInput'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100);
    ok('aria-activedescendant seuraa valintaa', /sd-opt-\d+/.test(await page.getAttribute('#searchInput', 'aria-activedescendant') || ''));
    await page.click('#searchDrop .sd-item'); await page.waitForTimeout(400);
    ok('live-haun osumasta avautuu sivu', /#\/sivu\//.test(page.url()), page.url());

    // Saavutettavuus: näppäimistöfokus näkyy (focus-visible outline)
    await page.goto(base + '#/'); await page.waitForTimeout(300);
    await page.keyboard.press('Tab'); await page.waitForTimeout(100);
    const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
    ok('näppäimistöfokus näkyy reunuksena', focusOutline === '2px', focusOutline);

    // Sisällysluettelo: monta otsikkoa -> TOC-kortti, jonka linkki vierittää
    await page.goto(base + '#/'); await page.waitForTimeout(300);
    await page.click('#categoryList >> text=Laitteet ja huolto'); await page.waitForTimeout(300);
    await page.click('text=Lämminvesivaraajan nollaus'); await page.waitForTimeout(500);
    ok('sisällysluettelo näkyy pitkässä ohjeessa', await page.isVisible('.toc-card'));
    const tocLinks = await page.$$eval('.toc-card a', (els) => els.map((e) => e.textContent.trim()));
    ok('sisällysluettelossa otsikot', tocLinks.length >= 3 && tocLinks.some((t) => t.includes('Tarkista sulake')), JSON.stringify(tocLinks));
    ok('otsikoilla ankkuri-id', (await page.$$('.doc .doc-head[id]')).length >= 3);

    // Kuvagalleria + lightbox: Perusleipä-ohjeeseen ladattu kuva
    await page.goto(base + '#/'); await page.waitForTimeout(300);
    await page.click('#categoryList >> text=Ruoka ja reseptit'); await page.waitForTimeout(300);
    await page.click('text=Perusleipä'); await page.waitForTimeout(500);
    ok('kuvaliite näkyy galleriana', (await page.$$('.att-thumb')).length >= 1);
    await page.click('.att-thumb'); await page.waitForTimeout(400);
    ok('lightbox avautuu kuvasta', await page.isVisible('.lightbox.open'));
    ok('lightboxissa on kuva', (await page.$$('.lightbox .lb-img')).length === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok('lightbox sulkeutuu Esc:llä', !(await page.isVisible('.lightbox.open')));

    // Tärkeät numerot: oma sivu navigaatiossa + etusivun nosto oikeaan kaistaan
    await page.goto(base + '#/'); await page.waitForTimeout(400);
    ok('hätänumero 112 korostettuna etusivulla',
      (await page.$eval('.d2-num.emergency .d2-numtel', (e) => e.textContent)).indexOf('112') >= 0);
    ok('etusivulla näkyy myös muita numeroita', (await page.$$('.d2-num:not(.emergency)')).length >= 3);
    await page.click('.nav-link[data-nav="contacts"]'); await page.waitForTimeout(400);
    const numMaara = Number((await page.$eval('#content', (e) => e.textContent))
      .match(/Yhteystiedot \((\d+)\)/)[1]);
    ok('Tärkeät numerot -sivu avautuu navigaatiosta', numMaara >= 3, 'numeroita ' + numMaara);
    await page.click('#addContactBtn'); await page.waitForTimeout(200);
    await page.fill('#cfLabel', 'Testinumero Oy');
    await page.fill('#cfPhone', '040 999 8877');
    await page.click('#cfSave'); await page.waitForTimeout(500);
    const cTxt = await page.$eval('#content', (e) => e.textContent);
    ok('yhteystieto lisätään numerosivulta',
      cTxt.includes('Testinumero Oy') && cTxt.includes(`Yhteystiedot (${numMaara + 1})`));

    // Dashboardin kortit: järjestys ja sisältö tulevat korttirekisteristä.
    await page.goto(base + '#/'); await page.waitForTimeout(600);
    const korttiNimet = await page.$$eval('.dash-card .d2-cardhead h3', (els) => els.map((e) => e.textContent.trim()));
    ok('dashboard renderöi kortit', korttiNimet.length >= 6, JSON.stringify(korttiNimet));
    ok('Päivä-kortti ensimmäisenä', korttiNimet[0] === 'Päivä', JSON.stringify(korttiNimet));
    ok('Muistutukset-kortti näkyy', korttiNimet.includes('Muistutukset'));
    ok('Ohjeet-kortti näkyy', korttiNimet.includes('Ohjeet'));
    ok('yksikään kortti ei jäänyt virheeseen', (await page.$$('.dash-err')).length === 0);
    ok('yksikään kortti ei jäänyt luurangoksi', (await page.$$('.dash-skel')).length === 0);
    ok('Päivä-kortti näyttää auringon ajat molemmille paikkakunnille',
      (await page.$$('.dash-row')).length === 2);
    ok('kiinnitetty muistutus näkyy etusivulla',
      (await page.$eval('.dash-item', (e) => e.textContent)).includes('katsastus'));
    // Muistiinpano etusivun kortista
    await page.fill('#dashNoteText', 'Pikamerkintä etusivulta');
    await page.click('#dashNoteAdd'); await page.waitForTimeout(600);
    ok('muistiinpano tallentuu etusivulta',
      (await page.$eval('#content', (e) => e.textContent)).includes('Pikamerkintä etusivulta'));
    // Kortin voi piilottaa ja se muistetaan
    const ennenPiilotusta = (await page.$$('.dash-card')).length;
    await page.click('.dash-card[data-card="viimeksi"] .dash-hide'); await page.waitForTimeout(600);
    ok('kortin piilotus vähentää kortteja', (await page.$$('.dash-card')).length === ennenPiilotusta - 1);
    await page.reload(); await page.waitForTimeout(1200);
    ok('piilotus muistetaan uudelleenlatauksessa',
      (await page.$$('.dash-card[data-card="viimeksi"]')).length === 0);
    await page.evaluate(() => { Dashboard.show('viimeksi'); location.hash = '#/'; });
    await page.reload(); await page.waitForTimeout(1200);
    ok('piilotetun kortin saa takaisin',
      (await page.$$('.dash-card[data-card="viimeksi"]')).length === 1);
    // Ulkoiset lähteet: paikanpitäjä kertoo rehellisesti ettei dataa ole
    ok('kytkemättömät lähteet merkitty selvästi', (await page.$$('.dash-todo')).length >= 3);

    // Oikean reunan muistiinpanopalsta leveällä näytöllä (>= 1400 px)
    const wide = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    wide.on('pageerror', (e) => errors.push('wide: ' + e.message));
    await wide.goto(fileUrl + '#/termipankki'); await wide.waitForTimeout(900);
    const railText = await wide.$eval('#rail', (e) => e.textContent).catch(() => '');
    ok('muistiinpanopalsta näkyy leveällä näytöllä', railText.includes('Muistiinpanot'));
    const rs = await wide.$eval('.rail-scroll', (el) => ({ sh: el.scrollHeight, ch: el.clientHeight, n: el.querySelectorAll('.rail-note').length }));
    ok('reunapalstassa näkyy merkintöjä', rs.n >= 3, JSON.stringify(rs));
    await wide.fill('#railNoteText', 'Merkintä reunapalstasta');
    await wide.click('#railNoteAdd'); await wide.waitForTimeout(500);
    ok('merkintä tallentuu reunapalstasta',
      (await wide.$eval('#rail', (e) => e.textContent)).includes('Merkintä reunapalstasta'));
    await wide.goto(fileUrl + '#/'); await wide.waitForTimeout(500);
    ok('etusivulla reunapalsta on tyhjä (ei tuplasisältöä)',
      (await wide.$eval('#rail', (e) => e.innerHTML.trim())) === '');
    await wide.close();

    // Puhelimen alapalkki: näkyy kapealla näytöllä ja navigoi
    const mob = await browser.newPage({ viewport: { width: 390, height: 800 } });
    mob.on('pageerror', (e) => errors.push('mob: ' + e.message));
    await mob.goto(fileUrl); await mob.waitForTimeout(800);
    ok('alapalkki näkyy puhelimessa', await mob.isVisible('#bottomNav'));
    ok('alapalkissa 5 kohtaa', (await mob.$$('.bn-item')).length === 5);
    await mob.click('.bn-item[data-bnav="shiftlog"]'); await mob.waitForTimeout(400);
    ok('alapalkista siirrytään päiväkirjaan', /#\/paivakirja/.test(mob.url()), mob.url());
    ok('alapalkin aktiivinen kohta korostuu',
      (await mob.$$('.bn-item.active[data-bnav="shiftlog"]')).length === 1);
    await mob.close();

    // ===== Regressiotestit korjatuille bugeille =====

    // 1) Tallentamattomat muutokset: varoitus myös wikin sisäisestä siirtymisestä
    //    + keskeneräinen teksti jää luonnokseksi talteen.
    await page.evaluate(() => { location.hash = '#/uusi'; });
    await page.waitForTimeout(500);
    await page.fill('#titleInput', 'Luonnostesti');
    await page.fill('#contentInput', 'KESKENERÄINEN');
    await page.waitForTimeout(250);
    dialogAction = 'dismiss'; dialogCount = 0;
    await page.click('.cat-btn'); await page.waitForTimeout(500);
    ok('tallentamattomista muutoksista varoitetaan wikin sisällä', dialogCount === 1, 'dialogeja=' + dialogCount);
    ok('peruutus jättää muokkausnäkymän auki', await page.isVisible('#contentInput'));
    dialogAction = 'accept';
    await page.click('.cat-btn'); await page.waitForTimeout(600);
    ok('hyväksyntä päästää pois muokkauksesta', (await page.$('#contentInput')) === null);
    await page.evaluate(() => { location.hash = '#/uusi'; });
    await page.waitForTimeout(500);
    ok('tallentamaton luonnos tarjotaan palautettavaksi', await page.isVisible('#draftNote'));
    await page.click('#draftRestore'); await page.waitForTimeout(300);
    ok('luonnos palautuu sisällöllään',
      (await page.$eval('#contentInput', (e) => e.value)) === 'KESKENERÄINEN');
    await page.click('#draftDiscard').catch(() => {});
    await page.evaluate(() => {
      Object.keys(localStorage).filter((k) => k.indexOf('elama_draft_') === 0)
        .forEach((k) => localStorage.removeItem(k));
      location.hash = '#/';
    });
    await page.waitForTimeout(400);

    // 2) Lukijaroolilta piilotetaan KAIKKI kirjoitustoiminnot (myös
    //    ＋Alakategoria ja muistutus-/termi-/linkkilomakkeet).
    await page.evaluate(() => { document.documentElement.dataset.vrole = 'viewer'; location.hash = '#/kohde/1'; });
    await page.waitForTimeout(500);
    ok('lukija ei näe ＋Alakategoria-nappia', !(await page.isVisible('#newSubBtn')));
    ok('lukija ei näe Uusi ohje -nappia', !(await page.isVisible('#newPageBtn')));
    await page.evaluate(() => { location.hash = '#/muistutukset'; }); await page.waitForTimeout(450);
    ok('lukija ei näe muistutuslomaketta', !(await page.isVisible('#annSaveBtn')));
    await page.evaluate(() => { location.hash = '#/termipankki'; }); await page.waitForTimeout(450);
    ok('lukija ei näe termilomaketta', !(await page.isVisible('#termSaveBtn')));
    await page.evaluate(() => { location.hash = '#/linkit'; }); await page.waitForTimeout(450);
    ok('lukija ei näe linkkilomaketta', !(await page.isVisible('#linkSaveBtn')));
    await page.evaluate(() => { document.documentElement.removeAttribute('data-vrole'); location.hash = '#/muistutukset'; });
    await page.waitForTimeout(450);
    ok('muokkaajalle lomake näkyy normaalisti', await page.isVisible('#annSaveBtn'));

    // 3) Kirjautumisruudulla ei näytetä sovelluksen kehystä.
    await page.evaluate(() => { document.documentElement.dataset.auth = 'out'; });
    await page.waitForTimeout(200);
    ok('kirjautumisruudulla sivupalkki piilossa', !(await page.isVisible('.sidebar')));
    ok('kirjautumisruudulla yläpalkki piilossa', !(await page.isVisible('.topbar')));
    ok('kirjautumisruudulla reunapalsta piilossa', !(await page.isVisible('.rail')));
    await page.evaluate(() => { document.documentElement.removeAttribute('data-auth'); });
    await page.waitForTimeout(200);

    // 4) Hakukorostus ei riko HTML-entiteettejä (&, lainausmerkit).
    const hl = await page.evaluate(() => {
      const txt = (s, q) => { const d = document.createElement('div'); d.innerHTML = highlight(s, q); return d.textContent; };
      return { amp: txt('Koti & Piha', 'amp'), quot: txt('sana "lainaus"', 'quot') };
    });
    ok('hakukorostus ei riko &-merkkiä', hl.amp === 'Koti & Piha', hl.amp);
    ok('hakukorostus ei riko lainausmerkkejä', hl.quot === 'sana "lainaus"', hl.quot);
    const marked = await page.evaluate(() => {
      const d = document.createElement('div'); d.innerHTML = highlight('lampun vaihto', 'amp');
      return d.querySelectorAll('mark').length;
    });
    ok('hakukorostus korostaa yhä oikeat osumat', marked === 1, 'mark=' + marked);

    // 5) Kategoriattoman ohjeen poisto palaa etusivulle (ei #/kohde/null).
    await page.evaluate(async () => {
      const p = await Store.pages.create({ title: 'Kategoriaton', content: 'x', category_id: null, keywords: '' });
      location.hash = '#/sivu/' + p.id;
    });
    await page.waitForTimeout(600);
    dialogAction = 'accept';
    await page.click('#delBtn'); await page.waitForTimeout(700);
    const afterDel = await page.evaluate(() => ({
      hash: location.hash, virhe: document.body.innerText.indexOf('Kategoriaa ei löydy') >= 0,
    }));
    ok('kategoriattoman ohjeen poisto vie etusivulle',
      (afterDel.hash === '#/' || afterDel.hash === '') && !afterDel.virhe, JSON.stringify(afterDel));

    // 6) Hakukentän ohjeteksti kertoo että haku löytää myös tiedostot –
    //    sama teksti sekä sandboxissa että palvelinversiossa (public/index.html).
    const phSandbox = await page.$eval('#searchInput', (e) => e.placeholder);
    const phServer = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
      .match(/id="searchInput"[^>]*placeholder="([^"]*)"/) || [])[1] || '';
    ok('hakukentän ohjeteksti mainitsee tiedostot', phSandbox.indexOf('tiedosto') >= 0, phSandbox);
    ok('hakukentän ohjeteksti sama palvelinversiossa', phServer === phSandbox, phServer);

    // 7) Roskakori: poisto siirtää roskakoriin, palautus tuo takaisin,
    //    lopullinen poisto tyhjentää. Testi luo oman ohjeensa ja tyhjentää
    //    roskakorin aluksi, jottei aiempien testien jäämät häiritse.
    const T = await page.evaluate(async () => {
      for (const t of await Store.trash.list()) await Store.trash.remove(t.id);
      const cats = await Store.categories.list();
      const cat = cats.find((c) => !c.parent_id);
      const pg = await Store.pages.create({ title: 'ROSKISTESTI', content: 'sisältö', category_id: cat.id, author: 'T' });
      return { pageId: pg.id, catId: cat.id };
    });
    await loadCatsFresh(page, T.catId);
    const countBefore = await page.$eval(`.cat-btn[data-cat="${T.catId}"] .count-badge`, (e) => e.textContent);
    await page.evaluate((id) => { location.hash = '#/sivu/' + id; }, T.pageId);
    await page.waitForTimeout(600);
    dialogAction = 'accept';
    await page.click('#delBtn'); await page.waitForTimeout(800);
    ok('poistettu ohje katoaa kategorian listalta',
      (await page.$$eval('.page-list .page-link', (els) => els.map((e) => e.textContent)))
        .every((t) => t.indexOf('ROSKISTESTI') < 0));
    const countAfter = await page.$eval(`.cat-btn[data-cat="${T.catId}"] .count-badge`, (e) => e.textContent);
    ok('kategorian ohjemäärä pienenee poistosta', Number(countAfter) === Number(countBefore) - 1,
      `${countBefore} -> ${countAfter}`);
    ok('poistettua ohjetta ei löydy haulla',
      (await page.evaluate(async () => (await Store.search('ROSKISTESTI')).pages.length)) === 0);
    await page.evaluate(() => { location.hash = '#/roskakori'; }); await page.waitForTimeout(600);
    const trashTitles = () => page.$$eval('.trash-row strong', (els) => els.map((e) => e.textContent));
    ok('poistettu ohje näkyy roskakorissa', (await trashTitles()).indexOf('ROSKISTESTI') >= 0);
    ok('roskakori näyttää jäljellä olevan säilytysajan',
      /30 vrk jäljellä/.test(await page.$eval('.trash-left', (e) => e.textContent)));
    await page.click('[data-restore]'); await page.waitForTimeout(800);
    ok('palautus poistaa rivin roskakorista', (await trashTitles()).indexOf('ROSKISTESTI') < 0);
    await page.evaluate((c) => { location.hash = '#/kohde/' + c; }, T.catId);
    await page.waitForTimeout(600);
    ok('palautettu ohje palaa kategoriaan',
      (await page.$$eval('.page-list .page-link', (els) => els.map((e) => e.textContent)))
        .some((t) => t.indexOf('ROSKISTESTI') >= 0));
    ok('ohjemäärä palautuu ennalleen',
      (await page.$eval(`.cat-btn[data-cat="${T.catId}"] .count-badge`, (e) => e.textContent)) === countBefore);
    ok('palautettu ohje löytyy taas haulla',
      (await page.evaluate(async () => (await Store.search('ROSKISTESTI')).pages.length)) === 1);
    // Lopullinen poisto roskakorista
    await page.evaluate((id) => { location.hash = '#/sivu/' + id; }, T.pageId);
    await page.waitForTimeout(600);
    await page.click('#delBtn'); await page.waitForTimeout(800);
    await page.evaluate(() => { location.hash = '#/roskakori'; }); await page.waitForTimeout(600);
    await page.click('[data-purge]'); await page.waitForTimeout(800);
    ok('lopullinen poisto tyhjentää rivin', (await trashTitles()).indexOf('ROSKISTESTI') < 0);
    ok('lopullisesti poistettu ohje on poissa kannasta',
      (await page.evaluate(async (id) => (await Store.pages.list()).some((x) => x.id === id), T.pageId)) === false);
    // Lukija ei näe roskakoria
    await page.evaluate(() => { document.documentElement.dataset.vrole = 'viewer'; });
    await page.waitForTimeout(250);
    ok('lukija ei näe Roskakori-navilinkkiä', !(await page.isVisible('.nav-link[data-nav="trash"]')));
    await page.evaluate(() => { document.documentElement.removeAttribute('data-vrole'); });

    // Kuvan lisäys KESKEN uuden ohjeen kirjoittamisen: ohje tallennetaan
    // automaattisesti, jottei käyttäjän tarvitse keskeyttää kirjoittamista.
    await page.evaluate(() => { location.hash = '#/uusi'; }); await page.waitForTimeout(700);
    await page.setInputFiles('#imgFileInput', { name: 'a.png', mimeType: 'image/png', buffer: makePng() });
    await page.waitForTimeout(700);
    ok('uusi ohje ilman otsikkoa: selkeä viesti',
      (await page.$eval('#toast', (e) => e.textContent)).indexOf('otsikko') >= 0);
    ok('uusi ohje ilman otsikkoa: ei tallenneta',
      await page.evaluate(() => location.hash === '#/uusi'));
    await page.fill('#titleInput', 'Kuva kesken kirjoittamisen');
    await page.fill('#contentInput', 'Eka kappale.\n\nToka kappale.');
    await page.evaluate(() => {
      const t = document.querySelector('#contentInput');
      t.focus(); t.selectionStart = t.selectionEnd = t.value.indexOf('Toka');
    });
    await page.setInputFiles('#imgFileInput', { name: 'kaavio.png', mimeType: 'image/png', buffer: makePng() });
    await page.waitForTimeout(1400);
    ok('kuva lisättiin ilman erillistä tallennusta',
      /!\[kuva\]\(liite:\d+\)/.test(await page.$eval('#contentInput', (e) => e.value)));
    ok('viittaus meni kursorin kohdalle',
      /Eka kappale\.\s*\n!\[kuva\]\(liite:\d+\)/.test(await page.$eval('#contentInput', (e) => e.value)));
    ok('muokkauslomake pysyy auki', await page.isVisible('#contentInput'));
    ok('osoite vaihtui muokkaustilaksi',
      /#\/muokkaa\/\d+/.test(await page.evaluate(() => location.hash)));
    ok('otsikko ei enää lupaa "Uusi ohje"',
      (await page.$eval('#editHeading', (e) => e.textContent)) === 'Muokkaa ohjetta');
    await page.evaluate(() => {
      const t = document.querySelector('#contentInput');
      t.value += '\n\nKolmas kappale.';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#saveBtn'); await page.waitForTimeout(1300);
    ok('tallennus vie valmiiseen ohjeeseen', /#\/sivu\/\d+/.test(page.url()), page.url());
    ok('kuva näkyy tallennetussa ohjeessa',
      await page.$eval('.doc img.doc-img', (e) => e.complete && e.naturalWidth > 0).catch(() => false));
    ok('kuvan jälkeen kirjoitettu teksti säilyi',
      (await page.$eval('.doc', (e) => e.textContent)).indexOf('Kolmas kappale') >= 0);

    // Liitteen lisäys: yksi ensisijainen nappi, lataus alkaa valinnasta.
    // Aiemmin vieressä oli erillinen "Lataa", joka tuotti vain virheen
    // ennen tiedoston valintaa.
    ok('erillistä Lataa-nappia ei ole', (await page.$$('#uploadForm button[type=submit]')).length === 0);
    ok('valintanappi on ensisijainen (oranssi)', await page.$eval('#pickFilesBtn',
      (e) => e.classList.contains('btn') && !e.classList.contains('secondary')));
    ok('natiivi tiedostokenttä on piilotettu',
      await page.$eval('#fileInput', (e) => getComputedStyle(e).display === 'none'));

    // Jo liitetyn kuvan pudotus tekstiin: liitteeksi ladattu kuva pitää saada
    // tekstin sekaan ilman uutta latausta (ei kaksoiskappaletta).
    await page.evaluate(async () => {
      const c = await Store.categories.list();
      const pg = await Store.pages.create({ title: 'Kuvanpudotus', content: 'Rivi.', category_id: c[0].id, author: 'T' });
      location.hash = '#/sivu/' + pg.id;
    });
    await page.waitForTimeout(700);
    await page.setInputFiles('#fileInput', { name: 'kaavio.png', mimeType: 'image/png', buffer: makePng() });
    await page.waitForTimeout(1100);
    ok('liite näkyy vihjeineen artikkelissa',
      (await page.$eval('#content', (e) => e.textContent)).indexOf('tekstin sekaan') >= 0);
    const attsBefore = (await page.$$('.att-thumb')).length;
    await page.click('#editBtn'); await page.waitForTimeout(700);
    ok('muokkausnäkymä tarjoaa jo liitetyt kuvat', (await page.$$('.att-pick-item')).length === 1);
    await page.evaluate(() => {
      const t = document.querySelector('#contentInput');
      t.focus(); t.selectionStart = t.selectionEnd = t.value.length;
    });
    await page.click('.att-pick-item'); await page.waitForTimeout(400);
    ok('klikkaus lisää kuvaviittauksen tekstiin',
      /!\[kuva\]\(liite:\d+\)/.test(await page.$eval('#contentInput', (e) => e.value)));
    await page.click('#saveBtn'); await page.waitForTimeout(1200);
    const dropped = await page.$eval('.doc img.doc-img',
      (e) => e.complete && e.naturalWidth > 0).catch(() => false);
    ok('pudotettu kuva näkyy tekstin seassa', dropped);
    ok('ei syntynyt kaksoiskappaletta liitteisiin',
      (await page.$$('.att-thumb')).length === attsBefore, attsBefore + ' -> ' + (await page.$$('.att-thumb')).length);
    // Toistoklikkaus ei saa monistaa viittausta (tekstikenttä täyttyi aiemmin
    // samoilla riveillä, koska lisäys tapahtui näkymän ulkopuolella).
    await page.click('#editBtn'); await page.waitForTimeout(700);
    const refCount = () => page.$eval('#contentInput',
      (e) => (e.value.match(/!\[kuva\]\(liite:\d+\)/g) || []).length);
    const before = await refCount();
    await page.click('.att-pick-item'); await page.waitForTimeout(350);
    await page.click('.att-pick-item'); await page.waitForTimeout(350);
    await page.click('.att-pick-item'); await page.waitForTimeout(350);
    ok('toistoklikkaus ei monista kuvaviittausta', (await refCount()) === before,
      before + ' -> ' + (await refCount()));
    ok('jo lisätty kuva on merkitty valitsimessa',
      await page.$eval('.att-pick-item', (e) => e.classList.contains('used')));
    ok('toistoklikkaus korostaa olemassa olevan kohdan',
      /liite:\d+/.test(await page.$eval('#contentInput',
        (e) => e.value.slice(e.selectionStart, e.selectionEnd))));
    // Käsin poistettu viittaus vapauttaa kuvan uudelleen lisättäväksi
    await page.evaluate(() => {
      const t = document.querySelector('#contentInput');
      t.value = t.value.replace(/!\[kuva\]\(liite:\d+\)/, '');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    ok('käsin poisto vapauttaa merkinnän',
      !(await page.$eval('.att-pick-item', (e) => e.classList.contains('used'))));
    await page.evaluate(() => history.back()); await page.waitForTimeout(700);

    ok('pikkukuva ei rajaudu (contain)',
      (await page.$eval('.att-thumb img', (e) => getComputedStyle(e).objectFit)) === 'contain');

    // 8) Ulkoasu 2a on ainoa ja aina voimassa (ei enää kytkintä).
    await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(600);
    ok('2a on voimassa ilman kytkintä', await page.evaluate(() =>
      document.documentElement.dataset.design === '2a' && !!document.querySelector('.d2-home')));
    ok('designin kytkinnappi on poistettu', (await page.$$('#designToggle')).length === 0);
    ok('vanhaa etusivua ei enää ole', (await page.$$('.home-grid')).length === 0);
    ok('etusivu näyttää kategoriat', (await page.$$('.d2-cat')).length >= 2);
    ok('2a käyttää paketoitua Inter Tight -fonttia',
      /Inter Tight/.test(await page.$eval('.d2-title', (e) => getComputedStyle(e).fontFamily)));
    ok('2a käyttää monospacea numeroissa',
      /Plex Mono/.test(await page.$eval('.d2-stat b', (e) => getComputedStyle(e).fontFamily)));
    ok('2a: ei varjoja korteissa',
      (await page.$eval('.d2-card', (e) => getComputedStyle(e).boxShadow)) === 'none');
    // Ohjeet-kortin kategoriakortti vie kategoriaan
    await page.click('.d2-cat:not(.all)'); await page.waitForTimeout(700);
    ok('kategoriakortti avaa kategorian', /#\/kohde\/\d+/.test(page.url()), page.url());
    // Muistutus-kortin rivi vie muistutuksiin
    await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(700);
    await page.click('.dash-item'); await page.waitForTimeout(700);
    ok('muistutusrivi avaa muistutukset', /#\/muistutukset/.test(page.url()), page.url());

    // 9) Kapea näyttö ei saa vieriä vaakasuunnassa kummassakaan ilmeessä
    //    (yläpalkki levisi aiemmin ~140 px yli ruudun puhelimella).
    {
      const nar = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      nar.on('pageerror', (e) => errors.push('kapea: ' + e.message));
      await nar.goto(fileUrl);
      await nar.evaluate(() => localStorage.clear());
      await nar.reload(); await nar.waitForTimeout(1100);
      const over = await nar.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok('kapealla näytöllä ei vaakavieritystä', over <= 0, over + ' px');
      await nar.close();
    }

    // 10) Yläpalkki ja sivupalkki pysyvät paikoillaan vieritettäessä.
    //     (html,body{height:100%} rikkoi stickyn aiemmin kokonaan.)
    await page.evaluate(async () => {
      const cats = await Store.categories.list();
      let t = '';
      for (let i = 1; i <= 50; i++) t += `## Osio ${i}\n\nTekstiä vierittämistä varten.\n\n`;
      for (let i = 0; i < 12; i++) await Store.categories.create({ name: 'Vierityskategoria ' + i, icon: 'svg:folder' });
      const pg = await Store.pages.create({ title: 'Vieritystesti', content: t, category_id: cats[0].id, author: 'T' });
      await loadCategories();
      location.hash = '#/sivu/' + pg.id;
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, 2000)); await page.waitForTimeout(400);
    const stick = await page.evaluate(() => {
      const t = document.querySelector('.topbar').getBoundingClientRect();
      const s = document.querySelector('.sidebar');
      const sr = s.getBoundingClientRect();
      return { top: Math.round(t.top), sideTop: Math.round(sr.top),
        sisalto: s.scrollHeight, nakyva: s.clientHeight, scrollY: Math.round(window.scrollY) };
    });
    ok('sivu on oikeasti vieritetty', stick.scrollY > 500, stick.scrollY + 'px');
    ok('yläpalkki pysyy paikallaan vieritettäessä', stick.top === 0, 'y=' + stick.top);
    ok('sivupalkki pysyy paikallaan vieritettäessä', stick.sideTop > 0 && stick.sideTop < 70, 'y=' + stick.sideTop);
    ok('sivupalkki mahtuu ruudulle (oma vieritys)', stick.nakyva < stick.sisalto,
      stick.nakyva + '/' + stick.sisalto);
    ok('sivupalkin pohjalle pääsee vierittämällä', await page.evaluate(() => {
      const s = document.querySelector('.sidebar');
      s.scrollTop = s.scrollHeight;
      return Math.round(s.scrollTop + s.clientHeight) >= s.scrollHeight - 2;
    }));
    // Sisällysluettelon ankkuri ei saa jäädä yläpalkin alle
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.waitForTimeout(300);
    const tocOk = await page.evaluate(() => {
      const a = document.querySelector('[data-toc]');
      if (!a) return null;
      a.click();
      return new Promise((r) => setTimeout(() => {
        const h = document.getElementById(a.dataset.toc);
        r(Math.round(h.getBoundingClientRect().top));
      }, 800));
    });
    if (tocOk !== null) {
      ok('sisällysluettelon otsikko ei jää yläpalkin alle', tocOk >= 50, 'y=' + tocOk);
    }
    await page.evaluate(() => { window.scrollTo(0, 0); location.hash = '#/'; });
    await page.waitForTimeout(500);

    // 11) Yläpalkin kello: aika, päivämäärä ja ISO-viikkonumero.
    await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(500);
    const clock = await page.evaluate(() => {
      const e = document.querySelector('#clock');
      if (!e) return null;
      return {
        aika: (e.querySelector('.clock-time') || {}).textContent || '',
        pvm: (e.querySelector('.clock-date') || {}).textContent || '',
        vko: (e.querySelector('.clock-week') || {}).textContent || '',
      };
    });
    ok('kello näkyy yläpalkissa', !!clock && /^\d{1,2}[.:]\d{2}$/.test(clock.aika), JSON.stringify(clock));
    ok('päivämäärä näkyy yläpalkissa', !!clock && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(clock.pvm), clock && clock.pvm);
    ok('viikkonumero näkyy yläpalkissa', !!clock && /^vko ([1-9]|[1-4]\d|5[0-3])$/.test(clock.vko), clock && clock.vko);
    // ISO 8601 -viikkonumero: vuodenvaihteet ovat se kohta joka menee helposti väärin
    const weeks = await page.evaluate(() => [
      ['2026-01-01', 1], ['2025-12-29', 1], ['2025-12-28', 52], ['2026-12-31', 53],
      ['2027-01-01', 53], ['2024-12-30', 1], ['2021-01-01', 53], ['2026-07-26', 30],
    ].map(([s, odotettu]) => {
      const [y, m, d] = s.split('-').map(Number);
      return { s, odotettu, saatu: isoWeek(new Date(y, m - 1, d)) };
    }));
    const vaarat = weeks.filter((w) => w.saatu !== w.odotettu);
    ok('viikkonumero oikein myös vuodenvaihteissa', vaarat.length === 0, JSON.stringify(vaarat));
    // Kapealla näytöllä päivämäärä väistyy, kello ja viikko jäävät
    const nar2 = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await nar2.goto(fileUrl); await nar2.waitForTimeout(1100);
    ok('kapealla näytöllä kello näkyy yhä',
      await nar2.evaluate(() => document.querySelector('.clock').getBoundingClientRect().width > 0));
    ok('kapealla näytöllä päivämäärä väistyy',
      await nar2.evaluate(() => getComputedStyle(document.querySelector('.clock-date')).display === 'none'));
    ok('kello ei aiheuta vaakavieritystä kapealla',
      (await nar2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await nar2.close();

    ok('ei JS-virheitä koko ajossa', errors.length === 0, errors.join(','));
  } finally {
    await browser.close();
  }

  console.log(`\nSelaintestit: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Testiajo kaatui:', e); process.exit(1); });
