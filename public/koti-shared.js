/* ============================================================================
   Kodin toimintojen yhteiset säännöt (varasto, kauppalista, kotityöt)
   ----------------------------------------------------------------------------
   Sama tiedosto ajetaan KOLMESSA paikassa, jotta säännöt eivät pääse
   erkanemaan toisistaan:
     - palvelimella (koti-routes.js: require)
     - selaimessa palvelinversiossa (koti.js käyttää osastolistaa)
     - sandboxissa (store-local.js tekee samat tarkistukset kuin palvelin)
   Täällä on vain puhdasta logiikkaa: ei tietokantaa, ei DOMia, ei verkkoa.
   ========================================================================== */
(function (root) {
  'use strict';

  const PANTRY_CATEGORIES = ['Ruoka', 'Juomavesi', 'Ensiapu ja lääkkeet', 'Paristot ja valo',
    'Hygienia', 'Koiran tarvikkeet', 'Muu'];

  // Kaupan osastot SIINÄ JÄRJESTYKSESSÄ, jossa kauppa tyypillisesti kierretään.
  // Kauppalista ryhmitellään tämän mukaan.
  const SECTIONS = ['Hedelmät ja vihannekset', 'Leipä', 'Liha ja kala', 'Maito ja kylmätuotteet',
    'Kuivatuotteet ja säilykkeet', 'Juomat', 'Makeiset ja naposteltavat', 'Pakasteet',
    'Hygienia ja terveys', 'Koti ja siivous', 'Lemmikit', 'Muu'];
  const OTHER = 'Muu';

  // Varaston kategoria kertoo osaston suoraan, kun se on yksiselitteinen.
  // 'Ruoka' on liian laaja (leipä, säilyke, pakaste...), joten siinä nimi
  // ratkaisee ensin ja tämä on vasta varavaihtoehto.
  const PANTRY_TO_SECTION = {
    'Ruoka': 'Kuivatuotteet ja säilykkeet',
    'Juomavesi': 'Juomat',
    'Ensiapu ja lääkkeet': 'Hygienia ja terveys',
    'Paristot ja valo': 'Koti ja siivous',
    'Hygienia': 'Hygienia ja terveys',
    'Koiran tarvikkeet': 'Lemmikit',
  };
  const WEAK_PANTRY = ['Ruoka', 'Muu'];

  // Osaston arvaus tuotteen nimestä. Rivi: [osasto, etusija, sanavartalot].
  // Suurempi etusija voittaa aina (esim. "koiran makkara" on lemmikkiosastolla).
  // Arvaus saa mennä joskus pieleen: käyttäjän tekemä korjaus muistetaan.
  const KEYWORDS = [
    ['Lemmikit', 2, ['koiran', 'kissan', 'kissanhiekka', 'raksu', 'puruluu', 'lemmik']],
    ['Koti ja siivous', 2, ['pakastepussi', 'tiskisieni', 'suodatinpussi', 'leivinpaperi']],
    ['Pakasteet', 1, ['pakaste', 'jäätelö', 'kalapuiko', 'ranskalais', 'pizza', 'jääpal']],
    ['Hedelmät ja vihannekset', 0, ['banaani', 'omena', 'omeno', 'appelsiini', 'mandariini', 'sitruuna',
      'päärynä', 'rypäle', 'mansik', 'mustik', 'vadelm', 'marja', 'marjo', 'meloni', 'avokado', 'kiivi',
      'tomaatti', 'tomaati', 'kurkku', 'kurkut', 'salaatti', 'porkkan', 'peruna', 'perunoi', 'sipuli',
      'paprika', 'kaali', 'sieni', 'sienet', 'herkkusien', 'yrtti', 'basilika', 'persilja', 'tilli',
      'inkivääri', 'chili', 'kesäkurpitsa', 'munakoiso', 'pinaatti', 'lanttu', 'punajuur', 'hedelmä',
      'vihannes']],
    ['Leipä', 0, ['leipä', 'leivät', 'leipiä', 'sämpylä', 'patonki', 'rieska', 'pulla', 'korppu',
      'karjalanpiirak', 'croissant', 'tortilla']],
    ['Liha ja kala', 0, ['liha', 'lihat', 'kana', 'broileri', 'possu', 'nauta', 'naudan', 'makkara',
      'nakki', 'nakit', 'pekoni', 'kinkku', 'leikkele', 'kala', 'lohi', 'lohta', 'silakka', 'katkarapu',
      'kalkkuna', 'lihapulla', 'lihapyöryk', 'meetvursti', 'salami']],
    ['Maito ja kylmätuotteet', 0, ['maito', 'maido', 'piimä', 'kerma', 'jogurt', 'viili', 'rahka',
      'juusto', 'voi', 'margariini', 'levite', 'kananmun', 'muna', 'munat', 'munia', 'tofu',
      'kaurajuoma', 'vanukas', 'smetana']],
    ['Kuivatuotteet ja säilykkeet', 0, ['pasta', 'makaroni', 'spagetti', 'riisi', 'jauho', 'sokeri',
      'suola', 'kahvi', 'tee', 'kaakao', 'mysli', 'muro', 'murot', 'hiutale', 'puuro', 'säilyke',
      'tonnikala', 'keitto', 'papu', 'pavut', 'linssi', 'öljy', 'etikka', 'ketsuppi', 'sinappi',
      'majoneesi', 'mauste', 'pippuri', 'hillo', 'hunaja', 'pähkinä', 'rusina', 'nuudeli', 'kastike',
      'murska', 'liemi', 'leivinjauhe', 'hiiva', 'kaneli', 'vanilja']],
    ['Juomat', 0, ['mehu', 'mehut', 'limu', 'limsa', 'limonadi', 'vesi', 'vettä', 'vichy', 'olut',
      'olutta', 'kalja', 'siideri', 'lonkero', 'viini', 'juoma', 'cola', 'kola', 'smoothie', 'glögi']],
    ['Makeiset ja naposteltavat', 0, ['karkki', 'karkit', 'karkkia', 'suklaa', 'sipsi', 'lastu', 'keksi',
      'popcorn', 'purukumi', 'pastilli', 'lakritsi', 'salmiakki', 'makeinen', 'makeiset', 'naksu']],
    ['Hygienia ja terveys', 0, ['shampoo', 'sampoo', 'hoitoaine', 'saippua', 'hammastahna', 'hammasharj',
      'deodorantti', 'voide', 'laastari', 'lääke', 'vitamiini', 'terveysside', 'tamponi', 'vaippa',
      'vaipat', 'partaterä', 'partavaahto', 'suihkugeeli', 'käsidesi', 'vanulappu', 'pumpuli',
      'huulirasva', 'burana', 'ibuprofeeni', 'parasetamoli']],
    ['Koti ja siivous', 0, ['pesuaine', 'tiskiaine', 'tiskitabletti', 'pyykinpesu', 'huuhteluaine',
      'paperi', 'roskapussi', 'pussi', 'pussit', 'folio', 'kelmu', 'paristo', 'patteri', 'lamppu',
      'kynttilä', 'tulitik', 'sytytin', 'puhdistusaine', 'tiskiharja', 'pyykkipoika']],
  ];

  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  // Vertailuavain nimille: SQLiten lower() ei osaa ääkkösiä, joten vertailu
  // tehdään aina tällä (ÄITI ja äiti ovat sama tuote).
  const nameKey = (v) => String(v == null ? '' : v).trim().toLowerCase();

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  // Kelvollinen YYYY-MM-DD tai tyhjä. Olematon päivä (30.2.) hylätään.
  function cleanDate(v) {
    const s = str(v, 10);
    if (!ISO_DATE.test(s)) return '';
    const d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : '';
  }
  const pad = (n) => String(n).padStart(2, '0');
  // Kuluva päivä laitteen omassa aikavyöhykkeessä.
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // Päivien ero (b - a) kahden YYYY-MM-DD-päivän välillä.
  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function intIn(v, min, max, fallback) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
  }

  // ---------- Varasto ----------
  // Määrä saa olla 0 vain, kun tuotteella on tavoitemäärä: silloin rivi jää
  // muistiin "loppu"-tilassa ja muistuttaa ostamisesta.
  function pantryFields(body) {
    body = body || {};
    const target = intIn(body.target_qty, 0, 9999, 0);
    return {
      name: str(body.name, 200),
      barcode: str(body.barcode, 64).replace(/[^0-9A-Za-z\-.]/g, ''),
      category: PANTRY_CATEGORIES.includes(body.category) ? body.category : OTHER,
      qty: intIn(body.qty, target > 0 ? 0 : 1, 9999, 1),
      best_before: cleanDate(body.best_before),
      target_qty: target,
    };
  }

  // ---------- Kauppalistan osastot ----------
  const cleanSection = (v) => (SECTIONS.includes(v) ? v : '');

  function keywordSection(text) {
    const words = nameKey(text).split(/[^a-zåäö]+/).filter(Boolean);
    let best = null, bestScore = -1;
    for (const [section, prio, stems] of KEYWORDS) {
      for (const stem of stems) {
        for (const w of words) {
          const at = w.lastIndexOf(stem);
          if (at === -1) continue;
          const tail = w.length - at - stem.length;
          // Suomen yhdyssanassa pääsana on lopussa (appelsiiniMEHU), joten
          // sanan loppuun osuva vartalo painaa eniten. Taivutuspääte sallitaan.
          const atEnd = tail <= 2;
          // Lyhyt vartalo (voi, tee) kelpaa vain kokonaisena sanana.
          if (stem.length <= 3 && !(at === 0 && atEnd)) continue;
          const score = prio * 10000 + (atEnd ? 1000 : 0) + stem.length;
          if (score > bestScore) { bestScore = score; best = section; }
        }
      }
    }
    return best;
  }

  // Osasto tuotteen nimestä ja (jos tiedossa) varaston kategoriasta.
  function guessSection(text, pantryCategory) {
    // Vain tunnettu kategoria kelpaa avaimeksi (ei esim. "constructor").
    const fromPantry = PANTRY_CATEGORIES.includes(pantryCategory) ? PANTRY_TO_SECTION[pantryCategory] : undefined;
    if (fromPantry && !WEAK_PANTRY.includes(pantryCategory)) return fromPantry;
    return keywordSection(text) || fromPantry || OTHER;
  }

  // ---------- Toistuvat kotityöt ----------
  const CHORE_UNITS = ['day', 'week', 'month', 'year'];

  // Lisää päivämäärään n yksikköä. Kuukausissa ja vuosissa päivä pysyy
  // samana, ja liian lyhyessä kuussa käytetään kuun viimeistä päivää
  // (31.1. + 1 kk = 28.2. tai 29.2.).
  function addInterval(iso, n, unit) {
    const [y, m, d] = iso.split('-').map(Number);
    let t;
    if (unit === 'day' || unit === 'week') {
      t = new Date(Date.UTC(y, m - 1, d + n * (unit === 'week' ? 7 : 1)));
    } else {
      const months = (m - 1) + n * (unit === 'year' ? 12 : 1);
      const ty = y + Math.floor(months / 12), tm = ((months % 12) + 12) % 12;
      const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
      t = new Date(Date.UTC(ty, tm, Math.min(d, last)));
    }
    return t.toISOString().slice(0, 10);
  }

  // Kotityön kentät siivottuna. Jos seuraavaa päivää ei anneta, se lasketaan
  // tästä päivästä toistovälin päähän.
  function choreFields(body, today) {
    body = body || {};
    const unit = CHORE_UNITS.includes(body.unit) ? body.unit : 'month';
    const every = intIn(body.every_n, 1, 999, 1);
    return {
      title: str(body.title, 200),
      note: str(body.note, 500),
      every_n: every,
      unit,
      next_due: cleanDate(body.next_due) || addInterval(today, every, unit),
    };
  }

  // Kuittauspäivä: selaimen ilmoittama päivä kelpaa, jos se on korkeintaan
  // vuorokauden päässä palvelimen päivästä (aikavyöhyke-ero), muuten
  // käytetään palvelimen päivää.
  function doneDate(clientDate, today) {
    const d = cleanDate(clientDate);
    return d && Math.abs(dayDiff(today, d)) <= 1 ? d : today;
  }

  const api = {
    PANTRY_CATEGORIES, SECTIONS, CHORE_UNITS,
    nameKey, cleanDate, todayISO, dayDiff, pantryFields,
    cleanSection, guessSection, addInterval, choreFields, doneDate,
  };
  root.KotiShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
