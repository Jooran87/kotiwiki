'use strict';
/* ============================================================================
   Dashboardin kortit
   ----------------------------------------------------------------------------
   Nämä kortit toimivat ILMAN verkkoyhteyttä: kaikki data tulee joko omasta
   tietokannasta tai lasketaan selaimessa. Ulkoiset lähteet (uutiset, sää,
   Euribor, sähkön hinta) lisätään myöhemmin omina kortteinaan – ks. tiedoston
   loppu, jossa on valmis paikanpitäjä ja ohje.
   ========================================================================== */

// ---------- Päivä: pvm, kellonaika, viikko, auringonnousu ja -lasku ----------
// Auringon ajat lasketaan paikallisesti (NOAA:n yksinkertaistettu kaava),
// joten mitään ei tarvitse hakea verkosta. Tarkkuus ~1 min, riittää hyvin.
const PAIKAT = [
  { nimi: 'Helsinki', lat: 60.17, lon: 24.94 },
  { nimi: 'Rovaniemi', lat: 66.50, lon: 25.73 },
];

function auringonAjat(date, lat, lon) {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const n = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
  const lngHour = lon / 15;
  const calc = (rising) => {
    const t = n + ((rising ? 6 : 18) - lngHour) / 24;
    const M = (0.9856 * t) - 3.289;                                  // keskianomalia
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
    L = (L + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = (RA + 360) % 360;
    RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);    // samaan neljännekseen
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    // 90°50' = auringon yläreuna horisontissa + taittuminen
    const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1) return null;    // ei nouse lainkaan (kaamos)
    if (cosH < -1) return null;   // ei laske lainkaan (yötön yö)
    const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    const UT = ((T - lngHour) % 24 + 24) % 24;
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCMinutes(d.getUTCMinutes() + Math.round(UT * 60));
    return d;
  };
  return { nousu: calc(true), lasku: calc(false) };
}

const kloFi = (d) => (d ? d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }) : null);

Dashboard.register({
  id: 'paiva',
  title: 'Päivä',
  slot: 'main',
  order: 10,
  icon: 'recent',
  render: () => {
    const now = new Date();
    const pv = now.toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const rivit = PAIKAT.map((p) => {
      const a = auringonAjat(now, p.lat, p.lon);
      let teksti;
      if (!a.nousu && !a.lasku) {
        // Napapiirin pohjoispuolella aurinko ei aina nouse tai laske lainkaan.
        teksti = now.getMonth() >= 4 && now.getMonth() <= 6 ? 'aurinko ei laske' : 'aurinko ei nouse';
      } else {
        teksti = `${kloFi(a.nousu) || '–'} → ${kloFi(a.lasku) || '–'}`;
      }
      return `<div class="dash-row">
        <span class="dash-row-label">${esc(p.nimi)}</span>
        <span class="dash-row-value mono">${esc(teksti)}</span>
      </div>`;
    }).join('');
    return `<div class="dash-day">
      <div class="dash-day-main mono">${esc(now.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }))}</div>
      <div class="dash-day-sub">${esc(pv.charAt(0).toUpperCase() + pv.slice(1))} · viikko ${isoWeek(now)}</div>
      <div class="dash-rows" style="margin-top:12px">
        <div class="dash-rows-title">Aurinko nousee ja laskee</div>${rivit}
      </div>
    </div>`;
  },
});

// ---------- Muistutukset (nykyiset "tiedotteet") ----------
Dashboard.register({
  id: 'muistutukset',
  title: 'Muistutukset',
  slot: 'main',
  order: 20,
  icon: 'announce',
  headExtra: '<a class="d2-more" href="#/muistutukset">Kaikki</a>',
  load: () => Store.announcements.list(),
  render: (list) => {
    const kiinnitetyt = list.filter((a) => a.pinned);
    const muut = list.filter((a) => !a.pinned).slice(0, 3);
    const näytä = [...kiinnitetyt, ...muut].slice(0, 4);
    if (!näytä.length) return '<div class="dash-empty">Ei muistutuksia. Lisää ensimmäinen Muistutukset-sivulta.</div>';
    return näytä.map((a) => `<a class="dash-item" href="#/muistutukset">
      <span class="dash-item-dot ${a.pinned ? 'on' : ''}"></span>
      <span class="dash-item-body">
        <strong>${esc(a.title)}</strong>
        ${String(a.content || '').trim() ? `<span class="dash-item-text">${esc(a.content)}</span>` : ''}
        <span class="dash-item-meta mono">${esc(fmtDate(a.created_at))}</span>
      </span>
    </a>`).join('');
  },
});

