'use strict';
/* ============================================================================
   Dashboardin kortit
   ----------------------------------------------------------------------------
   Nämä kortit toimivat ILMAN verkkoyhteyttä: kaikki data tulee joko omasta
   tietokannasta tai lasketaan selaimessa. Poikkeuksia ovat sääkortti ja
   sähkön hinta, joiden datan palvelin hakee ulkoa. Muut ulkoiset lähteet
   (uutiset, Euribor) odottavat tiedoston lopussa paikanpitäjinä.
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
   Sää (Ilmatieteen laitoksen avoin data)
   ----------------------------------------------------------------------------
   Palvelin hakee havainnot ja ennusteen (sources/saa.js) ja tämä kortti vain
   piirtää ne. Selain ei ota yhteyttä Ilmatieteen laitokseen. Kaikki arvot
   tarkistetaan luvuiksi ja escapetaan: myös oman palvelimen välittämä
   ulkoinen data on epäluotettavaa.
   ========================================================================== */
const SAA_KUVAT = {
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  'clear-night': '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  partly: '<path d="M8 5V3.5M3.7 6.7l-1-1M2.5 11H1M12.3 6.7l1-1"/><path d="M4.6 12A3.6 3.6 0 0 1 11 8.2"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.3 14 3 3 0 0 0 9 20z"/>',
  'partly-night': '<path d="M11.5 8.5A4.5 4.5 0 0 1 6 3a4.5 4.5 0 1 0 5.5 5.5z"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.3 14 3 3 0 0 0 9 20z"/>',
  cloudy: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.1 3.5 3.5 0 0 0 7 18z"/>',
  fog: '<path d="M4 8h16M4 12h16M6 16h12M9 20h6"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8.5 18l-1 3M12.5 18l-1 3M16.5 18l-1 3"/>',
  sleet: '<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8.5 18l-1 3M16.5 18l-1 3M12 19v.01M12 22v.01"/>',
  snow: '<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8 18.5v.01M12 18.5v.01M16 18.5v.01M10 21.5v.01M14 21.5v.01"/>',
  thunder: '<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M13 15l-3 4h3l-2 3.5"/>',
};

// Ilmatieteen laitoksen SmartSymbol-koodi → [kuva, kuvaus]. Yöllä koodi on +100.
function saaSymboli(sym) {
  const n = Number(sym);
  if (!Number.isFinite(n)) return ['cloudy', ''];
  const night = n >= 100, s = n % 100;
  const sky = (kind) => (night ? kind + '-night' : kind);
  if (s === 1) return [sky('clear'), 'Selkeää'];
  if (s === 2) return [sky('partly'), 'Melkein selkeää'];
  if (s === 4) return [sky('partly'), 'Puolipilvistä'];
  if (s === 6) return ['cloudy', 'Melko pilvistä'];
  if (s === 7) return ['cloudy', 'Pilvistä'];
  if (s === 9) return ['fog', 'Sumua'];
  if (s === 11) return ['rain', 'Tihkusadetta'];
  if (s === 14 || s === 17) return ['sleet', 'Jäätävää sadetta'];
  if (s >= 21 && s <= 27) return ['rain', 'Sadekuuroja'];
  if (s >= 31 && s <= 39) return ['rain', ['Heikkoa vesisadetta', 'Vesisadetta', 'Runsasta vesisadetta'][(s - 31) % 3]];
  if (s >= 41 && s <= 49) return ['sleet', 'Räntäsadetta'];
  if (s >= 51 && s <= 59) return ['snow', 'Lumisadetta'];
  if (s >= 61 && s <= 67) return ['sleet', 'Raekuuroja'];
  if (s >= 71 && s <= 77) return ['thunder', 'Ukkoskuuroja'];
  return ['cloudy', ''];
}
function saaKuva(sym, cls) {
  const [kind, text] = saaSymboli(sym);
  return `<svg class="ic wx-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" `
    + `stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${esc(text || 'sää')}">${SAA_KUVAT[kind]}</svg>`;
}

const saaLuku = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// 6.1 → "6,1" ja -3 → "−3" (oikea miinusmerkki).
const fiLuku = (v, dec) => v.toFixed(dec).replace('.', ',').replace('-', '−');
const saaAste = (v) => (saaLuku(v) === null ? '?' : fiLuku(Math.round(v), 0) + '°');
const TUULI = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];
const HKI = 'Europe/Helsinki';
const hkiKlo = (iso) => new Date(iso).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: HKI });
const hkiPvm = (d) => d.toLocaleDateString('sv-SE', { timeZone: HKI }); // YYYY-MM-DD

