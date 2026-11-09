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

    // --- Varmuusvarasto ---
    const p0 = await jget('/api/pantry');
    ok('varasto aluksi tyhjä ja kategoriat mukana', p0.items.length === 0 && p0.categories.includes('Juomavesi'));
    ok('varaston tuote ilman nimeä hylätään', await status('POST', '/api/pantry', { name: ' ' }) === 400);
    const pa = await jsend('POST', '/api/pantry', { name: 'Hernekeitto', barcode: '6408430000258', category: 'Ruoka', qty: 2, best_before: '2027-01-31' });
    ok('varastoon lisätään tuote', pa.id && pa.qty === 2 && pa.best_before === '2027-01-31');
    ok('lisääjä tulee istunnosta', pa.created_by === 'Testi Admin');
    const pb = await jsend('POST', '/api/pantry', { name: 'Vesi', category: 'Keksitty', qty: -5, best_before: '2027-02-30' });
    ok('virheellinen päiväys, kategoria ja määrä siivotaan', pb.best_before === '' && pb.category === 'Muu' && pb.qty === 1,
      JSON.stringify(pb));
    await jsend('POST', '/api/pantry', { name: 'Näkkileipä', best_before: '2026-12-01' });
    const plist = await jget('/api/pantry');
    ok('varasto järjestyy päiväyksen mukaan, päiväyksettömät viimeisinä',
      plist.items.map((i) => i.name).join(',') === 'Näkkileipä,Hernekeitto,Vesi', plist.items.map((i) => i.name).join(','));
    const cat = await jget('/api/pantry/catalog/6408430000258');
    ok('viivakoodi muistetaan katalogiin', cat && cat.name === 'Hernekeitto' && cat.category === 'Ruoka');
    ok('tuntematon viivakoodi palauttaa null', (await jget('/api/pantry/catalog/000')) === null);
    const pu = await jsend('PUT', `/api/pantry/${pa.id}`, { name: 'Hernekeitto 435 g', barcode: '6408430000258', category: 'Ruoka', qty: 2, best_before: '2027-01-31' });
    ok('varaston tuotetta voi muokata', pu.name === 'Hernekeitto 435 g');
    ok('muokkaus päivittää katalogin nimen', (await jget('/api/pantry/catalog/6408430000258')).name === 'Hernekeitto 435 g');
    const use1 = await jsend('POST', `/api/pantry/${pa.id}/use`, {});
    ok('käytetty 1 vähentää määrää', use1.qty === 1);
    const use2 = await jsend('POST', `/api/pantry/${pa.id}/use`, {});
    ok('viimeisen käyttö poistaa rivin', use2.removed === true && !(await jget('/api/pantry')).items.some((i) => i.id === pa.id));
    ok('katalogi säilyy vaikka tuote loppuu', (await jget('/api/pantry/catalog/6408430000258')) !== null);
    ok('olemattoman tuotteen muokkaus 404', await status('PUT', '/api/pantry/99999', { name: 'x' }) === 404);
    ok('lukija ei voi lisätä varastoon (403)', await status('POST', '/api/pantry', { name: 'x' }, V_COOKIE) === 403);
    ok('lukija näkee varaston', await status('GET', '/api/pantry', null, V_COOKIE) === 200);
    ok('varasto vaatii kirjautumisen', await status('GET', '/api/pantry', null, '') === 401);

    // --- Kauppalista + reaaliaikaiset tapahtumat ---
    ok('tapahtumavirta vaatii kirjautumisen', await status('GET', '/api/events', null, '') === 401);
    const ctrl = new AbortController();
    const evRes = await fetch(B + '/api/events', { headers: H(), signal: ctrl.signal });
    ok('tapahtumavirta on text/event-stream', (evRes.headers.get('content-type') || '').startsWith('text/event-stream'));
    const reader = evRes.body.getReader();
    const dec = new TextDecoder();
    let evText = '';
    const waitFor = async (needle, ms = 2000) => {
      const end = Date.now() + ms;
      while (!evText.includes(needle) && Date.now() < end) {
        const r = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res(null), end - Date.now()))]);
        if (!r || r.done) break;
        evText += dec.decode(r.value);
      }
      return evText.includes(needle);
    };
    await waitFor('retry:');
    ok('tyhjä tuote hylätään', await status('POST', '/api/shopping', { text: '   ' }) === 400);
    const s1x = await jsend('POST', '/api/shopping', { text: 'Maito', qty: '2 l' });
    ok('kauppalistaan lisätään tuote', s1x.id && s1x.text === 'Maito' && s1x.qty === '2 l' && s1x.added_by === 'Testi Admin');
    ok('lisäys lähettää shopping-tapahtuman muille laitteille', await waitFor('event: shopping'));
    const dupe = await jsend('POST', '/api/shopping', { text: 'maito' });
    ok('sama ostamaton tuote ei tuplaannu', dupe.duplicate === true && dupe.id === s1x.id);
    const s2x = await jsend('POST', '/api/shopping', { text: 'Leipä' });
    const done1 = await jsend('PUT', `/api/shopping/${s1x.id}`, { done: true });
    ok('ruksaus merkitsee ostajan ja ajan', done1.done_at && done1.done_by === 'Testi Admin');
    const order = await jget('/api/shopping');
    ok('ostamattomat ensin, ostetut lopussa', order[0].id === s2x.id && order[order.length - 1].id === s1x.id);
    const again = await jsend('POST', '/api/shopping', { text: 'Maito' });
    ok('ostetun tuotteen voi lisätä uudelleen uutena rivinä', again.id !== s1x.id && !again.duplicate);
    const undone = await jsend('PUT', `/api/shopping/${s1x.id}`, { done: false });
    ok('ruksin voi perua', undone.done_at === null && undone.done_by === '');
    await jsend('PUT', `/api/shopping/${s1x.id}`, { done: true });
    const cleared = await jsend('POST', '/api/shopping/clear-done', {});
    ok('tyhjennä ostetut poistaa vain ruksitut', cleared.removed === 1 && (await jget('/api/shopping')).length === 2);
    ok('lukija ei voi muokata kauppalistaa (403)', await status('POST', '/api/shopping', { text: 'x' }, V_COOKIE) === 403);
    evText = '';
    await jsend('POST', '/api/pantry', { name: 'Paristot AA', category: 'Paristot ja valo' });
    ok('varaston muutos lähettää pantry-tapahtuman', await waitFor('event: pantry'));

    // --- Kauppalistan osastot (kaupan kiertojärjestys) ---
    const K = require('../public/koti-shared');
    ok('osasto arvataan nimestä', s2x.section === 'Leipä' && again.section === 'Maito ja kylmätuotteet',
      `${s2x.section} / ${again.section}`);
    const sPar = await jsend('POST', '/api/shopping', { text: 'paristot aa' });
    ok('varastosta tuttu tuote saa osaston varaston kategoriasta', sPar.section === 'Koti ja siivous', sPar.section);
    const sDog = await jsend('POST', '/api/shopping', { text: 'Kanaherkku', category: 'Koiran tarvikkeet' });
    ok('varaston kategoria vihjeenä ohittaa nimiarvauksen', sDog.section === 'Lemmikit', sDog.section);
    const sBad = await jsend('PUT', `/api/shopping/${sDog.id}`, { section: 'Keksitty<script>' });
    ok('tuntematon osasto hylätään', sBad.section === 'Lemmikit');
    const sIce = await jsend('POST', '/api/shopping', { text: 'Jäätelö' });
    ok('pakaste tunnistetaan', sIce.section === 'Pakasteet', sIce.section);
    const sMoved = await jsend('PUT', `/api/shopping/${sIce.id}`, { section: 'Muu' });
    ok('osaston voi vaihtaa', sMoved.section === 'Muu');
    await fetch(`${B}/api/shopping/${sIce.id}`, { method: 'DELETE', headers: H() });
    const sIce2 = await jsend('POST', '/api/shopping', { text: 'JÄÄTELÖ' });
    ok('käsin valittu osasto muistetaan (ääkköset ja kirjainkoko)', sIce2.section === 'Muu', sIce2.section);
    const sDupA = await jsend('POST', '/api/shopping', { text: 'jäätelö' });
    ok('ääkkösellinen tuote ei tuplaannu kirjainkoon takia', sDupA.duplicate === true && sDupA.id === sIce2.id);
    ok('lukija ei voi vaihtaa osastoa (403)',
      await status('PUT', `/api/shopping/${sIce2.id}`, { section: 'Leipä' }, V_COOKIE) === 403);
    ok('osastojen arvaus: yhdyssanan loppuosa ratkaisee',
      K.guessSection('appelsiinimehu') === 'Juomat' && K.guessSection('maitosuklaa') === 'Makeiset ja naposteltavat'
      && K.guessSection('tonnikala') === 'Kuivatuotteet ja säilykkeet' && K.guessSection('tuntematon härpäke') === 'Muu');

    // --- Varaston tavoitemäärä ---
    const tA = await jsend('POST', '/api/pantry', { name: 'Säilykevesi', category: 'Juomavesi', qty: 2, target_qty: 4, best_before: '2028-01-01' });
    ok('tavoitemäärä tallentuu', tA.target_qty === 4 && tA.qty === 2);
    const tB = await jsend('POST', '/api/pantry', { name: 'SÄILYKEVESI', category: 'Juomavesi', qty: 1 });
    ok('uusi erä perii tuotteen tavoitteen', tB.target_qty === 4);
    await jsend('PUT', `/api/pantry/${tA.id}`, { name: 'Säilykevesi', category: 'Juomavesi', qty: 2, target_qty: 6 });
    const pantryById = async (id) => (await jget('/api/pantry')).items.find((i) => i.id === id);
    ok('tavoitteen muutos koskee tuotteen kaikkia eriä', (await pantryById(tB.id)).target_qty === 6);
    await jsend('POST', `/api/pantry/${tA.id}/use`, {});
    const tGone = await jsend('POST', `/api/pantry/${tA.id}/use`, {});
    ok('erä poistuu loppuessaan, kun tuotetta on toisessa erässä', tGone.removed === true);
    const tZero = await jsend('POST', `/api/pantry/${tB.id}/use`, {});
    ok('viimeinen erä jää muistiin määrällä 0, kun tavoite on asetettu',
      tZero.qty === 0 && !tZero.removed && tZero.best_before === '' && tZero.target_qty === 6, JSON.stringify(tZero));
    const tZero2 = await jsend('POST', `/api/pantry/${tB.id}/use`, {});
    ok('loppunutta tuotetta ei voi käyttää miinukselle', tZero2.qty === 0);
    const tC = await jsend('POST', '/api/pantry', { name: 'Säilykevesi', category: 'Juomavesi', qty: 3 });
    const tRows = (await jget('/api/pantry')).items.filter((i) => K.nameKey(i.name) === 'säilykevesi');
    ok('uusi erä korvaa loppu-rivin ja säilyttää tavoitteen', tRows.length === 1 && tRows[0].id === tC.id && tC.target_qty === 6);
    const tJunk = await jsend('POST', '/api/pantry', { name: 'Roska', qty: 0, target_qty: 'abc' });
    ok('virheellinen tavoite siivotaan nollaksi eikä määrä voi olla 0 ilman tavoitetta', tJunk.target_qty === 0 && tJunk.qty === 1);
    const tBig = await jsend('PUT', `/api/pantry/${tJunk.id}`, { name: 'Roska', qty: 1, target_qty: 99999999 });
    ok('tavoitemäärällä on yläraja', tBig.target_qty === 9999);
    const tRen = await jsend('PUT', `/api/pantry/${tJunk.id}`, { name: 'säilykevesi', qty: 1 });
    ok('toiseksi tuotteeksi nimetty rivi perii tavoitteen eikä nollaa sitä muilta',
      tRen.target_qty === 6 && (await pantryById(tC.id)).target_qty === 6);
    await jsend('PUT', `/api/pantry/${tC.id}`, { name: 'Säilykevesi', category: 'Juomavesi', qty: 3, target_qty: 0 });
    ok('tavoitteen voi poistaa, ja se poistuu tuotteen kaikilta eriltä', (await pantryById(tJunk.id)).target_qty === 0);

    // --- Toistuvat kotityöt ---
    const today = K.todayISO();
    ok('kotityöt aluksi tyhjä', (await jget('/api/chores')).length === 0);
    ok('kotityöt vaativat kirjautumisen', await status('GET', '/api/chores', null, '') === 401);
    ok('kotityö ilman nimeä hylätään', await status('POST', '/api/chores', { title: '  ' }) === 400);
    evText = '';
    const c1 = await jsend('POST', '/api/chores', { title: 'Puhdista suodatin', every_n: 3, unit: 'month', next_due: '2026-01-15', note: 'liesituuletin' });
    ok('kotityö luodaan', c1.id && c1.every_n === 3 && c1.unit === 'month' && c1.next_due === '2026-01-15'
      && c1.note === 'liesituuletin' && c1.last_done_at === '');
    ok('kotityön luoja tulee istunnosta', c1.created_by === 'Testi Admin');
    ok('kotityön muutos lähettää chores-tapahtuman', await waitFor('event: chores'));
    const c2 = await jsend('POST', '/api/chores', { title: "Robert'); DROP TABLE chores;--", every_n: -3, unit: 'vuosisata', next_due: '2026-02-30' });
    ok('virheellinen toistoväli ja päivä korvataan oletuksilla',
      c2.every_n === 1 && c2.unit === 'month' && c2.next_due === K.addInterval(today, 1, 'month'), JSON.stringify(c2));
    const cList = await jget('/api/chores');
    ok('SQL-injektio tallentuu tekstinä ja lista järjestyy eräpäivän mukaan',
      cList.length === 2 && cList[0].id === c1.id && cList[1].title.includes('DROP TABLE'));
    const cDone = await jsend('POST', `/api/chores/${c1.id}/done`, { date: today });
    ok('kuittaus laskee seuraavan kerran kuittauspäivästä',
      cDone.last_done_at === today && cDone.next_due === K.addInterval(today, 3, 'month'), JSON.stringify(cDone));
    ok('kuittaaja tulee istunnosta', cDone.last_done_by === 'Testi Admin');
    const cDone2 = await jsend('POST', `/api/chores/${c1.id}/done`, { date: '2020-01-01' });
    ok('selaimen epäuskottava päivä korvataan palvelimen päivällä', cDone2.last_done_at === today);
    const cUpd = await jsend('PUT', `/api/chores/${c1.id}`, { title: 'Puhdista suodattimet', every_n: 2, unit: 'week', next_due: '2027-03-01' });
    ok('kotityötä voi muokata', cUpd.title === 'Puhdista suodattimet' && cUpd.every_n === 2 && cUpd.unit === 'week'
      && cUpd.next_due === '2027-03-01' && cUpd.last_done_at === today);
    ok('olemattoman kotityön muokkaus ja kuittaus 404', await status('PUT', '/api/chores/99999', { title: 'x' }) === 404
      && await status('POST', '/api/chores/99999/done', {}) === 404);
    ok('lukija näkee kotityöt', await status('GET', '/api/chores', null, V_COOKIE) === 200);
    ok('lukija ei voi lisätä, kuitata eikä poistaa kotityötä (403)',
      await status('POST', '/api/chores', { title: 'x' }, V_COOKIE) === 403
      && await status('POST', `/api/chores/${c1.id}/done`, {}, V_COOKIE) === 403
      && await status('DELETE', `/api/chores/${c1.id}`, null, V_COOKIE) === 403);
    await fetch(`${B}/api/chores/${c2.id}`, { method: 'DELETE', headers: H() });
    ok('kotityön voi poistaa', (await jget('/api/chores')).length === 1);
    ok('päivälaskenta: kuun loppu ja karkausvuosi', K.addInterval('2026-01-31', 1, 'month') === '2026-02-28'
      && K.addInterval('2024-02-29', 1, 'year') === '2025-02-28' && K.addInterval('2026-12-30', 2, 'week') === '2027-01-13'
      && K.addInterval('2026-11-30', 3, 'month') === '2027-02-28');
    // Tietoturva: uudet reitit
    ok('kotitöiden kirjoitusreitit vaativat kirjautumisen (401)',
      await status('POST', '/api/chores', { title: 'x' }, '') === 401
      && await status('PUT', `/api/chores/${c1.id}`, { title: 'x' }, '') === 401
      && await status('POST', `/api/chores/${c1.id}/done`, {}, '') === 401
      && await status('DELETE', `/api/chores/${c1.id}`, null, '') === 401);
    const xssTitle = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const cX = await jsend('POST', '/api/chores', { title: xssTitle, note: 'x'.repeat(5000), unit: { $ne: null }, every_n: [9] });
    ok('kotityön kentät rajataan ja oudot tyypit siivotaan', cX.title === xssTitle && cX.note.length === 500
      && cX.unit === 'month' && cX.every_n === 9, JSON.stringify(cX).slice(0, 200));
    const cXres = await fetch(`${B}/api/chores`, { headers: H() });
    ok('kotityöt palautetaan JSON:na (ei HTML:nä) ja nosniff-otsakkeella',
      (cXres.headers.get('content-type') || '').startsWith('application/json')
      && cXres.headers.get('x-content-type-options') === 'nosniff');
    ok('pitkä kotityön nimi katkaistaan', (await jsend('PUT', `/api/chores/${cX.id}`, { title: 'y'.repeat(5000) })).title.length === 200);
    ok('taulukko pyynnön runkona ei kaada palvelinta',
      await fetch(`${B}/api/chores`, { method: 'POST', headers: H(J), body: '[1,2]' }).then((r) => r.status) === 400);
    ok('rikkinäinen JSON ei kaada palvelinta',
      [400, 500].includes(await fetch(`${B}/api/chores`, { method: 'POST', headers: H(J), body: '{"title":' }).then((r) => r.status))
      && await status('GET', '/api/chores') === 200);
    ok('SQL-injektio id-parametrissa ei vaikuta', await status('DELETE', '/api/chores/1%20OR%201=1') === 200
      && (await jget('/api/chores')).length === 2);
    await fetch(`${B}/api/chores/${cX.id}`, { method: 'DELETE', headers: H() });
    ok('osaston päättely ei hyväksy olion sisäisiä avaimia', K.guessSection('x', 'constructor') === 'Muu'
      && K.guessSection('x', '__proto__') === 'Muu'
      && (await jsend('POST', '/api/shopping', { text: 'Outo vempain', category: 'constructor' })).section === 'Muu');
    ok('jaettu sääntötiedosto tarjoillaan selaimelle', await status('GET', '/koti-shared.js', null, '') === 200);
    ctrl.abort();
    for (const r of await jget('/api/shopping')) await fetch(`${B}/api/shopping/${r.id}`, { method: 'DELETE', headers: H() });
    ok('kauppalistan rivit voi poistaa', (await jget('/api/shopping')).length === 0);
    const hdr = await fetch(B + '/', { headers: H() });
    ok('kamera sallittu vain omalle sivulle', (hdr.headers.get('permissions-policy') || '').includes('camera=(self)'));

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
