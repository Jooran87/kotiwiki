'use strict';
/* ============================================================================
   Varmuusvarasto + yhteinen kauppalista
   ----------------------------------------------------------------------------
   Näkymät #/varasto ja #/kauppalista sekä niiden etusivun kortit.
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
  const fiDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d}.${+m}.${y}`; };
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
      <button class="icon-btn small editor-only" data-shopdel="${it.id}" title="Poista rivi"
        aria-label="Poista ${esc(it.text)}">${icon('close')}</button>
    </li>`;
  }

  async function viewShopping() {
    const items = await Store.shopping.list();
    const open = items.filter((i) => !i.done_at);
    const done = items.filter((i) => i.done_at);
    // Ehdotukset aiemmin ostetuista (nopea uudelleenlisäys).
    const suggestions = [...new Set(done.map((i) => i.text))].slice(0, 40);
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
      <div class="card shop-card">
        <div class="spread"><h3 style="margin:0">Ostettavat (${open.length})</h3></div>
        <ul class="shop-list" id="shopOpen">
          ${open.map(shopRowHtml).join('') || '<li class="empty">Lista on tyhjä. Lisää ensimmäinen tuote yllä.</li>'}
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

  async function addToShopping(text) {
    try {
      const r = await Store.shopping.add(text, '');
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
  const pantryUi = { filter: 'Kaikki', form: null, scanning: false, confirmDel: null };

  function pantryItemHtml(it) {
    const dl = daysLeft(it.best_before), lv = level(dl);
    const acts = canEdit() ? (pantryUi.confirmDel === it.id
      ? `<span class="muted">Poistetaanko?</span>
         <button class="btn small danger" data-pdel="${it.id}">Poista</button>
         <button class="btn small secondary" data-pnodel>Peruuta</button>`
      : `<button class="btn small secondary" data-puse="${it.id}">Käytetty 1</button>
         <button class="btn small secondary" data-pshop="${it.id}">${icon('cart')} Listalle</button>
         <button class="btn small secondary" data-pedit="${it.id}">Muokkaa</button>
         <button class="icon-btn small" data-paskdel="${it.id}" title="Poista" aria-label="Poista ${esc(it.name)}">${icon('trash')}</button>`)
      : '';
    return `<div class="pantry-item lv-${lv}">
      <div class="spread pantry-top">
        <div>
          <div class="pantry-name">${esc(it.name)}</div>
          <div class="pantry-meta">${esc(it.category)} · ${it.qty} kpl${it.best_before ? ' · pe ' + fiDate(it.best_before) : ''}</div>
        </div>
        <span class="pbadge lv-${lv}">${badgeText(dl)}</span>
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
          <input type="number" id="pfQty" min="1" max="9999" inputmode="numeric" value="${esc(f.qty)}" /></div>
      </div>
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
      qty: +$('#pfQty').value || 1,
      category: $('#pfCat').value,
      barcode: $('#pfCode').value.trim(),
    };
  }

  // Koodi luettu → täytetään lomake (tuttu tuote nimineen).
  async function onBarcode(code) {
    pantryUi.scanning = false;
    const keep = $('#pantryForm') ? readForm() : null;
    const f = keep || { id: null, name: '', best_before: '', qty: 1, category: 'Ruoka', barcode: '' };
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
    const { categories, items } = await Store.pantry.list();
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
      pantryUi.form = { id: null, name: '', best_before: '', qty: 1, category: 'Ruoka', barcode: '' };
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
        await Store.pantry.useOne(it.id);
        if (it.qty <= 1) toast(`${it.name} loppui varastosta`);
        viewPantry();
      } catch (err) { toast(err.message, true); }
    });
    content.querySelectorAll('[data-pshop]').forEach((b) => b.onclick = () => addToShopping(byId(b.dataset.pshop).name));
    content.querySelectorAll('[data-pedit]').forEach((b) => b.onclick = () => {
      const it = byId(b.dataset.pedit);
      pantryUi.form = { id: it.id, name: it.name, best_before: it.best_before, qty: it.qty, category: it.category, barcode: it.barcode };
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
    if (!onRoute('varasto')) { Scanner.stop(); pantryUi.scanning = false; pantryUi.form = null; pantryUi.confirmDel = null; }
  });

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
      const open = items.filter((i) => !i.done_at);
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

  return { viewPantry, viewShopping, daysLeft, badgeText, level };
})();
