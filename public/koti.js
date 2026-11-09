'use strict';
/* ============================================================================
   Varmuusvarasto + yhteinen kauppalista + toistuvat kotityöt
   ----------------------------------------------------------------------------
   Näkymät #/varasto, #/kauppalista ja #/kotityot sekä niiden etusivun kortit.
   Säännöt (osastot, päivien laskenta) tulevat koti-shared.js:stä.
   Ladataan dashboard.js:n ja cards.js:n JÄLKEEN mutta ENNEN app.js:ää
   (Dashboard.register tarvitsee rungon; app.js:n apufunktioita kuten esc,
   icon, toast ja $ käytetään vasta ajonaikaisesti, joten järjestys riittää).

   Viivakoodin luku:
     1. Kamera videona (getUserMedia). Vaatii HTTPS:n tai localhostin.
     2. Tunnistus selaimen omalla BarcodeDetectorilla (Chrome/Android), tai
        ZXing-kirjastolla (vendor/zxing.min.js, ladataan vasta tarvittaessa),
        joka toimii myös iPhonen Safarissa.
     3. Jos kamera ei aukea (esim. http-osoite), varalla valokuva: puhelin
        avaa kameran, otat kuvan ja koodi luetaan kuvasta.
   ========================================================================== */

const Koti = (() => {
  // ---------- Yhteiset apurit ----------
  const DAY = 86400000;
  function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function daysLeft(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - today0()) / DAY);
  }
  // Osat muunnetaan luvuiksi: tulos on turvallinen HTML:ään, vaikka data olisi rikki.
  const fiDate = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return `${+d}.${+m}.${+y}`; };
  function level(dl) {
    if (dl === null) return 'none';
    if (dl < 0) return 'bad';
    if (dl <= 30) return 'warn';
    if (dl <= 90) return 'soon';
    return 'ok';
  }
  function badgeText(dl) {
    if (dl === null) return 'ei päiväystä';
    if (dl < 0) return `vanhentunut ${-dl} pv`;
    if (dl === 0) return 'vanhenee tänään';
    if (dl <= 90) return `${dl} pv jäljellä`;
    const kk = Math.round(dl / 30.4);
    return kk < 24 ? `${kk} kk jäljellä` : `${String(Math.round(dl / 36.5) / 10).replace('.', ',')} v jäljellä`;
  }
  const { SECTIONS, nameKey, todayISO } = KotiShared;
  const canEdit = () => !Store.auth || !currentUser || currentUser.role !== 'viewer';
  const onRoute = (name) => (location.hash.slice(2).split(/[/?]/)[0] || '') === name;

  // Reaaliaikainen kuuntelu: yksi aktiivinen tilaus kerrallaan. Kun käyttäjä
  // siirtyy pois näkymästä, seuraava tapahtuma lopettaa kuuntelun.
  let unsub = null;
  function listen(type, route, refresh) {
    if (unsub) unsub();
    unsub = null;
    if (!Store.events) return;
    let timer = null;
    unsub = Store.events.on(type, () => {
      if (!onRoute(route)) { if (unsub) unsub(); unsub = null; return; }
      clearTimeout(timer);
      timer = setTimeout(refresh, 150); // useampi muutos kerralla = yksi päivitys
    });
  }

  // ======================================================================
  // Kauppalista
  // ======================================================================
  let shopShowDone = false;

  // Ostettavat kaupan kiertojärjestyksessä: [[osasto, rivit], ...].
  // Tuntematon tai puuttuva osasto menee viimeiseen ("Muu").
  function bySection(open) {
    const last = SECTIONS.length - 1;
    const idx = (it) => { const i = SECTIONS.indexOf(it.section); return i === -1 ? last : i; };
    return SECTIONS.map((sec, i) => [sec, open.filter((it) => idx(it) === i)]).filter(([, rows]) => rows.length);
  }

  // Ostoehdotukset varastosta: tuote on alle tavoitemäärän tai vanhenee
  // 30 päivän sisällä. Saman nimiset erät lasketaan yhteen, ja jo listalla
  // olevat jätetään pois.
  function pantrySuggestions(pantryItems, shopItems) {
    const onList = new Set(shopItems.filter((i) => !i.done_at).map((i) => nameKey(i.text)));
    const groups = new Map();
    pantryItems.forEach((it) => {
      const key = nameKey(it.name);
      const g = groups.get(key) || { name: it.name, category: it.category, total: 0, target: 0, dl: null };
      g.total += it.qty;
      g.target = Math.max(g.target, it.target_qty || 0);
      const dl = it.qty > 0 ? daysLeft(it.best_before) : null;
      if (dl !== null && (g.dl === null || dl < g.dl)) g.dl = dl;
      groups.set(key, g);
    });
    const out = [];
    groups.forEach((g, key) => {
      if (onList.has(key)) return;
      if (g.target > 0 && g.total < g.target) {
        out.push({ name: g.name, category: g.category, qty: `${g.target - g.total} kpl`,
          why: g.total ? `varastossa ${g.total}, tavoite ${g.target}` : `loppu, tavoite ${g.target}` });
      } else if (g.dl !== null && g.dl <= 30) {
        out.push({ name: g.name, category: g.category, qty: '',
          why: g.dl < 0 ? 'vanhentunut' : g.dl === 0 ? 'vanhenee tänään' : `vanhenee ${g.dl} pv päästä` });
      }
    });
    return out;
  }

  // Lisää ehdotukset kauppalistalle; varaston kategoria kertoo osaston.
  async function addSuggestions(list) {
    for (const s of list) await Store.shopping.add(s.name, s.qty, s.category);
    toast(list.length === 1 ? `Lisätty kauppalistalle: ${list[0].name}` : `Lisätty kauppalistalle ${list.length} tuotetta`);
  }

  function shopRowHtml(it) {
    const done = !!it.done_at;
    const meta = done
      ? `ostanut ${esc(it.done_by || '')}`
      : (it.added_by ? `lisännyt ${esc(it.added_by)}` : '');
    return `<li class="shop-row${done ? ' done' : ''}" data-id="${it.id}">
      <button class="shop-check" data-shoptoggle="${it.id}" aria-pressed="${done}"
        aria-label="${done ? 'Palauta ostettavaksi' : 'Merkitse ostetuksi'}: ${esc(it.text)}"
        ${canEdit() ? '' : 'disabled'}>${done ? icon('verify') : ''}</button>
      <div class="shop-body" data-shoptoggle="${it.id}">
        <span class="shop-text">${esc(it.text)}</span>
        ${it.qty ? `<span class="shop-qty mono">${esc(it.qty)}</span>` : ''}
        ${meta ? `<span class="shop-meta">${meta}</span>` : ''}
      </div>
      ${done ? '' : `<label class="icon-btn small shop-move editor-only" title="Siirrä toiseen osastoon">
        ${catSvg('store')}<select data-shopsec="${it.id}" aria-label="Osasto: ${esc(it.text)}">
          ${SECTIONS.map((sec) => `<option${sec === it.section ? ' selected' : ''}>${esc(sec)}</option>`).join('')}
        </select></label>`}
      <button class="icon-btn small editor-only" data-shopdel="${it.id}" title="Poista rivi"
        aria-label="Poista ${esc(it.text)}">${icon('close')}</button>
    </li>`;
  }

  async function viewShopping() {
    const [items, pantry] = await Promise.all([Store.shopping.list(), Store.pantry.list()]);
    const open = items.filter((i) => !i.done_at);
    const done = items.filter((i) => i.done_at);
    // Kirjoitusehdotukset aiemmin ostetuista (nopea uudelleenlisäys).
    const suggestions = [...new Set(done.map((i) => i.text))].slice(0, 40);
    const fromPantry = pantrySuggestions(pantry.items, items);
    const live = Store.events ? '<span class="live-dot" title="Muutokset näkyvät heti kaikilla laitteilla"></span>Päivittyy reaaliajassa' : 'Demo: tallentuu vain tähän selaimeen';
    content.innerHTML = `
      <div class="koti-head">
        <h2>${icon('cart', 'ic-lg')} Kauppalista</h2>
        <span class="koti-live">${live}</span>
      </div>
      <form class="card shop-add editor-only" id="shopAddForm" autocomplete="off">
        <input type="text" id="shopText" placeholder="Lisää tuote, esim. maito" list="shopSuggest" maxlength="200" />
        <input type="text" id="shopQty" placeholder="Määrä" maxlength="40" class="shop-qty-in" />
        <button class="btn" type="submit">Lisää</button>
        <datalist id="shopSuggest">${suggestions.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      </form>
      ${fromPantry.length ? `<div class="card shop-card" id="shopSuggestCard">
        <div class="spread"><h3 style="margin:0">${icon('box')} Ehdotukset varastosta (${fromPantry.length})</h3>
          <button class="btn small secondary editor-only" id="sugAll">Lisää kaikki</button></div>
        <ul class="shop-list">${fromPantry.map((s, i) => `<li class="shop-row">
          <div class="shop-body sug-body"><span class="shop-text">${esc(s.name)}</span>
            ${s.qty ? `<span class="shop-qty mono">${esc(s.qty)}</span>` : ''}
            <span class="shop-meta">${esc(s.why)}</span></div>
          <button class="btn small secondary editor-only" data-sugadd="${i}"
            aria-label="Lisää kauppalistalle: ${esc(s.name)}">Lisää</button></li>`).join('')}</ul>
      </div>` : ''}
      <div class="card shop-card">
        <div class="spread"><h3 style="margin:0">Ostettavat (${open.length})</h3>
          ${open.length ? '<span class="muted shop-hint">kaupan kiertojärjestyksessä</span>' : ''}</div>
        <ul class="shop-list" id="shopOpen">
          ${bySection(open).map(([sec, rows]) => `<li class="shop-sec">${esc(sec)}</li>${rows.map(shopRowHtml).join('')}`).join('')
            || '<li class="empty">Lista on tyhjä. Lisää ensimmäinen tuote yllä.</li>'}
        </ul>
      </div>
      ${done.length ? `<div class="card shop-card">
        <div class="spread">
          <button class="linkish" id="shopDoneToggle" aria-expanded="${shopShowDone}">
            Ostettu (${done.length}) ${shopShowDone ? '▴' : '▾'}</button>
          <button class="btn small secondary editor-only" id="shopClearDone">Tyhjennä ostetut</button>
        </div>
        ${shopShowDone ? `<ul class="shop-list">${done.map(shopRowHtml).join('')}</ul>` : ''}
      </div>` : ''}`;

    const form = $('#shopAddForm');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#shopText').value.trim();
      if (!text) return toast('Kirjoita tuote', true);
      try {
        const r = await Store.shopping.add(text, $('#shopQty').value.trim());
        if (r && r.duplicate) toast('Tuote on jo listalla');
        await viewShopping();
        const t = $('#shopText'); if (t) t.focus();
      } catch (err) { toast(err.message, true); }
    };
    content.querySelectorAll('[data-shoptoggle]').forEach((el) => el.onclick = async () => {
      if (!canEdit()) return;
      const id = +el.dataset.shoptoggle;
      const it = items.find((x) => x.id === id);
      const row = el.closest('.shop-row');
      if (row) row.classList.toggle('done'); // välitön palaute ennen palvelinta
      try { await Store.shopping.update(id, { done: !it.done_at }); await viewShopping(); }
      catch (err) { toast(err.message, true); viewShopping(); }
    });
    content.querySelectorAll('[data-shopsec]').forEach((sel) => sel.onchange = async () => {
      try { await Store.shopping.update(+sel.dataset.shopsec, { section: sel.value }); viewShopping(); }
      catch (err) { toast(err.message, true); }
    });
    const addSug = async (list) => {
      try { await addSuggestions(list); viewShopping(); } catch (err) { toast(err.message, true); }
    };
    content.querySelectorAll('[data-sugadd]').forEach((b) => b.onclick = () => addSug([fromPantry[+b.dataset.sugadd]]));
    const sugAll = $('#sugAll');
    if (sugAll) sugAll.onclick = () => addSug(fromPantry);
    content.querySelectorAll('[data-shopdel]').forEach((b) => b.onclick = async () => {
      try { await Store.shopping.remove(+b.dataset.shopdel); viewShopping(); }
      catch (err) { toast(err.message, true); }
    });
    const tg = $('#shopDoneToggle');
    if (tg) tg.onclick = () => { shopShowDone = !shopShowDone; viewShopping(); };
    const clr = $('#shopClearDone');
    if (clr) clr.onclick = async () => {
      try { const r = await Store.shopping.clearDone(); toast(`Poistettu ${r.removed} ostettua`); viewShopping(); }
      catch (err) { toast(err.message, true); }
    };
    listen('shopping', 'kauppalista', () => {
      // Ei pyyhitä kesken olevaa kirjoitusta: päivitetään vain lista.
      const t = $('#shopText'), q = $('#shopQty');
      const keep = t ? { text: t.value, qty: q.value, focus: document.activeElement === t } : null;
      viewShopping().then(() => {
        if (!keep) return;
        $('#shopText').value = keep.text; $('#shopQty').value = keep.qty;
        if (keep.focus) $('#shopText').focus();
      });
    });
  }

  // category = varaston kategoria (valinnainen vihje osaston päättelyyn).
  async function addToShopping(text, category) {
    try {
      const r = await Store.shopping.add(text, '', category);
      toast(r && r.duplicate ? 'Tuote on jo kauppalistalla' : 'Lisätty kauppalistalle');
    } catch (err) { toast(err.message, true); }
  }

  // ======================================================================
  // Viivakoodin luku
  // ======================================================================
  const Scanner = (() => {
    let stream = null, timer = null, stopped = true;

    function loadZxing() {
      if (window.ZXing) return Promise.resolve(window.ZXing);
      if (Store.mode !== 'server') return Promise.reject(new Error('ZXing ei ole käytössä demoversiossa'));
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/zxing.min.js';
        s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('ZXing ei latautunut')));
        s.onerror = () => reject(new Error('ZXing ei latautunut'));
        document.head.appendChild(s);
      });
    }

    async function makeDecoder() {
      // 1) Selaimen oma tunnistin, jos se osaa EAN-koodit.
      if ('BarcodeDetector' in window) {
        try {
          const fmts = await window.BarcodeDetector.getSupportedFormats();
          if (fmts.includes('ean_13')) {
            const det = new window.BarcodeDetector({ formats: fmts.filter((f) => /ean|upc|code_128|code_39|itf|qr/.test(f)) });
            return async (source) => {
              const r = await det.detect(source);
              return r && r.length ? r[0].rawValue : null;
            };
          }
        } catch (_) { /* siirrytään ZXingiin */ }
      }
      // 2) ZXing (myös iPhone).
      const Z = await loadZxing();
      const hints = new Map();
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
        Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39,
        Z.BarcodeFormat.ITF]);
      const reader = new Z.MultiFormatReader();
      reader.setHints(hints);
      return async (canvas) => {
        try {
          const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
          return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(lum))).getText();
        } catch (_) { return null; } finally { reader.reset(); }
      };
    }

    // Kuvasta/videosta canvakselle (videosta keskialue, jossa koodi on).
    function frame(src, crop) {
      const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight;
      if (!w || !h) return null;
      const c = document.createElement('canvas');
      if (crop) {
        const cw = Math.round(w * 0.9), ch = Math.round(h * 0.5);
        const s = Math.min(1, 1280 / cw);
        c.width = Math.round(cw * s); c.height = Math.round(ch * s);
        c.getContext('2d').drawImage(src, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, c.width, c.height);
      } else {
        const s = Math.min(1, 1600 / Math.max(w, h));
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      }
      return c;
    }

    function stop() {
      stopped = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    // Avaa kameran annettuun <video>-elementtiin ja kutsuu onCode(koodi) kun
    // koodi löytyy. Heittää virheen, jos kamera ei ole käytettävissä.
    async function start(video, onCode) {
      stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('no-camera');
      }
      const decode = await makeDecoder();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
      stopped = false;
      const tick = async () => {
        if (stopped) return;
        let code = null;
        try {
          const c = frame(video, true);
          if (c) code = await decode(c);
        } catch (_) {}
        if (stopped) return;
        if (code) { stop(); if (navigator.vibrate) navigator.vibrate(60); onCode(code); return; }
        timer = setTimeout(tick, 220);
      };
      tick();
    }

    // Varatie: valokuvasta.
    async function fromFile(file) {
      const decode = await makeDecoder();
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => {
          const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Kuvaa ei voitu avata')); i.src = url;
        });
        for (const crop of [false, true]) {
          const c = frame(img, crop);
          const code = c && await decode(c);
          if (code) return code;
        }
        return null;
      } finally { URL.revokeObjectURL(url); }
    }

    return { start, stop, fromFile };
  })();

  // ======================================================================
  // Varmuusvarasto
  // ======================================================================
  // ranOut = juuri loppunut tuote, jolle tarjotaan lisäystä kauppalistalle.
  const pantryUi = { filter: 'Kaikki', form: null, scanning: false, confirmDel: null, ranOut: null };
  const blankPantryForm = () => ({ id: null, name: '', best_before: '', qty: 1, category: 'Ruoka', barcode: '', target_qty: 0 });

  function pantryItemHtml(it) {
    const out = it.qty === 0; // loppu: rivi on jäljellä vain tavoitemäärän takia
    const dl = daysLeft(it.best_before), lv = out ? 'bad' : level(dl);
    const acts = canEdit() ? (pantryUi.confirmDel === it.id
      ? `<span class="muted">Poistetaanko?</span>
         <button class="btn small danger" data-pdel="${it.id}">Poista</button>
         <button class="btn small secondary" data-pnodel>Peruuta</button>`
      : `${out ? '' : `<button class="btn small secondary" data-puse="${it.id}">Käytetty 1</button>`}
         <button class="btn small secondary" data-pshop="${it.id}">${icon('cart')} Listalle</button>
         <button class="btn small secondary" data-pedit="${it.id}">Muokkaa</button>
         <button class="icon-btn small" data-paskdel="${it.id}" title="Poista" aria-label="Poista ${esc(it.name)}">${icon('trash')}</button>`)
      : '';
    return `<div class="pantry-item lv-${lv}">
      <div class="spread pantry-top">
        <div>
          <div class="pantry-name">${esc(it.name)}</div>
          <div class="pantry-meta">${esc(it.category)} · ${esc(it.qty)} kpl${it.target_qty ? ` · tavoite ${esc(it.target_qty)}` : ''}${it.best_before ? ' · pe ' + fiDate(it.best_before) : ''}</div>
        </div>
        <span class="pbadge lv-${lv}">${out ? 'loppu' : badgeText(dl)}</span>
      </div>
      ${acts ? `<div class="pantry-acts">${acts}</div>` : ''}
    </div>`;
  }

  function pantryFormHtml(f, categories) {
    return `<div class="card pantry-form" id="pantryForm">
      <h3 style="margin-top:0">${f.id ? 'Muokkaa tuotetta' : 'Uusi tuote'}</h3>
      <div class="field"><label for="pfName">Nimi</label>
        <input type="text" id="pfName" maxlength="200" value="${esc(f.name)}" placeholder="esim. Hernekeitto 435 g" /></div>
      <div class="pf-row">
        <div class="field"><label for="pfBb">Parasta ennen</label>
          <input type="date" id="pfBb" value="${esc(f.best_before)}" /></div>
        <div class="field"><label for="pfQty">Määrä (kpl)</label>
          <input type="number" id="pfQty" min="0" max="9999" inputmode="numeric" value="${esc(f.qty)}" /></div>
      </div>
      <div class="field"><label for="pfTarget">Tavoitemäärä (kpl)</label>
        <input type="number" id="pfTarget" min="0" max="9999" inputmode="numeric" value="${f.target_qty ? esc(f.target_qty) : ''}" placeholder="ei tavoitetta" />
        <div class="muted pf-hint">Kun tuotetta on varastossa vähemmän, kauppalista ehdottaa sen ostamista.</div></div>
      <div class="field"><label for="pfCat">Kategoria</label>
        <select id="pfCat">${categories.map((c) => `<option${c === f.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="pfCode">Viivakoodi</label>
        <div class="pf-code"><input type="text" id="pfCode" inputmode="numeric" maxlength="64" value="${esc(f.barcode)}" placeholder="valinnainen" />
        <button class="btn small secondary" id="pfScan" type="button">${icon('camera')} Skannaa</button></div></div>
      <div class="row">
        <button class="btn" id="pfSave">Tallenna</button>
        <button class="btn secondary" id="pfCancel">Peruuta</button>
      </div>
    </div>`;
  }

  const scannerHtml = () => `<div class="card scanner" id="scanner">
      <div class="scan-view"><video id="scanVideo" playsinline muted></video><div class="scan-frame"></div></div>
      <p class="muted" id="scanMsg">Osoita viivakoodia kameralla. Pidä puhelin vakaana noin 10–20 cm päässä.</p>
      <div class="row">
        <button class="btn secondary" id="scanStop">Lopeta</button>
        <label class="btn secondary" for="scanFile">Ota valokuva</label>
        <input type="file" id="scanFile" accept="image/*" capture="environment" hidden />
      </div>
    </div>`;

  function readForm() {
    return {
      id: pantryUi.form && pantryUi.form.id,
      name: $('#pfName').value.trim(),
      best_before: $('#pfBb').value,
      qty: $('#pfQty').value === '' ? 1 : +$('#pfQty').value,
      category: $('#pfCat').value,
      barcode: $('#pfCode').value.trim(),
      target_qty: +$('#pfTarget').value || 0,
    };
  }

  // Koodi luettu → täytetään lomake (tuttu tuote nimineen).
  async function onBarcode(code) {
    pantryUi.scanning = false;
    const keep = $('#pantryForm') ? readForm() : null;
    const f = keep || blankPantryForm();
    f.barcode = code;
    let known = null;
    try { known = await Store.pantry.lookup(code); } catch (_) {}
    if (known) { if (!f.name) f.name = known.name; f.category = known.category; }
    pantryUi.form = f;
    await viewPantry();
    toast(known ? `Tuttu tuote: ${known.name}` : 'Viivakoodi luettu. Anna tuotteelle nimi, se muistetaan jatkossa.');
    const target = known ? $('#pfBb') : $('#pfName');
    if (target) target.focus();
  }

  async function openScanner() {
    if ($('#pantryForm')) pantryUi.form = readForm();
    pantryUi.scanning = true;
    await viewPantry();
  }

  async function viewPantry() {
    Scanner.stop();
    const [{ categories, items }, shopItems] = await Promise.all([Store.pantry.list(), Store.shopping.list()]);
    const toBuy = pantrySuggestions(items, shopItems);
    let nExp = 0, nSoon = 0, total = 0;
    items.forEach((it) => {
      total += it.qty;
      const dl = daysLeft(it.best_before);
      if (dl !== null && dl < 0) nExp++; else if (dl !== null && dl <= 30) nSoon++;
    });
    const used = categories.filter((c) => items.some((it) => it.category === c));
    if (pantryUi.filter !== 'Kaikki' && !used.includes(pantryUi.filter)) pantryUi.filter = 'Kaikki';
    const list = items.filter((it) => pantryUi.filter === 'Kaikki' || it.category === pantryUi.filter);
    const showActions = canEdit() && !pantryUi.form && !pantryUi.scanning;

    content.innerHTML = `
      <div class="koti-head"><h2>${icon('box', 'ic-lg')} Varmuusvarasto</h2></div>
      <p class="muted">Kotivaran päiväysseuranta. Skannaa viivakoodi, lisää päiväys ja käytä vanhimmat ensin.</p>
      <div class="pantry-stats">
        <div class="pstat"><b>${total}</b><span>kpl varastossa</span></div>
        <div class="pstat${nSoon ? ' warn' : ''}"><b>${nSoon}</b><span>vanhenee 30 pv sisällä</span></div>
        <div class="pstat${nExp ? ' bad' : ''}"><b>${nExp}</b><span>vanhentunut</span></div>
      </div>
      ${showActions ? `<div class="pantry-actions">
        <button class="btn" id="pScanBtn">${icon('camera')} Skannaa viivakoodi</button>
        <button class="btn secondary" id="pAddBtn">${icon('add')} Lisää käsin</button>
      </div>` : ''}
      ${pantryUi.ranOut ? `<div class="card pantry-note" id="pantryRanOut">
        <span><b>${esc(pantryUi.ranOut.name)}</b> loppui varastosta.</span>
        <span class="row"><button class="btn small editor-only" id="ranOutAdd">${icon('cart')} Lisää kauppalistalle</button>
          <button class="btn small secondary" id="ranOutClose">Sulje</button></span>
      </div>` : ''}
      ${toBuy.length ? `<div class="card pantry-note" id="pantryToBuy">
        <span><b>Ostettavaa: ${toBuy.length} ${toBuy.length === 1 ? 'tuote' : 'tuotetta'}.</b>
          ${esc(toBuy.slice(0, 4).map((s) => s.name).join(', '))}${toBuy.length > 4 ? ' ja muita' : ''}</span>
        <button class="btn small editor-only" id="toBuyAll">${icon('cart')} Lisää kauppalistalle</button>
      </div>` : ''}
      ${pantryUi.scanning ? scannerHtml() : ''}
      ${pantryUi.form && !pantryUi.scanning ? pantryFormHtml(pantryUi.form, categories) : ''}
      ${items.length ? `<div class="pchips">${['Kaikki', ...used].map((c) =>
        `<button class="pchip${c === pantryUi.filter ? ' on' : ''}" data-pfilter="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      <div id="pantryList">
        ${list.map(pantryItemHtml).join('') || `<div class="card empty">${items.length
          ? 'Ei tuotteita tässä kategoriassa.' : 'Varasto on tyhjä. Aloita skannaamalla ensimmäinen tuote.'}</div>`}
      </div>`;

    // --- Toiminnot ---
    const scanBtn = $('#pScanBtn');
    if (scanBtn) scanBtn.onclick = openScanner;
    const addBtn = $('#pAddBtn');
    if (addBtn) addBtn.onclick = () => {
      pantryUi.form = blankPantryForm();
      viewPantry().then(() => $('#pfName') && $('#pfName').focus());
    };

    if (pantryUi.scanning) {
      const msg = $('#scanMsg');
      $('#scanStop').onclick = () => { Scanner.stop(); pantryUi.scanning = false; viewPantry(); };
      $('#scanFile').onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        msg.textContent = 'Luetaan kuvaa…';
        try {
          const code = await Scanner.fromFile(file);
          if (code) { Scanner.stop(); return onBarcode(code); }
          msg.textContent = 'Viivakoodia ei löytynyt kuvasta. Kuvaa koodi lähempää ja suoraan edestä.';
        } catch (err) { msg.textContent = 'Kuvan luku ei onnistunut: ' + err.message; }
      };
      Scanner.start($('#scanVideo'), onBarcode).catch((err) => {
        const v = $('.scan-view'); if (v) v.hidden = true;
        if (!msg) return;
        msg.textContent = err && err.name === 'NotAllowedError'
          ? 'Kameran käyttö estettiin. Salli kamera selaimen asetuksista tai ota valokuva.'
          : (location.protocol !== 'https:' && location.hostname !== 'localhost')
            ? 'Suora kamerakuva vaatii HTTPS-osoitteen. Ota sen sijaan valokuva viivakoodista.'
            : 'Kamera ei avautunut. Ota sen sijaan valokuva viivakoodista.';
      });
    }

    if ($('#pantryForm')) {
      $('#pfScan').onclick = openScanner;
      $('#pfCancel').onclick = () => { pantryUi.form = null; viewPantry(); };
      $('#pfSave').onclick = async () => {
        const f = readForm();
        if (!f.name) return toast('Anna tuotteelle nimi', true);
        try {
          if (f.id) await Store.pantry.update(f.id, f); else await Store.pantry.create(f);
          toast(f.id ? 'Päivitetty' : `Lisätty: ${f.name}`);
          pantryUi.form = null;
          viewPantry();
        } catch (err) { toast(err.message, true); }
      };
    }

    content.querySelectorAll('[data-pfilter]').forEach((b) => b.onclick = () => { pantryUi.filter = b.dataset.pfilter; viewPantry(); });
    const byId = (id) => items.find((x) => x.id === +id);
    content.querySelectorAll('[data-puse]').forEach((b) => b.onclick = async () => {
      const it = byId(b.dataset.puse);
      try {
        const r = await Store.pantry.useOne(it.id);
        // Rivi poistui kokonaan: tarjotaan lisäystä kauppalistalle. (Tavoitteellinen
        // tuote jää näkyviin "loppu"-tilassa ja tulee ostoehdotuksiin.)
        if (r && r.removed && !items.some((x) => x.id !== it.id && nameKey(x.name) === nameKey(it.name))) {
          pantryUi.ranOut = { name: it.name, category: it.category };
        }
        viewPantry();
      } catch (err) { toast(err.message, true); }
    });
    const ranOutAdd = $('#ranOutAdd');
    if (ranOutAdd) ranOutAdd.onclick = async () => {
      await addToShopping(pantryUi.ranOut.name, pantryUi.ranOut.category);
      pantryUi.ranOut = null; viewPantry();
    };
    const ranOutClose = $('#ranOutClose');
    if (ranOutClose) ranOutClose.onclick = () => { pantryUi.ranOut = null; viewPantry(); };
    const toBuyAll = $('#toBuyAll');
    if (toBuyAll) toBuyAll.onclick = async () => {
      try { await addSuggestions(toBuy); viewPantry(); } catch (err) { toast(err.message, true); }
    };
    content.querySelectorAll('[data-pshop]').forEach((b) => b.onclick = async () => {
      const it = byId(b.dataset.pshop);
      await addToShopping(it.name, it.category);
      viewPantry();
    });
    content.querySelectorAll('[data-pedit]').forEach((b) => b.onclick = () => {
      const it = byId(b.dataset.pedit);
      pantryUi.form = { id: it.id, name: it.name, best_before: it.best_before, qty: it.qty, category: it.category,
        barcode: it.barcode, target_qty: it.target_qty || 0 };
      viewPantry().then(() => window.scrollTo({ top: 0 }));
    });
    content.querySelectorAll('[data-paskdel]').forEach((b) => b.onclick = () => { pantryUi.confirmDel = +b.dataset.paskdel; viewPantry(); });
    content.querySelectorAll('[data-pnodel]').forEach((b) => b.onclick = () => { pantryUi.confirmDel = null; viewPantry(); });
    content.querySelectorAll('[data-pdel]').forEach((b) => b.onclick = async () => {
      try { await Store.pantry.remove(+b.dataset.pdel); pantryUi.confirmDel = null; toast('Poistettu'); viewPantry(); }
      catch (err) { toast(err.message, true); }
    });

    // Toisen laitteen muutokset: päivitetään vain kun lomake tai kamera ei ole auki.
    listen('pantry', 'varasto', () => { if (!pantryUi.form && !pantryUi.scanning) viewPantry(); });
  }

  // Kun käyttäjä poistuu varastosta kesken skannauksen, kamera sammuu.
  window.addEventListener('hashchange', () => {
    if (!onRoute('varasto')) {
      Scanner.stop();
      Object.assign(pantryUi, { scanning: false, form: null, confirmDel: null, ranOut: null });
    }
    if (!onRoute('kotityot')) Object.assign(choreUi, { form: null, confirmDel: null });
  });

  // ======================================================================
  // Toistuvat kotityöt
  // ======================================================================
  const choreUi = { form: null, confirmDel: null };
  const UNIT_EVERY = { day: 'päivittäin', week: 'viikoittain', month: 'kuukausittain', year: 'vuosittain' };
  const UNIT_GEN = { day: 'päivän', week: 'viikon', month: 'kuukauden', year: 'vuoden' };
  const everyText = (c) => (c.every_n === 1 ? UNIT_EVERY[c.unit] : `${c.every_n} ${UNIT_GEN[c.unit]} välein`);
  function choreLevel(dl) { return dl < 0 ? 'bad' : dl <= 7 ? 'warn' : dl <= 30 ? 'soon' : 'ok'; }
  function choreBadge(c) {
    const dl = daysLeft(c.next_due);
    if (dl < 0) return `myöhässä ${-dl} pv`;
    if (dl === 0) return 'tänään';
    if (dl === 1) return 'huomenna';
    return dl <= 30 ? `${dl} pv päästä` : fiDate(c.next_due);
  }

  async function markChoreDone(id) {
    const c = await Store.chores.done(id, todayISO());
    toast(`Kuitattu tehdyksi. Seuraava kerta ${fiDate(c.next_due)}`);
  }

  function choreHtml(c) {
    const lv = choreLevel(daysLeft(c.next_due));
    const acts = canEdit() ? (choreUi.confirmDel === c.id
      ? `<span class="muted">Poistetaanko?</span>
         <button class="btn small danger" data-cdel="${c.id}">Poista</button>
         <button class="btn small secondary" data-cnodel>Peruuta</button>`
      : `<button class="btn small" data-cdone="${c.id}">${icon('verify')} Tehty</button>
         <button class="btn small secondary" data-cedit="${c.id}">Muokkaa</button>
         <button class="icon-btn small" data-caskdel="${c.id}" title="Poista" aria-label="Poista ${esc(c.title)}">${icon('trash')}</button>`)
      : '';
    const last = c.last_done_at
      ? ` · viimeksi ${fiDate(c.last_done_at)}${c.last_done_by ? ' (' + esc(c.last_done_by) + ')' : ''}` : '';
    return `<div class="pantry-item chore lv-${lv}">
      <div class="spread pantry-top">
        <div>
          <div class="pantry-name">${esc(c.title)}</div>
          <div class="pantry-meta">${esc(everyText(c))} · seuraava ${fiDate(c.next_due)}${last}</div>
          ${c.note ? `<div class="chore-note">${esc(c.note)}</div>` : ''}
        </div>
        <span class="pbadge lv-${lv}">${choreBadge(c)}</span>
      </div>
      ${acts ? `<div class="pantry-acts">${acts}</div>` : ''}
    </div>`;
  }

  function choreFormHtml(f) {
    return `<div class="card pantry-form" id="choreForm">
      <h3 style="margin-top:0">${f.id ? 'Muokkaa tehtävää' : 'Uusi toistuva tehtävä'}</h3>
      <div class="field"><label for="cfTitle">Tehtävä</label>
        <input type="text" id="cfTitle" maxlength="200" value="${esc(f.title)}" placeholder="esim. Vaihda palovaroittimen paristo" /></div>
      <div class="pf-row">
        <div class="field"><label for="cfEvery">Toistuu</label>
          <input type="number" id="cfEvery" min="1" max="999" inputmode="numeric" value="${esc(f.every_n)}" /></div>
        <div class="field"><label for="cfUnit">välein</label>
          <select id="cfUnit">${Object.keys(UNIT_GEN).map((u) =>
            `<option value="${u}"${u === f.unit ? ' selected' : ''}>${UNIT_GEN[u]}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="cfDue">Seuraava kerta</label>
        <input type="date" id="cfDue" value="${esc(f.next_due)}" />
        <div class="muted pf-hint">Jos jätät tyhjäksi, päivä lasketaan tästä päivästä toistovälin päähän.</div></div>
      <div class="field"><label for="cfNote">Lisätieto</label>
        <input type="text" id="cfNote" maxlength="500" value="${esc(f.note)}" placeholder="valinnainen, esim. pariston tyyppi 9 V" /></div>
      <div class="row">
        <button class="btn" id="cfSave">Tallenna</button>
        <button class="btn secondary" id="cfCancel">Peruuta</button>
      </div>
    </div>`;
  }

  async function viewChores() {
    const chores = await Store.chores.list();
    const late = chores.filter((c) => daysLeft(c.next_due) < 0).length;
    const week = chores.filter((c) => { const dl = daysLeft(c.next_due); return dl >= 0 && dl <= 7; }).length;
    content.innerHTML = `
      <div class="koti-head"><h2>${icon('repeat', 'ic-lg')} Kotityöt</h2></div>
      <p class="muted">Toistuvat huollot ja kotityöt. Kun merkitset tehtävän tehdyksi, seuraava kerta lasketaan siitä päivästä.</p>
      <div class="pantry-stats">
        <div class="pstat"><b>${chores.length}</b><span>tehtävää</span></div>
        <div class="pstat${week ? ' warn' : ''}"><b>${week}</b><span>viikon sisällä</span></div>
        <div class="pstat${late ? ' bad' : ''}"><b>${late}</b><span>myöhässä</span></div>
      </div>
      ${canEdit() && !choreUi.form ? `<div class="pantry-actions one">
        <button class="btn" id="cAddBtn">${icon('add')} Lisää tehtävä</button></div>` : ''}
      ${choreUi.form ? choreFormHtml(choreUi.form) : ''}
      <div id="choreList">
        ${chores.map(choreHtml).join('') || '<div class="card empty">Ei tehtäviä vielä. Lisää ensimmäinen, esimerkiksi palovaroittimen pariston vaihto kerran vuodessa.</div>'}
      </div>`;

    const addBtn = $('#cAddBtn');
    if (addBtn) addBtn.onclick = () => {
      choreUi.form = { id: null, title: '', note: '', every_n: 1, unit: 'month', next_due: '' };
      viewChores().then(() => $('#cfTitle') && $('#cfTitle').focus());
    };
    if ($('#choreForm')) {
      $('#cfCancel').onclick = () => { choreUi.form = null; viewChores(); };
      $('#cfSave').onclick = async () => {
        const f = {
          title: $('#cfTitle').value.trim(), note: $('#cfNote').value.trim(),
          every_n: +$('#cfEvery').value || 1, unit: $('#cfUnit').value, next_due: $('#cfDue').value,
        };
        if (!f.title) return toast('Anna tehtävälle nimi', true);
        try {
          const id = choreUi.form.id;
          if (id) await Store.chores.update(id, f); else await Store.chores.create(f);
          toast(id ? 'Päivitetty' : `Lisätty: ${f.title}`);
          choreUi.form = null;
          viewChores();
        } catch (err) { toast(err.message, true); }
      };
    }
    content.querySelectorAll('[data-cdone]').forEach((b) => b.onclick = async () => {
      try { await markChoreDone(+b.dataset.cdone); viewChores(); } catch (err) { toast(err.message, true); }
    });
    content.querySelectorAll('[data-cedit]').forEach((b) => b.onclick = () => {
      const c = chores.find((x) => x.id === +b.dataset.cedit);
      choreUi.form = { id: c.id, title: c.title, note: c.note, every_n: c.every_n, unit: c.unit, next_due: c.next_due };
      viewChores().then(() => window.scrollTo({ top: 0 }));
    });
    content.querySelectorAll('[data-caskdel]').forEach((b) => b.onclick = () => { choreUi.confirmDel = +b.dataset.caskdel; viewChores(); });
    content.querySelectorAll('[data-cnodel]').forEach((b) => b.onclick = () => { choreUi.confirmDel = null; viewChores(); });
    content.querySelectorAll('[data-cdel]').forEach((b) => b.onclick = async () => {
      try { await Store.chores.remove(+b.dataset.cdel); choreUi.confirmDel = null; toast('Poistettu'); viewChores(); }
      catch (err) { toast(err.message, true); }
    });

    // Toisen laitteen muutokset: ei päivitetä kesken lomakkeen täytön.
    listen('chores', 'kotityot', () => { if (!choreUi.form) viewChores(); });
  }

  // ======================================================================
  // Etusivun kortit
  // ======================================================================
  Dashboard.register({
    id: 'kauppalista',
    title: 'Kauppalista',
    slot: 'rail',
    order: 5,
    icon: 'cart',
    headExtra: '<a class="d2-more" href="#/kauppalista">Avaa</a>',
    load: () => Store.shopping.list(),
    render: (items) => {
      const open = bySection(items.filter((i) => !i.done_at)).flatMap(([, list]) => list);
      const rows = open.slice(0, 8).map((i) => `<li><span>${esc(i.text)}</span>${i.qty ? `<span class="mono">${esc(i.qty)}</span>` : ''}</li>`).join('');
      return `<div class="dash-shop">
        ${open.length ? `<ul>${rows}</ul>${open.length > 8 ? `<div class="dash-more muted">+ ${open.length - 8} muuta</div>` : ''}`
          : '<div class="dash-empty">Kauppalista on tyhjä.</div>'}
        ${canEdit() ? `<form class="dash-shop-add" autocomplete="off">
          <input type="text" placeholder="Lisää tuote…" maxlength="200" aria-label="Lisää tuote kauppalistalle" />
          <button class="btn small" type="submit">Lisää</button></form>` : ''}
      </div>`;
    },
    bind: (el) => {
      const f = el.querySelector('.dash-shop-add');
      if (!f) return;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const inp = f.querySelector('input');
        const text = inp.value.trim();
        if (!text) return;
        await addToShopping(text);
        if (onRoute('')) viewHome();
      };
    },
  });

  Dashboard.register({
    id: 'varasto',
    title: 'Varasto: vanhenee pian',
    slot: 'rail',
    order: 6,
    icon: 'box',
    headExtra: '<a class="d2-more" href="#/varasto">Avaa</a>',
    load: () => Store.pantry.list(),
    render: ({ items }) => {
      const soon = items
        .map((it) => ({ it, dl: daysLeft(it.best_before) }))
        .filter((x) => x.dl !== null && x.dl <= 90)
        .slice(0, 5);
      if (!items.length) return '<div class="dash-empty">Varasto on tyhjä. <a href="#/varasto">Lisää tuotteita</a>.</div>';
      if (!soon.length) return '<div class="dash-empty">Ei vanhenevia tuotteita seuraavaan 90 päivään.</div>';
      return `<ul class="dash-pantry">${soon.map(({ it, dl }) =>
        `<li><span>${esc(it.name)}</span><span class="pbadge lv-${level(dl)}">${badgeText(dl)}</span></li>`).join('')}</ul>`;
    },
  });

  // Kotityöt: myöhässä olevat ja kahden viikon sisällä erääntyvät, kuittaus suoraan kortista.
  Dashboard.register({
    id: 'kotityot',
    title: 'Kotityöt',
    slot: 'main',
    order: 25,
    icon: 'repeat',
    headExtra: '<a class="d2-more" href="#/kotityot">Kaikki</a>',
    load: () => Store.chores.list(),
    render: (chores) => {
      if (!chores.length) return '<div class="dash-empty">Ei toistuvia kotitöitä. <a href="#/kotityot">Lisää ensimmäinen</a>.</div>';
      const due = chores.filter((c) => daysLeft(c.next_due) <= 14).slice(0, 5);
      if (!due.length) {
        return `<div class="dash-empty">Ei tehtävää kahden viikon sisällä. Seuraavana: ${esc(chores[0].title)}, ${fiDate(chores[0].next_due)}.</div>`;
      }
      return `<ul class="dash-chores">${due.map((c) => `<li>
        <span class="dash-chore-title">${esc(c.title)}</span>
        <span class="pbadge lv-${choreLevel(daysLeft(c.next_due))}">${choreBadge(c)}</span>
        ${canEdit() ? `<button class="btn small secondary" data-choredone="${c.id}" aria-label="Merkitse tehdyksi: ${esc(c.title)}">Tehty</button>` : ''}
      </li>`).join('')}</ul>`;
    },
    bind: (el) => el.querySelectorAll('[data-choredone]').forEach((b) => b.onclick = async () => {
      try { await markChoreDone(+b.dataset.choredone); if (onRoute('')) viewHome(); }
      catch (err) { toast(err.message, true); }
    }),
  });

  return { viewPantry, viewShopping, viewChores };
})();
