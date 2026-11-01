// Rajapintatestit: käynnistää palvelimen väliaikaisella datahakemistolla
// (ELAMA_DATA_DIR), joten oikea kanta ei koskaan muutu. Aja: npm test
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || 4979;
const B = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'elama-test-'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' – ' + extra : '')); }
}

const J = { 'Content-Type': 'application/json' };
let COOKIE = ''; // istuntoeväste asetetaan setup-vaiheessa
const H = (extra) => ({ ...(extra || {}), Cookie: COOKIE });
const jget = (url) => fetch(B + url, { headers: H() }).then((r) => r.json());
const jsend = (method, url, body) =>
  fetch(B + url, { method, headers: H(J), body: JSON.stringify(body) }).then((r) => r.json());
const status = (method, url, body, cookie) =>
  fetch(B + url, {
    method,
    headers: body ? { ...J, Cookie: cookie === undefined ? COOKIE : cookie } : { Cookie: cookie === undefined ? COOKIE : cookie },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.status);
// Ohjeen poisto (= siirto roskakoriin) vaatii salasanan bodyssa.
const delPage = (id, password = 'salasana123') =>
  fetch(`${B}/api/pages/${id}`, {
    method: 'DELETE', headers: { ...J, Cookie: COOKIE }, body: JSON.stringify({ password }),
  }).then((r) => r.status);

// Kategorian poisto vaatii salasanan bodyssa; palauttaa HTTP-statuksen.
const delCat = (id, password, cookie) =>
  fetch(`${B}/api/categories/${id}`, {
    method: 'DELETE',
    headers: { ...J, Cookie: cookie === undefined ? COOKIE : cookie },
    body: JSON.stringify({ password }),
  }).then((r) => r.status);

async function main() {
  // Siemen + palvelin eristettyyn hakemistoon
  const env = { ...process.env, ELAMA_DATA_DIR: TMP, PORT: String(PORT) };
  spawnSync(process.execPath, ['seed.js'], { cwd: ROOT, env });
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    // Odota käynnistymistä
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { await fetch(B + '/api/categories'); up = true; }
      catch (_) { await new Promise((r) => setTimeout(r, 200)); }
    }
    if (!up) throw new Error('Palvelin ei käynnistynyt');

    // --- Kirjautuminen ---
    ok('ilman kirjautumista API vastaa 401', await status('GET', '/api/categories', null, '') === 401);
    const su = await fetch(B + '/api/setup', {
      method: 'POST', headers: J,
      body: JSON.stringify({ name: 'Testi Admin', username: 'admin', password: 'salasana123' }),
    });
    COOKIE = (su.headers.get('set-cookie') || '').split(';')[0];
    ok('ensikäynnistys luo pääkäyttäjän', su.status === 200 && COOKIE.startsWith('elama_session='));
    ok('toinen setup estetään (403)', await status('POST', '/api/setup',
      { name: 'X', username: 'toinen', password: 'salasana123' }, '') === 403);
    ok('väärä salasana hylätään (401)', await status('POST', '/api/login',
      { username: 'admin', password: 'vaara-salasana' }, '') === 401);
    const me = await jget('/api/auth-status');
    ok('istunto voimassa', me.user && me.user.role === 'admin' && me.user.name === 'Testi Admin');

    // Roolit: luodaan lukija ja testataan rajat
    await jsend('POST', '/api/users', { name: 'Lukija Liisa', username: 'liisa', password: 'salasana123', role: 'viewer' });
    const vLogin = await fetch(B + '/api/login', {
      method: 'POST', headers: J, body: JSON.stringify({ username: 'liisa', password: 'salasana123' }),
    });
    const V_COOKIE = (vLogin.headers.get('set-cookie') || '').split(';')[0];
    ok('lukija voi kirjautua', vLogin.status === 200);
    ok('lukija voi lukea', await status('GET', '/api/pages', null, V_COOKIE) === 200);
    ok('lukija ei voi kirjoittaa (403)', await status('POST', '/api/shift-notes', { content: 'x' }, V_COOKIE) === 403);
    ok('lukija ei näe käyttäjähallintaa (403)', await status('GET', '/api/users', null, V_COOKIE) === 403);
    ok('omaa tunnusta ei voi poistaa (400)', await status('DELETE', '/api/users/1') === 400);

    // Tekijä tulee istunnosta, ei selaimen kentästä
    const authored = await jsend('POST', '/api/pages', { title: 'Tekijätesti', content: 'x', category_id: 1, author: 'Huijaus' });
    ok('tekijä tulee istunnosta', authored.updated_by === 'Testi Admin', authored.updated_by);
    await delPage(authored.id);

    // --- Tietoturva ---
    const home = await fetch(B + '/');
    ok('CSP-otsake asetettu', (home.headers.get('content-security-policy') || '').includes("default-src 'self'"));
    ok('nosniff-otsake', home.headers.get('x-content-type-options') === 'nosniff');
    ok('x-powered-by piilotettu', !home.headers.get('x-powered-by'));
    const longTitle = 'A'.repeat(1000);
    const capped = await jsend('POST', '/api/pages', { title: longTitle, content: 'x', category_id: 1 });
    ok('otsikon pituusraja (300)', capped.title.length === 300, capped.title.length);
    await delPage(capped.id);

    // --- Kategoriat ---
    const cats = await jget('/api/categories');
    const topCats = cats.filter((c) => !c.parent_id);
    ok('seed-pääkategoriat SVG-kuvakkeineen', topCats.length === 5 && topCats[0].icon === 'svg:building', JSON.stringify(topCats[0]));
    const svgCat = await jsend('POST', '/api/categories', { name: 'SVG-testi', icon: 'svg:clipboard' });
    ok('SVG-kuvaketunniste ei katkea (raja 24)', svgCat.icon === 'svg:clipboard', svgCat.icon);
    await delCat(svgCat.id, 'salasana123');
    ok('kategorioiden artikkelimäärät', cats.every((c) => typeof c.page_count === 'number'));
    const newCat = await jsend('POST', '/api/categories', { name: 'Testikategoria', icon: '🧰' });
    ok('kategorian luonti', newCat.id > 0 && newCat.icon === '🧰' && newCat.parent_id === null);
    const renamed = await jsend('PUT', `/api/categories/${newCat.id}`, { name: 'Testi2', icon: '🔧' });
    ok('kategorian muokkaus', renamed.name === 'Testi2' && renamed.icon === '🔧');
    ok('tyhjä nimi hylätään (400)', await status('POST', '/api/categories', { name: '' }) === 400);

    // Kategorian väriaksentti: heksa hyväksytään, roska siivotaan tyhjäksi
    ok('seed-kategorialla väri', /^#[0-9a-f]{6}$/.test(topCats[0].color), topCats[0].color);
    const colored = await jsend('POST', '/api/categories', { name: 'Värillinen', color: '#C2410C' });
    ok('väri tallentuu (normalisoitu)', colored.color === '#c2410c', colored.color);
    const badColor = await jsend('POST', '/api/categories', { name: 'Rojuväri', color: 'punainen; x:1' });
    ok('kelvoton väri hylätään (tyhjä)', badColor.color === '', badColor.color);
    const recolored = await jsend('PUT', `/api/categories/${colored.id}`, { name: 'Värillinen', color: '#16a34a' });
    ok('värin muokkaus', recolored.color === '#16a34a');
    await delCat(colored.id, 'salasana123'); await delCat(badColor.id, 'salasana123');

    // --- Alakategoriat (monta tasoa) ---
    ok('seed-alakategoriat olemassa', cats.some((c) => c.parent_id != null));
    const sub = await jsend('POST', '/api/categories', { name: 'Asiakas X', icon: '🏬', parent_id: newCat.id });
    ok('alakategorian luonti', sub.parent_id === newCat.id);
    ok('olematon yläkategoria hylätään (400)', await status('POST', '/api/categories', { name: 'Y', parent_id: 999999 }) === 400);
    // Kolmas taso on sallittu (esim. Koti > Laitteet ja huolto > Keittiö).
    const sub3 = await jsend('POST', '/api/categories', { name: 'DSC', parent_id: sub.id });
    ok('kolmas taso sallitaan', sub3.parent_id === sub.id);
    ok('silmukka estetään: ei omaan alakategoriaan (400)',
      await status('PUT', `/api/categories/${sub.id}`, { name: 'Asiakas X', parent_id: sub3.id }) === 400);
    ok('alakategorian voi siirtää pääkategoriaksi', (await jsend('PUT', `/api/categories/${sub.id}`, { name: 'Asiakas X', parent_id: null })).parent_id === null);
    await jsend('PUT', `/api/categories/${sub.id}`, { name: 'Asiakas X', parent_id: newCat.id }); // takaisin alle
    // Kolmannen tason poisto ketjuna: poista väliaikainen puu newCat kokonaan lopuksi.
    await delCat(sub3.id, 'salasana123');
    // Kolmitasoinen cascade-poisto: parent > sub > subsub, poisto vie kaiken.
    const tmpParent = await jsend('POST', '/api/categories', { name: 'PoistoParent', icon: '🗂️' });
    const tmpSub = await jsend('POST', '/api/categories', { name: 'PoistoChild', parent_id: tmpParent.id });
    const tmpSub2 = await jsend('POST', '/api/categories', { name: 'PoistoLapsenlapsi', parent_id: tmpSub.id });
    const tmpPage = await jsend('POST', '/api/pages', { title: 'Alasivu', content: 'x', category_id: tmpSub2.id });
    ok('sivu kolmannen tason kategoriaan', tmpPage.category_id === tmpSub2.id);
    await delCat(tmpParent.id, 'salasana123');
    const afterDel = await jget('/api/categories');
    ok('poisto vei koko alipuun (myös 3. taso)', !afterDel.some((c) => c.id === tmpSub2.id) && !afterDel.some((c) => c.id === tmpSub.id));
    ok('poisto vei syvimmän alasivun', (await fetch(`${B}/api/pages/${tmpPage.id}`, { headers: H() })).status === 404);

    // --- Kategorian poiston suojaus: vain ylläpitäjä + salasana ---
    await jsend('POST', '/api/users', { name: 'Muokkaaja Matti', username: 'matti', password: 'salasana123', role: 'editor' });
    const eLogin = await fetch(B + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ username: 'matti', password: 'salasana123' }) });
    const E_COOKIE = (eLogin.headers.get('set-cookie') || '').split(';')[0];
    const permCat = await jsend('POST', '/api/categories', { name: 'Suojattu', icon: '🛡️' });
    ok('muokkaaja ei voi poistaa kategoriaa (403)', await delCat(permCat.id, 'salasana123', E_COOKIE) === 403);
    ok('lukija ei voi poistaa kategoriaa (403)', await delCat(permCat.id, 'salasana123', V_COOKIE) === 403);
    ok('ylläpitäjä ilman salasanaa ei poista (403)', await delCat(permCat.id, '') === 403);
    ok('ylläpitäjä väärällä salasanalla ei poista (403)', await delCat(permCat.id, 'vaarasalasana') === 403);
    ok('kategoria yhä olemassa väärien yritysten jälkeen', (await jget('/api/categories')).some((c) => c.id === permCat.id));
    ok('ylläpitäjä oikealla salasanalla poistaa (200)', await delCat(permCat.id, 'salasana123') === 200);
    ok('kategoria poistui oikean salasanan jälkeen', !(await jget('/api/categories')).some((c) => c.id === permCat.id));

    // Siivotaan testin alakategoria pois, ettei se häiritse myöhempiä laskentoja.
    await delCat(sub.id, 'salasana123');

    // --- Järjestyksen muokkaus ---
    const catsOrig = await jget('/api/categories');
    const revIds = catsOrig.map((c) => c.id).reverse();
    await jsend('POST', '/api/categories/reorder', { ids: revIds });
    const afterReorder = await jget('/api/categories');
    ok('kategorioiden uudelleenjärjestys', afterReorder[0].id === revIds[0]);
    await jsend('POST', '/api/categories/reorder', { ids: catsOrig.map((c) => c.id) }); // palautus
    ok('reorder ilman ids-listaa (400)', await status('POST', '/api/pages/reorder', {}) === 400);
    // Etsitään kategoria jossa on vähintään kaksi ohjetta – näin testi ei ole
    // sidottu siihen, miten esimerkkisisältö sattuu jakautumaan.
    let reorderCat = null, catPages = [];
    for (const c of await jget('/api/categories')) {
      const ps = await jget('/api/pages?category_id=' + c.id);
      if (ps.length >= 2) { reorderCat = c.id; catPages = ps; break; }
    }
    ok('löytyi kategoria jossa on ohjeita järjestettäväksi', !!reorderCat);
    await jsend('POST', '/api/pages/reorder', { ids: catPages.map((p) => p.id).reverse() });
    const catAfter = await jget('/api/pages?category_id=' + reorderCat);
    ok('ohjeiden järjestys kategorian sisällä', catAfter[0].id === catPages[catPages.length - 1].id);

    // --- Sivut ---
    const page = await jsend('POST', '/api/pages', {
      title: '<script>alert(1)</script>', content: 'Testi **sisältö** erikoissanaXYZ',
      keywords: 'avainsanaQ', category_id: newCat.id, author: 'Testaaja',
    });
    ok('sivun luonti', page.id > 0);
    ok('XSS-otsikko tallentuu raakatekstinä', page.title === '<script>alert(1)</script>');
    ok('olematon sivu (404)', await status('GET', '/api/pages/99999') === 404);
    ok('tyhjä otsikko hylätään (400)', await status('POST', '/api/pages', { title: ' ' }) === 400);

    // Katselulaskuri vain track-parametrilla
    const before = (await jget(`/api/pages/${page.id}`)).views;
    await jget(`/api/pages/${page.id}?track=1`);
    const after = (await jget(`/api/pages/${page.id}`)).views;
    ok('katselu kasvaa vain trackilla', after === before + 1);

    // Vahvistus
    const verified = await jsend('POST', `/api/pages/${page.id}/verify`, { author: 'Testaaja' });
    ok('ajantasaisuusvahvistus (tekijä istunnosta)', !!verified.verified_at && verified.verified_by === 'Testi Admin');

    // Versiokatto: 35 muokkausta -> 30 versiota, sisältö säilyy
    for (let i = 1; i <= 35; i++) {
      await jsend('PUT', `/api/pages/${page.id}`, {
        title: 'Versio ' + i, content: 'sisältö ' + i, keywords: '', category_id: newCat.id, author: 'T',
      });
    }
    const revs = await jget(`/api/pages/${page.id}/revisions`);
    ok('versiokatto 30/sivu', revs.length === 30, revs.length);
    const oldest = await jget(`/api/revisions/${revs[revs.length - 1].id}`);
    ok('vanhan version sisältö tallella', oldest.content.startsWith('sisältö'));
    ok('olematon versio (404)', await status('GET', '/api/revisions/99999') === 404);

    // --- Liitteet: lataus, tyyppiraja, siivous ---
    const fd = new FormData();
    fd.append('files', new Blob(['%PDF-1.4 testidata'], { type: 'application/pdf' }), 'testi.pdf');
    fd.append('author', 'Testaaja');
    const up1 = await fetch(`${B}/api/pages/${page.id}/attachments`, { method: 'POST', body: fd, headers: H() }).then((r) => r.json());
    ok('PDF-liitteen lataus', up1.ok === true && up1.count === 1);
    ok('lataus palauttaa liitteiden id:t', Array.isArray(up1.ids) && up1.ids.length === 1);
    const fd2 = new FormData();
    fd2.append('files', new Blob(['pelkkää tekstiä'], { type: 'text/plain' }), 'kielletty.txt');
    const up2 = await fetch(`${B}/api/pages/${page.id}/attachments`, { method: 'POST', body: fd2, headers: H() }).then((r) => r.json());
    ok('kielletty tiedostotyyppi torjutaan', !!up2.error);
    ok('liite levyllä', fs.readdirSync(path.join(TMP, 'uploads')).length === 1);
    // Turvakovennus: SVG (voi sisältää skriptin) tarjoillaan hiekkalaatikossa.
    const fdSvg = new FormData();
    fdSvg.append('files', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'kuva.svg');
    const upSvg = await fetch(`${B}/api/pages/${page.id}/attachments`, { method: 'POST', body: fdSvg, headers: H() }).then((r) => r.json());
    const svgRes = await fetch(`${B}/api/attachments/${upSvg.ids[0]}`, { headers: H() });
    const svgCsp = svgRes.headers.get('content-security-policy') || '';
    ok('liite tarjoillaan hiekkalaatikossa', svgCsp.includes('sandbox') && svgCsp.includes("default-src 'none'"), svgCsp);
    ok('liitteellä nosniff-otsake', svgRes.headers.get('x-content-type-options') === 'nosniff');
    await svgRes.text();
    // --- Roskakori: poisto vaatii salasanan, sisältö säilyy 30 vrk ---
    const filesBefore = fs.readdirSync(path.join(TMP, 'uploads')).length;
    ok('ohjeen poisto ilman salasanaa torjutaan (403)',
      await status('DELETE', `/api/pages/${page.id}`, {}) === 403);
    ok('ohjeen poisto väärällä salasanalla torjutaan (403)',
      await status('DELETE', `/api/pages/${page.id}`, { password: 'vaara' }) === 403);
    ok('ohje on yhä olemassa epäonnistuneen poiston jälkeen',
      (await fetch(`${B}/api/pages/${page.id}`, { headers: H() })).status === 200);
    const trashed = await jsend('DELETE', `/api/pages/${page.id}`, { password: 'salasana123' });
    ok('poisto salasanalla siirtää roskakoriin', trashed.trashed === true && trashed.days === 30);
    ok('roskakoriin siirretty ohje ei avaudu sivuna (404)',
      (await fetch(`${B}/api/pages/${page.id}`, { headers: H() })).status === 404);
    ok('roskakoriin siirretty ohje katoaa listauksesta',
      (await jget('/api/pages')).every((x) => x.id !== page.id));
    ok('roskakoriin siirretty ohje katoaa hausta',
      (await jget('/api/search?q=Testiohje')).pages.every((x) => x.id !== page.id));
    ok('liitteet säilyvät levyllä roskakorissa',
      fs.readdirSync(path.join(TMP, 'uploads')).length === filesBefore, 'ennen=' + filesBefore);
    ok('versiohistoria säilyy roskakorissa', (await jget(`/api/pages/${page.id}/revisions`)).length > 0);
    const trash = await jget('/api/trash');
    const inTrash = trash.find((t) => t.id === page.id);
    ok('ohje näkyy roskakorissa', !!inTrash && inTrash.days_left === 30, JSON.stringify(inTrash));
    // Palautus
    await jsend('POST', `/api/pages/${page.id}/restore`, {});
    ok('palautettu ohje avautuu taas', (await fetch(`${B}/api/pages/${page.id}`, { headers: H() })).status === 200);
    ok('palautettu ohje näkyy listauksessa', (await jget('/api/pages')).some((x) => x.id === page.id));
    ok('roskakori tyhjeni palautuksen jälkeen', (await jget('/api/trash')).every((t) => t.id !== page.id));
    ok('palautus ei-poistetulle torjutaan (400)',
      await status('POST', `/api/pages/${page.id}/restore`, {}) === 400);
    // Lopullinen poisto: vain admin + salasana
    await jsend('DELETE', `/api/pages/${page.id}`, { password: 'salasana123' });
    ok('lopullinen poisto ilman salasanaa torjutaan (403)',
      await status('DELETE', `/api/trash/${page.id}`, {}) === 403);
    ok('lopullinen poisto lukijana torjutaan (403)',
      await status('DELETE', `/api/trash/${page.id}`, { password: 'salasana123' }, V_COOKIE) === 403);
    await jsend('DELETE', `/api/trash/${page.id}`, { password: 'salasana123' });
    ok('lopullinen poisto siivoaa liitteet levyltä', fs.readdirSync(path.join(TMP, 'uploads')).length === 0);
    ok('lopullinen poisto siivoaa versiot', (await jget(`/api/pages/${page.id}/revisions`)).length === 0);
    ok('lopullisesti poistettu ohje ei ole roskakorissa',
      (await jget('/api/trash')).every((t) => t.id !== page.id));

    // --- Tiedotteet ---
    const ann = await jsend('POST', '/api/announcements', { title: 'Testitiedote', content: 'Sisältö', author: 'T' });
    await jsend('PUT', `/api/announcements/${ann.id}`, { pinned: true });
    const anns = await jget('/api/announcements');
    ok('kiinnitetty tiedote nousee kärkeen', anns[0].title === 'Testitiedote' && anns[0].pinned === 1);
    ok('osittainen päivitys säilyttää otsikon', anns[0].content === 'Sisältö');
    await fetch(`${B}/api/announcements/${ann.id}`, { method: 'DELETE', headers: H() });

    // --- Termit ---
    const term = await jsend('POST', '/api/terms', { term: 'Öljytesti', definition: 'aakkostustesti', author: 'T' });
    const terms = await jget('/api/terms');
    ok('termi aakkostuu suomeksi (Ö viimeisenä)', terms[terms.length - 1].term === 'Öljytesti');
    await fetch(`${B}/api/terms/${term.id}`, { method: 'DELETE', headers: H() });

    // --- Linkit ---
    const link = await jsend('POST', '/api/links', { label: 'Testilinkki', url: 'testi.fi/sivu' });
    ok('URL-normalisointi lisää https://', link.url === 'https://testi.fi/sivu');
    await fetch(`${B}/api/links/${link.id}`, { method: 'DELETE', headers: H() });

    // --- Vuoroloki ---
    const note = await jsend('POST', '/api/shift-notes', { content: 'Testihuomio', author: 'T', category_id: 1 });
    ok('vuorohuomion luonti', note.id > 0);
    ok('limit-parametri kestää roskan', await status('GET', '/api/shift-notes?limit=99999') === 200);
    await fetch(`${B}/api/shift-notes/${note.id}`, { method: 'DELETE', headers: H() });

    // --- Haku ---
    const s1 = await jget('/api/search?q=' + encodeURIComponent('erikoissanaXYZ'));
    ok('haku palauttaa kaikki 6 osiota', Object.keys(s1).length === 6, Object.keys(s1).join(','));
    const s2 = await jget('/api/search?q=' + encodeURIComponent('varaaja'));
    ok('haku löytää artikkelin (varaaja)', s2.pages.some((p) => p.title.toLowerCase().includes('varaaja')));
    ok('artikkelilla ote osumakohdasta', s2.pages.every((p) => 'snippet' in p));
    const s3 = await jget('/api/search?q=luonto');  // esiintyy vain avainsanoissa
    ok('avainsanaosuma ilman tekstiosumaa', s3.pages.some((p) => (p.snippet || '').startsWith('Avainsanat:')));
    const empty = await jget('/api/search?q=');
    ok('tyhjä haku palauttaa tyhjät osiot', Object.keys(empty).length === 6 && empty.pages.length === 0);
    // LIKE-jokerimerkit escapetaan: alaviiva osuu vain kirjaimellisesti.
    const litA = await jsend('POST', '/api/pages', { title: 'Raportti_2026', content: 'x', category_id: 1 });
    const litB = await jsend('POST', '/api/pages', { title: 'RaporttiX2026', content: 'y', category_id: 1 });
    const litHit = await jget('/api/search?q=' + encodeURIComponent('Raportti_2026'));
    ok('haku ei kohtele _ jokerimerkkinä', litHit.pages.length === 1 && litHit.pages[0].title === 'Raportti_2026',
      JSON.stringify(litHit.pages.map((p) => p.title)));
    const pctHit = await jget('/api/search?q=' + encodeURIComponent('Raportti%'));
    ok('haku ei kohtele % jokerimerkkinä', pctHit.pages.length === 0, JSON.stringify(pctHit.pages.map((p) => p.title)));
    await delPage(litA.id);
    await delPage(litB.id);

    // --- Offline ---
    const offRes = await fetch(B + '/offline', { headers: H() });
    const off = await offRes.text();
    ok('offline sisältää ohjeet ja numerot',
      off.includes('Lämminvesivaraajan nollaus') && off.includes('tel:112'));
    const dl = await fetch(B + '/offline?download=1', { headers: H() });
    ok('offline-lataus attachmenttina', (dl.headers.get('content-disposition') || '').includes('elama-offline.html'));
  } finally {
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\nRajapintatestit: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Testiajo kaatui:', e); process.exit(1); });