// ---------- Ohjeet: omat kategoriat ----------
Dashboard.register({
  id: 'ohjeet',
  title: 'Ohjeet',
  slot: 'main',
  order: 30,
  icon: 'terms',
  render: () => {
    const tops = topCategories();
    if (!tops.length) return '<div class="dash-empty">Ei kategorioita vielä. Lisää sivupalkin ＋-napista.</div>';
    return `<div class="d2-cats">
      ${tops.map((c) => {
        const subs = subCategories(c.id);
        const kuvaus = subs.length ? subs.map((s) => s.name).join(', ') : `${totalPageCount(c)} ohjetta`;
        return `<a class="d2-cat" href="#/kohde/${c.id}"${accentStyle(c)}>
          <div class="d2-catrow"><span class="d2-catname">${esc(c.name)}</span>
            <span class="d2-catnum">${totalPageCount(c)}</span></div>
          <div class="d2-catdesc">${esc(kuvaus)}</div>
        </a>`;
      }).join('')}
      <a class="d2-cat all" href="#/haku?q="><div class="d2-catrow">
        <span class="d2-catname">Selaa kaikkia</span></div>
        <div class="d2-catdesc">Haku ja koko sisältö</div></a>
    </div>`;
  },
});

// ---------- Viimeksi päivitetyt ----------
Dashboard.register({
  id: 'viimeksi',
  title: 'Viimeksi päivitetyt',
  slot: 'main',
  order: 40,
  icon: 'history',
  load: () => Store.pages.list(),
  render: (pages) => {
    const recent = [...pages]
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 4);
    if (!recent.length) return '<div class="dash-empty">Ei ohjeita vielä.</div>';
    return `<div class="d2-recent">${recent.map((p) => {
      const cat = categories.find((c) => c.id === p.category_id);
      return `<button class="d2-rec" data-page="${p.id}"${accentStyle(cat)}>
        <span class="d2-rectop"><span class="d2-recname">${esc(p.title)}</span>
          <span class="d2-recdate">${esc(shortDate(p.updated_at))}</span></span>
        <span class="d2-recmeta">${esc(categoryName(p.category_id))}</span>
      </button>`;
    }).join('')}</div>`;
  },
});

// ---------- Tärkeät numerot (oikea kaista) ----------
Dashboard.register({
  id: 'numerot',
  title: 'Tärkeät numerot',
  slot: 'rail',
  order: 10,
  icon: 'contact',
  headExtra: '<a class="d2-more" href="#/numerot">Kaikki</a>',
  load: () => Store.contacts.list(),
  render: (contacts) => {
    if (!contacts.length) return '<div class="dash-empty">Ei numeroita vielä.</div>';
    const hätä = (c) => String(c.phone || '').replace(/\D/g, '') === '112';
    const tel = (c) => esc(String(c.phone).replace(/[^\d+]/g, ''));
    return contacts.filter(hätä).map((c) => `<div class="d2-num emergency">
        <span class="d2-numname"><b>${esc(c.label)}</b><span>${esc(c.note || '')}</span></span>
        <a class="d2-numtel" href="tel:${tel(c)}">${esc(c.phone)}</a></div>`).join('')
      + contacts.filter((c) => !hätä(c)).slice(0, 5).map((c) => `<div class="d2-num">
        <span class="d2-numname"><b>${esc(c.label)}</b>${c.note ? `<span>${esc(c.note)}</span>` : ''}</span>
        ${c.phone ? `<a class="d2-numtel" href="tel:${tel(c)}">${esc(c.phone)}</a>` : ''}</div>`).join('');
  },
});