function saaPaiva(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) return '';
  if (date === hkiPvm(new Date())) return 'Tänään';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('fi-FI', { weekday: 'short', timeZone: 'UTC' });
}

function saaHtml(res) {
  const d = res && res.data;
  if (!d || saaLuku(d.temp) === null) {
    return `<div class="dash-empty">${res && res.failing
      ? 'Säätietoja ei juuri nyt saada Ilmatieteen laitokselta. Haku yritetään uudelleen automaattisesti.'
      : 'Säätietoja haetaan ensimmäistä kertaa. Päivitä sivu hetken kuluttua.'}</div>`;
  }
  const hours = Array.isArray(d.hours) ? d.hours : [];
  const days = Array.isArray(d.days) ? d.days : [];
  const [, kuvaus] = saaSymboli(d.symbol);
  const rivi = [
    saaLuku(d.wind) !== null ? `Tuuli ${fiLuku(Math.round(d.wind), 0)} m/s${saaLuku(d.wind_dir) !== null
      ? ' ' + TUULI[Math.round(d.wind_dir / 45) % 8 || 0] : ''}` : '',
    saaLuku(d.humidity) !== null ? `kosteus ${fiLuku(d.humidity, 0)} %` : '',
  ].filter(Boolean).join(' · ');
  // Kolmen tunnin jaksot: jakson alun lämpötila ja symboli, sade koko jaksolta.
  const jaksot = [];
  for (let i = 0; i + 2 < hours.length && jaksot.length < 6; i += 3) {
    const sade = hours.slice(i, i + 3).reduce((s, h) => s + (saaLuku(h.rain) || 0), 0);
    jaksot.push(`<div class="wx-h"><span class="mono">${esc(String(saaLuku(hours[i].hour) === null ? '' : hours[i].hour).padStart(2, '0'))}</span>
      ${saaKuva(hours[i].symbol)}<b>${esc(saaAste(hours[i].temp))}</b>
      <span class="wx-rain">${sade >= 0.1 ? esc(fiLuku(sade, 1)) + ' mm' : '&nbsp;'}</span></div>`);
  }
  const vanha = res.failing || (res.fetched_at && Date.now() - Date.parse(res.fetched_at) > 90 * 60000);
  const haettu = res.fetched_at ? new Date(res.fetched_at) : null;
  return `<div class="wx">
    <div class="wx-now">
      ${saaKuva(d.symbol, 'wx-big')}
      <div>
        <div class="wx-temp mono">${esc(fiLuku(d.temp, 1))} °C</div>
        <div class="wx-desc">${esc([kuvaus, saaLuku(d.feels) !== null ? 'tuntuu kuin ' + saaAste(d.feels) : ''].filter(Boolean).join(' · '))}</div>
      </div>
    </div>
    ${rivi ? `<div class="wx-meta">${esc(rivi)}</div>` : ''}
    ${jaksot.length ? `<div class="wx-hours">${jaksot.join('')}</div>` : ''}
    ${days.length ? `<ul class="wx-days">${days.map((p) => `<li>
      <span class="wx-day">${esc(saaPaiva(p.date))}</span>${saaKuva(p.symbol)}
      <span class="wx-rain">${saaLuku(p.rain) !== null && p.rain >= 0.1 ? esc(fiLuku(p.rain, 1)) + ' mm' : ''}</span>
      <span class="mono wx-range">${esc(saaAste(p.min))} … ${esc(saaAste(p.max))}</span></li>`).join('')}</ul>` : ''}
    ${res.demo ? '<div class="wx-warn">Esimerkkidata: demo ei hae säätä verkosta. Palvelinversiossa tässä näkyy oikea sää.</div>' : ''}
    ${vanha && haettu && !res.demo ? `<div class="wx-warn">Uutta säätietoa ei juuri nyt saada. Tiedot ovat ajalta ${
      esc(haettu.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', timeZone: HKI }))} klo ${esc(hkiKlo(res.fetched_at))}.</div>` : ''}
    <div class="wx-foot">Lähde: Ilmatieteen laitos, avoin data (CC BY 4.0)${d.observed_at && !res.demo
      ? ' · havainto klo ' + esc(hkiKlo(d.observed_at)) : ''}</div>
  </div>`;
}

Dashboard.register({
  id: 'saa',
  title: 'Sää',
  slot: 'rail',
  order: 30,
  icon: 'droplet',
  headExtra: '<span class="d2-more">Helsinki</span>',
  load: () => Store.dashboard.get('saa'),
  render: saaHtml,
});

/* ============================================================================
   Sähkön hinta (pörssisähkö, porssisahko.net)
   ----------------------------------------------------------------------------
   Palvelin hakee hinnat kerran tunnissa (sources/sahko.js) ja tämä kortti
   piirtää ne: hinta juuri nyt, päivän tunnit pylväinä ja halvin tuleva
   kolmen tunnin jakso. Hinnat ovat snt/kWh ja sisältävät arvonlisäveron.

   "Nyt" lasketaan selaimen kellosta, koska hinta vaihtuu vartin välein eikä
   palvelimen data päivity niin usein. Kaikki arvot tarkistetaan luvuiksi:
   myös oman palvelimen välittämä ulkoinen data on epäluotettavaa.
   ========================================================================== */
const SAHKO_TUNTI = 3600000;
const sahkoLuku = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000 ? v : null);
const sahkoHinta = (v) => fiLuku(v, 2);
const sahkoKlo = (h) => String(h).padStart(2, '0');

// Lähteen tunnit siistiksi listaksi: vain kelvolliset rivit, aikajärjestyksessä.
function sahkoTunnit(d) {
  const list = d && Array.isArray(d.hours) ? d.hours.slice(0, 80) : [];
  return list.map((h) => {
    const t = Date.parse(h && h.time);
    const price = sahkoLuku(h && h.price);
    const hour = sahkoLuku(h && h.hour);
    if (!Number.isFinite(t) || price === null || hour === null || hour < 0 || hour > 23) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.date))) return null;
    const q = Array.isArray(h.quarters) ? h.quarters.slice(0, 4).map(sahkoLuku) : [];
    return { t, date: String(h.date), hour: Math.floor(hour), price, q };
  }).filter(Boolean).sort((a, b) => a.t - b.t);
}

// Tämän vartin hinta: { price, start } tai null, jos tunti puuttuu datasta.
function sahkoNyt(tunnit, now) {
  const h = tunnit.find((x) => x.t <= now && now < x.t + SAHKO_TUNTI);
  if (!h) return null;
  const i = Math.floor((now - h.t) / 900000);
  const q = h.q[i];
  return { price: q === null || q === undefined ? h.price : q, start: h.t + i * 900000, tunti: h };
}

// Halvin peräkkäisten tuntien jakso nykyisestä tunnista eteenpäin.
function sahkoHalvin(tunnit, now, pituus) {
  const tulevat = tunnit.filter((h) => h.t + SAHKO_TUNTI > now);
  let paras = null;
  for (let i = 0; i + pituus <= tulevat.length; i++) {
    const jakso = tulevat.slice(i, i + pituus);
    if (jakso[pituus - 1].t - jakso[0].t !== (pituus - 1) * SAHKO_TUNTI) continue; // aukko datassa
    const avg = jakso.reduce((s, h) => s + h.price, 0) / pituus;
    if (!paras || avg < paras.avg) paras = { avg, alku: jakso[0] };
  }
  return paras;
}

// Akselin yläraja siistiksi luvuksi: kaksi tasaväliä (0, puoliväli, yläraja).
function sahkoAskel(max) {
  const askeleet = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  return askeleet.find((a) => a * 2 >= max) || 500;
}

// Yhden päivän pylväät. Asteikko on yhteinen molemmille päiville, jotta
// tämän päivän ja huomisen pylväät ovat keskenään vertailukelpoisia.
function sahkoKaavio(otsikko, lista, asteikko, now) {
  const { ala, yla } = asteikko;
  const ala0 = (0 - ala) / (yla - ala) * 100; // nollaviivan paikka alhaalta, %
  const avg = lista.reduce((s, h) => s + h.price, 0) / lista.length;
  const low = lista.reduce((a, b) => (b.price < a.price ? b : a));
  const high = lista.reduce((a, b) => (b.price > a.price ? b : a));
  const oletus = `alin ${sahkoHinta(low.price)} klo ${sahkoKlo(low.hour)} · ylin ${sahkoHinta(high.price)} klo ${sahkoKlo(high.hour)}`;
  const pylvaat = lista.map((h) => {
    const korkeus = Math.abs(h.price) / (yla - ala) * 100;
    const tila = h.t + SAHKO_TUNTI <= now ? ' past' : (h.t <= now ? ' now' : '');
    return `<span class="sahko-bar${tila}${h.price < 0 ? ' neg' : ''}" data-klo="${sahkoKlo(h.hour)}" data-hinta="${esc(sahkoHinta(h.price))}"`
      + ` style="--b:${ala0.toFixed(2)}%;--h:${korkeus.toFixed(2)}%"><i></i></span>`;
  }).join('');
  const tikit = [yla, (yla + ala) / 2, ala].map((v) => `<span>${esc(fiLuku(v, v % 1 ? 1 : 0))}</span>`).join('');
  const akseli = lista.filter((h) => h.hour % 6 === 0)
    .map((h) => `<span style="--i:${lista.indexOf(h)}">${sahkoKlo(h.hour)}</span>`).join('');
  return `<div class="sahko-day">
    <div class="sahko-dayhead"><span class="sahko-daytitle">${esc(otsikko)}</span>
      <span class="sahko-avg">keskihinta <b class="mono">${esc(sahkoHinta(avg))}</b></span></div>
    <div class="sahko-plot">
      <div class="sahko-y mono" aria-hidden="true">${tikit}</div>
      <div class="sahko-chart" tabindex="0" role="group" style="--n:${lista.length}"
        aria-label="${esc(otsikko)} tunneittain, ${esc(oletus)}. Nuolinäppäimillä näet yksittäisen tunnin hinnan.">${pylvaat}</div>
      <div class="sahko-x mono" style="--n:${lista.length}" aria-hidden="true">${akseli}</div>
    </div>
    <div class="sahko-read" aria-live="polite" data-oletus="${esc(oletus)}">${esc(oletus)}</div>
  </div>`;
}

function sahkoHtml(res, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const tunnit = sahkoTunnit(res && res.data);
  const tanaan = hkiPvm(new Date(now));
  const tanaanLista = tunnit.filter((h) => h.date === tanaan);
  if (!tanaanLista.length) {
    return `<div class="dash-empty">${res && res.failing
      ? 'Sähkön hintoja ei juuri nyt saada. Haku yritetään uudelleen automaattisesti.'
      : 'Sähkön hintoja haetaan ensimmäistä kertaa. Päivitä sivu hetken kuluttua.'}</div>`;
  }
  const huomenna = hkiPvm(new Date(now + 24 * SAHKO_TUNTI));
  const huomennaLista = tunnit.filter((h) => h.date === huomenna);
  const kaikki = tanaanLista.concat(huomennaLista);
  const max = Math.max(...kaikki.map((h) => h.price), 0);
  const min = Math.min(...kaikki.map((h) => h.price), 0);
  const askel = sahkoAskel(Math.max(max, -min));
  const asteikko = { yla: askel * 2, ala: min < 0 ? -askel * Math.ceil(-min / askel) : 0 };

  const nyt = sahkoNyt(tunnit, now);
  const halvin = sahkoHalvin(kaikki, now, 3);
  const halvinTeksti = halvin
    ? `Halvin 3 tunnin jakso alkaa ${halvin.alku.t <= now ? 'nyt' : (halvin.alku.date === tanaan ? 'tänään' : 'huomenna') + ' klo ' + sahkoKlo(halvin.alku.hour)}`
      + `, keskimäärin ${sahkoHinta(halvin.avg)} snt/kWh.`
    : '';
  const vanha = res.failing || (res.fetched_at && now - Date.parse(res.fetched_at) > 3 * SAHKO_TUNTI);
  const haettu = res.fetched_at && Number.isFinite(Date.parse(res.fetched_at)) ? new Date(res.fetched_at) : null;
  const rivit = Array.from({ length: 24 }, (_, hour) => {
    const a = tanaanLista.find((h) => h.hour === hour), b = huomennaLista.find((h) => h.hour === hour);
    return a || b ? `<tr><th scope="row">${sahkoKlo(hour)}</th><td>${a ? esc(sahkoHinta(a.price)) : ''}</td>`
      + (huomennaLista.length ? `<td>${b ? esc(sahkoHinta(b.price)) : ''}</td>` : '') + '</tr>' : '';
  }).join('');

  return `<div class="sahko">
    ${nyt ? `<div class="sahko-now">
      <div class="sahko-price mono">${esc(sahkoHinta(nyt.price))}<span> snt/kWh</span></div>
      <div class="sahko-desc">Nyt, klo ${esc(hkiKlo(nyt.start))} alkaen · sis. alv</div>
    </div>` : '<div class="sahko-desc">Tämän hetken hintaa ei ole saatavilla.</div>'}
    ${sahkoKaavio('Tänään', tanaanLista, asteikko, now)}
    ${huomennaLista.length ? sahkoKaavio('Huomenna', huomennaLista, asteikko, now)
      : '<div class="sahko-note">Huomisen hinnat julkaistaan noin klo 14.</div>'}
    ${halvinTeksti ? `<div class="sahko-best">${esc(halvinTeksti)}</div>` : ''}
    <details class="sahko-table"><summary>Näytä tunnit taulukkona</summary>
      <table class="mono"><thead><tr><th scope="col">Klo</th><th scope="col">Tänään</th>${
        huomennaLista.length ? '<th scope="col">Huomenna</th>' : ''}</tr></thead><tbody>${rivit}</tbody></table>
    </details>
    ${res.demo ? '<div class="wx-warn">Esimerkkidata: demo ei hae hintoja verkosta. Palvelinversiossa tässä näkyvät oikeat hinnat.</div>' : ''}
    ${vanha && haettu && !res.demo ? `<div class="wx-warn">Uusia hintoja ei juuri nyt saada. Tiedot ovat ajalta ${
      esc(haettu.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', timeZone: HKI }))} klo ${esc(hkiKlo(res.fetched_at))}.</div>` : ''}
    <div class="wx-foot">Lähde: porssisahko.net · pörssihinta snt/kWh, sis. alv, ilman siirtoa ja marginaalia</div>
  </div>`;
}

// Pylvään hinta lukuriville: osoittamalla, napauttamalla tai nuolinäppäimillä.
function sahkoBind(slot) {
  slot.querySelectorAll('.sahko-day').forEach((day) => {
    const chart = day.querySelector('.sahko-chart');
    const read = day.querySelector('.sahko-read');
    const bars = [...chart.querySelectorAll('.sahko-bar')];
    let valittu = -1;
    const nayta = (i) => {
      bars.forEach((b, j) => b.classList.toggle('on', j === i));
      valittu = i;
      if (i < 0) { read.textContent = read.dataset.oletus; return; }
      read.textContent = `klo ${bars[i].dataset.klo}: ${bars[i].dataset.hinta} snt/kWh`;
    };
    chart.addEventListener('pointermove', (e) => { const b = e.target.closest('.sahko-bar'); if (b) nayta(bars.indexOf(b)); });
    chart.addEventListener('pointerdown', (e) => { const b = e.target.closest('.sahko-bar'); if (b) nayta(bars.indexOf(b)); });
    chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') nayta(-1); });
    chart.addEventListener('blur', () => nayta(-1));
    chart.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const alku = valittu < 0 ? Math.max(0, bars.findIndex((b) => b.classList.contains('now'))) : valittu;
      const seuraava = valittu < 0 ? alku : alku + (e.key === 'ArrowRight' ? 1 : -1);
      nayta(Math.min(bars.length - 1, Math.max(0, seuraava)));
    });
  });
}

Dashboard.register({
  id: 'sahko',
  title: 'Sähkön hinta',
  slot: 'rail',
  order: 50,
  icon: 'bolt',
  headExtra: '<span class="d2-more">pörssisähkö</span>',
  load: () => Store.dashboard.get('sahko'),
  render: (res) => sahkoHtml(res),
  bind: sahkoBind,
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

   Sääkortti ja sähkön hinta (yllä) on tehty jo näin: käytä niitä mallina.
   Palvelimen puoli on dashboard-sources.js ja sources/-kansio.

   Selain EI hae mitään ulkoa – ks. dashboard.js:n alkukommentti.
   ========================================================================== */
const TULOSSA = [
  { id: 'uutiset', title: 'Uutiset', icon: 'announce', slot: 'main', order: 15,
    kuvaus: 'Otsikot RSS-syötteestä, linkki alkuperäiseen. Koko artikkelia ei kopioida.' },
  { id: 'korot', title: 'Euribor', icon: 'popular', slot: 'rail', order: 40,
    kuvaus: 'Vaatii vielä selvityksen: virallinen julkaisija on EMMI ja jakelulla on ehtoja. Suomen Pankki ja EKP ovat avoimempia vaihtoehtoja.' },
];

TULOSSA.forEach((k) => Dashboard.register({
  id: k.id, title: k.title, slot: k.slot, order: k.order, icon: k.icon,
  render: () => `<div class="dash-todo">
    <strong>Ei vielä kytketty</strong>
    <p>${esc(k.kuvaus)}</p>
  </div>`,
}));