// ---------- Päiväkirja / muistiinpanot (oikea kaista) ----------
Dashboard.register({
  id: 'muistiinpanot',
  title: 'Muistiinpanot',
  slot: 'rail',
  order: 20,
  icon: 'note',
  headExtra: '<a class="d2-more" href="#/paivakirja">Kaikki</a>',
  load: () => Store.notes.list({ limit: 5 }),
  render: (notes) => `
    <div class="d2-logbox note-quick">
      <textarea id="dashNoteText" placeholder="Kirjaa muistiin…"></textarea>
      <div class="d2-logfoot">
        <span class="d2-noticemeta">Ctrl/Cmd + Enter lähettää</span>
        <button class="d2-btn" id="dashNoteAdd">Lisää</button>
      </div>
    </div>
    ${notes.slice(0, 3).map((n) => {
      const cat = categories.find((c) => c.id === n.category_id);
      return `<div class="d2-entry"${accentStyle(cat)}>
        <span class="d2-tick"></span>
        <span style="flex:1;min-width:0">
          <span class="d2-entryhead"><time>${esc(fmtDate(n.created_at))}</time></span>
          <div class="d2-entrytext">${esc(n.content)}</div>
        </span></div>`;
    }).join('') || '<div class="d2-entry"><span class="d2-noticemeta">Ei merkintöjä vielä.</span></div>'}`,
  bind: (el) => {
    const add = async () => {
      const ta = el.querySelector('#dashNoteText');
      if (!ta.value.trim()) return toast('Kirjoita jotain', true);
      try { await Store.notes.create({ content: ta.value, category_id: null, author: author.get() });
        toast('Lisätty'); viewHome(); }
      catch (err) { toast(err.message, true); }
    };
    el.querySelector('#dashNoteAdd').onclick = add;
    el.querySelector('#dashNoteText').onkeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') add();
    };
  },
});

/* ============================================================================
   PAIKANPITÄJÄT ulkoisille lähteille
   ----------------------------------------------------------------------------
   Nämä kortit näkyvät dashboardilla, mutta kertovat rehellisesti ettei lähdettä
   ole vielä kytketty. Kun lähde otetaan käyttöön:

     1. Palvelimelle sources/<nimi>.js, joka hakee datan ja palauttaa olion.
     2. server.js ajastaa haun ja tallentaa tuloksen välimuistiin (SQLite).
     3. GET /api/dashboard palauttaa kaikkien lähteiden viimeisimmät arvot.
     4. Täällä: load: () => Store.dashboard.get('<nimi>') ja oikea render.

   Selain EI hae mitään ulkoa – ks. dashboard.js:n alkukommentti.
   ========================================================================== */
const TULOSSA = [
  { id: 'saa', title: 'Sää', icon: 'droplet', slot: 'rail', order: 30,
    kuvaus: 'Helsinki ja Rovaniemi. Lähde-ehdokkaat: Ilmatieteen laitoksen avoin data tai Open-Meteo (molemmat ilmaisia).' },
  { id: 'uutiset', title: 'Uutiset', icon: 'announce', slot: 'main', order: 15,
    kuvaus: 'Otsikot RSS-syötteestä, linkki alkuperäiseen. Koko artikkelia ei kopioida.' },
  { id: 'korot', title: 'Euribor', icon: 'popular', slot: 'rail', order: 40,
    kuvaus: 'Vaatii vielä selvityksen: virallinen julkaisija on EMMI ja jakelulla on ehtoja. Suomen Pankki ja EKP ovat avoimempia vaihtoehtoja.' },
  { id: 'sahko', title: 'Sähkön hinta', icon: 'bolt', slot: 'rail', order: 50,
    kuvaus: 'Pörssisähkön tuntihinta tänään ja huomenna.' },
];

TULOSSA.forEach((k) => Dashboard.register({
  id: k.id, title: k.title, slot: k.slot, order: k.order, icon: k.icon,
  render: () => `<div class="dash-todo">
    <strong>Ei vielä kytketty</strong>
    <p>${esc(k.kuvaus)}</p>
  </div>`,
}));
