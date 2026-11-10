// Ulkoisten lähteiden testit (sää ja sähkön hinta). Verkkoa EI käytetä:
// Ilmatieteen laitosta ja porssisahko.net-palvelua esittää paikallinen
// valepalvelin, jolle lähteet ohjataan muuttujilla FMI_URL ja SAHKO_URL.
// Kanta on väliaikaisessa hakemistossa (ELAMA_DATA_DIR). Aja: npm test
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'elama-src-'));
process.env.ELAMA_DATA_DIR = TMP;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}

// ---------- Valepalvelin: sama XML-rakenne kuin opendata.fmi.fi ----------
const el = (time, name, value) => `<wfs:member><BsWfs:BsWfsElement>
  <BsWfs:Location><gml:Point><gml:pos>60.17523 24.94459 </gml:pos></gml:Point></BsWfs:Location>
  <BsWfs:Time>${time}</BsWfs:Time>
  <BsWfs:ParameterName>${name}</BsWfs:ParameterName>
  <BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>
</BsWfs:BsWfsElement></wfs:member>`;
const wrap = (members) => `<?xml version="1.0" encoding="UTF-8"?>\n<wfs:FeatureCollection>${members.join('\n')}</wfs:FeatureCollection>`;
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

const HOUR = 3600000;
const now = Date.now();
const nextHour = Math.ceil(now / HOUR) * HOUR;

function obsXml() {
  const t1 = now - 20 * 60000, t2 = now - 10 * 60000;
  return wrap([
    el(iso(t1), 't2m', '5.5'), el(iso(t1), 'ws_10min', '4.0'), el(iso(t1), 'wd_10min', '180.0'), el(iso(t1), 'rh', '81.0'),
    // Uusin mittaus: tuuli puuttuu (NaN) → käytetään edellistä arvoa.
    el(iso(t2), 't2m', '6.1'), el(iso(t2), 'ws_10min', 'NaN'), el(iso(t2), 'wd_10min', '266.0'), el(iso(t2), 'rh', '68.4'),
    // Tuntematon suure ja haitallinen arvo: molemmat ohitetaan.
    el(iso(t2), 'salainen', '1'), el(iso(t2), 't2m', '<script>alert(1)</script>'), el('ei-aika', 't2m', '99'),
  ]);
}
function fcXml() {
  const m = [];
  for (let i = 0; i < 72; i++) {
    const t = iso(nextHour + i * HOUR);
    m.push(el(t, 'Temperature', (5 + (i % 24) / 10).toFixed(1)), el(t, 'FeelsLike', '1.5'), el(t, 'WindSpeedMS', '5.3'),
      el(t, 'WindDirection', '225.0'), el(t, 'PoP', '40.0'), el(t, 'Precipitation1h', '0.5'), el(t, 'SmartSymbol', i % 2 ? '107' : '31'));
  }
  return wrap(m);
}

// ---------- Sähkön hinta: sama JSON-rakenne kuin api.porssisahko.net ----------
const QUARTER = 15 * 60000;
const hki = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
function hkiParts(ms) {
  const p = {};
  for (const x of hki.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
// Suomen ajan keskiyö: kuljetaan tunti kerrallaan taaksepäin, kunnes päivä vaihtuu
// (toimii myös kesä- ja talviajan vaihtopäivinä).
function hkiMidnight(ms) {
  let t = Math.floor(ms / HOUR) * HOUR;
  const date = hkiParts(t).date;
  while (hkiParts(t - HOUR).date === date) t -= HOUR;
  return t;
}
const midnight = hkiMidnight(now);
const midnight2 = hkiMidnight(midnight + 26 * HOUR); // huomisen alku
const midnight3 = hkiMidnight(midnight2 + 26 * HOUR); // ylihuomisen alku
const sahkoPrice = (t) => Math.round((5 + hkiParts(t).hour * 0.5 + ((t % HOUR) / QUARTER) * 0.1) * 1000) / 1000;
function sahkoJson(from) {
  const prices = [];
  // Kuten oikea rajapinta: uusin ensin, ja tunti ylihuomisen puolelle.
  for (let t = midnight3 + HOUR - QUARTER; t >= from; t -= QUARTER) {
    prices.push({ price: sahkoPrice(t), startDate: new Date(t).toISOString(), endDate: new Date(t + QUARTER - 1).toISOString() });
  }
  // Kelvottomat rivit: jokainen ohitetaan.
  prices.push(null, { price: '<script>alert(1)</script>', startDate: new Date(midnight).toISOString() },
    { price: 99999, startDate: new Date(midnight + HOUR).toISOString() }, { price: NaN, startDate: new Date(midnight).toISOString() },
    { price: 7, startDate: 'ei-aika' }, { price: 7, startDate: new Date(midnight + 7 * 60000).toISOString() }, { startDate: 5, price: 7 });
  return JSON.stringify({ prices });
}
let sahkoMode = 'ok';
let sahkoFrom = midnight;
let sahkoSeen = 0;

let mode = 'ok';
const seen = [];
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v2/latest-prices.json') {
    sahkoSeen++;
    if (sahkoMode === 'error') { res.writeHead(429); return res.end('liikaa'); }
    if (sahkoMode === 'garbage') { res.writeHead(200); return res.end('<html>huoltokatko</html>'); }
    if (sahkoMode === 'huge') { res.writeHead(200); return res.end('x'.repeat(1024 * 1024)); }
    if (sahkoMode === 'empty') { res.writeHead(200); return res.end('{"prices":[]}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(sahkoJson(sahkoFrom));
  }
  seen.push(u.searchParams);
  if (mode === 'error') { res.writeHead(500); return res.end('rikki'); }
  if (mode === 'garbage') { res.writeHead(200); return res.end('<html>huoltokatko</html>'); }
  if (mode === 'huge') { res.writeHead(200); return res.end('x'.repeat(4 * 1024 * 1024)); }
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(u.searchParams.get('storedquery_id').includes('observations') ? obsXml() : fcXml());
});

async function main() {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.FMI_URL = `http://127.0.0.1:${fake.address().port}/wfs`;
  process.env.SAHKO_URL = `http://127.0.0.1:${fake.address().port}/v2/latest-prices.json`;

  const saa = require('../sources/saa');
  const db = require('../db');
  const mount = require('../dashboard-sources');

  // --- Jäsennys oikealla Ilmatieteen laitoksen vastauksella (ote) ---
  const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'fmi-havainnot-ote.xml'), 'utf8');
  const realRows = saa.parseSimple(real, ['t2m', 'ws_10min', 'r_1h']);
  const realVals = [...realRows.values()][0];
  ok('oikea FMI-vastaus jäsentyy', realRows.size === 1 && realVals.t2m === 6.1 && realVals.ws_10min === 5);
  ok('NaN-arvo (mittaus puuttuu) ohitetaan', [...realRows.values()].every((r) => r.r_1h === undefined));
  ok('vain pyydetyt suureet otetaan mukaan', realVals.wg_10min === undefined);
  ok('tyhjä tai rikkinäinen XML antaa tyhjän tuloksen', saa.parseSimple('', ['t2m']).size === 0
    && saa.parseSimple('<a><b>', ['t2m']).size === 0 && saa.parseSimple(null, ['t2m']).size === 0);

  // --- Haku valepalvelimelta ---
  const w = await saa.fetch();
  ok('viimeisin havainto on nykylämpötila', w.temp === 6.1 && w.humidity === 68, JSON.stringify([w.temp, w.humidity]));
  ok('puuttuva mittaus korvataan edellisellä arvolla', w.wind === 4 && w.wind_dir === 266);
  ok('haitallinen arvo ja virheellinen aikaleima ohitetaan', typeof w.temp === 'number' && w.temp !== 99);
  ok('ennusteessa 24 tuntia aikajärjestyksessä', w.hours.length === 24
    && w.hours.every((h, i) => i === 0 || h.time > w.hours[i - 1].time));
  ok('ennusteen tunnit ovat lukuja', w.hours.every((h) => typeof h.temp === 'number' && typeof h.hour === 'number'
    && h.hour >= 0 && h.hour <= 23 && /^\d{4}-\d{2}-\d{2}$/.test(h.date)));
  ok('tunti ja päivä ovat Helsingin ajassa', (() => {
    const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki', hour: '2-digit', hourCycle: 'h23' })
      .format(new Date(w.hours[0].time));
    return Number(p) === w.hours[0].hour;
  })());
  ok('päiväkooste: alin, ylin ja sadesumma', w.days.length >= 2 && w.days.every((d) => d.min <= d.max && d.rain > 0)
    && w.days[1].hours === 24 && w.days[1].rain === 12, JSON.stringify(w.days));
  ok('päivän symboli on päiväversio', w.days.every((d) => d.symbol < 100));
  ok('vajaa viimeinen päivä jätetään pois', w.days.slice(1).every((d) => d.hours >= 12));
  ok('haussa pyydetään Helsinkiä ja oikeita suureita', seen.length === 2 && seen.every((q) => q.get('place') === 'Helsinki')
    && seen.some((q) => q.get('parameters').includes('SmartSymbol')) && seen.some((q) => q.get('parameters').includes('t2m')));

  // --- Välimuisti ja virhetilanteet ---
  const routes = {};
  const logs = [];
  const srv = mount({ get: (p, fn) => { routes[p] = fn; } }, db, { enabled: false, log: (m) => logs.push(m) });
  const get = () => { let out; routes['/api/dashboard']({}, { json: (v) => { out = v; } }); return out; };

  ok('ennen ensimmäistä hakua data on tyhjä', get().saa.data === null && get().saa.failing === false && get().saa.fetched_at === null);
  await srv.refresh(srv.sources[0]);
  const first = get().saa;
  ok('onnistunut haku tallentuu ja tarjoillaan', first.data.temp === 6.1 && first.failing === false && !!first.fetched_at);

  mode = 'error';
  await srv.refresh(srv.sources[0]);
  const afterErr = get().saa;
  ok('lähteen virhe säilyttää viimeisimmän datan ja merkitsee tilan', afterErr.data.temp === 6.1 && afterErr.failing === true
    && afterErr.fetched_at === first.fetched_at);
  ok('virhe kirjataan lokiin', logs.length === 1 && logs[0].includes('500'));
  ok('virheen teksti ei vuoda selaimelle', !JSON.stringify(afterErr).includes('500') && afterErr.error === undefined);

  mode = 'garbage';
  await srv.refresh(srv.sources[0]);
  ok('roskavastaus ei korvaa dataa', get().saa.data.temp === 6.1 && get().saa.failing === true);

  mode = 'huge';
  await srv.refresh(srv.sources[0]);
  ok('ylisuuri vastaus hylätään', get().saa.data.temp === 6.1 && logs[logs.length - 1].includes('suuri'), logs[logs.length - 1]);

  mode = 'ok';
  await srv.refresh(srv.sources[0]);
  ok('lähteen toivuttua tila palautuu', get().saa.failing === false && get().saa.fetched_at >= first.fetched_at);

  // Rinnakkaiset haut: toinen kutsu ei käynnistä uutta hakua kesken edellisen.
  const before = seen.length;
  await Promise.all([srv.refresh(srv.sources[0]), srv.refresh(srv.sources[0])]);
  ok('päällekkäinen haku ohitetaan', seen.length - before === 2, String(seen.length - before));

  // Kannassa oleva rikkinäinen JSON ei kaada reittiä.
  db.prepare("UPDATE dashboard_cache SET data = '{rikki' WHERE source = 'saa'").run();
  ok('rikkinäinen välimuisti ei kaada reittiä', get().saa.data === null);

  // ====================== Sähkön hinta (sources/sahko.js) ======================
  const sahko = require('../sources/sahko');
  ok('sähkön hinta on lähdelistassa ja haetaan enintään kerran tunnissa',
    srv.sources.some((x) => x.id === 'sahko') && sahko.intervalMs >= HOUR);

  // --- Jäsennys oikealla porssisahko.net-vastauksella (ote) ---
  const realPrices = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'porssisahko-ote.json'), 'utf8'));
  const realQ = sahko.parsePrices(realPrices);
  const realBuilt = sahko.buildPrices(realQ, Date.parse('2026-11-10T08:00:00Z'));
  ok('oikea porssisahko.net-vastaus jäsentyy', realQ.size === 8 && realBuilt.hours.length === 2
    && realBuilt.hours[0].price === 1.177 && realBuilt.hours[0].hour === 1 && realBuilt.hours[0].date === '2026-11-10',
    JSON.stringify(realBuilt.hours[0]));
  ok('tyhjä tai rikkinäinen vastaus antaa tyhjän tuloksen', sahko.parsePrices(null).size === 0
    && sahko.parsePrices({}).size === 0 && sahko.parsePrices({ prices: 'x' }).size === 0 && sahko.parsePrices({ prices: [1, 'a', {}] }).size === 0);
  ok('hintarajan ylittävä luku ei ole hinta', sahko.parsePrices({ prices: [
    { price: 1001, startDate: '2026-11-10T00:00:00.000Z' }, { price: -101, startDate: '2026-11-10T00:15:00.000Z' },
    { price: -0.002, startDate: '2026-11-10T00:30:00.000Z' }] }).size === 1);
  let noToday = '';
  try { sahko.buildPrices(realQ, Date.parse('2026-11-13T08:00:00Z')); } catch (e) { noToday = e.message; }
  ok('vanhentunut vastaus (ei tämän päivän hintoja) on virhe', noToday.includes('tämän päivän'), noToday);

  // --- Haku valepalvelimelta ---
  const today = hkiParts(now).date;
  const tomorrow = hkiParts(midnight2).date;
  const e1 = await sahko.fetch();
  const todayHours = e1.hours.filter((h) => h.date === today);
  const tomorrowHours = e1.hours.filter((h) => h.date === tomorrow);
  ok('hinnat tälle ja huomiselle päivälle tunneittain', todayHours.length === (midnight2 - midnight) / HOUR
    && tomorrowHours.length === (midnight3 - midnight2) / HOUR && todayHours.length >= 23, todayHours.length + '/' + tomorrowHours.length);
  ok('vajaa ylihuominen (yksi tunti) jätetään pois', e1.hours.every((h) => h.date === today || h.date === tomorrow));
  ok('tunnit ovat aikajärjestyksessä ja Suomen ajassa', e1.hours.every((h, i) => i === 0 || h.time > e1.hours[i - 1].time)
    && e1.hours[0].hour === 0 && e1.hours.every((h) => hkiParts(Date.parse(h.time)).hour === h.hour));
  const h7 = todayHours.find((h) => h.hour === 7);
  ok('tunnin hinta on varttien keskiarvo', h7.quarters.length === 4 && h7.quarters[0] === 8.5 && h7.quarters[3] === 8.8
    && h7.price === 8.65, JSON.stringify(h7));
  ok('kelvottomat rivit ohitetaan', e1.hours.every((h) => typeof h.price === 'number' && h.price < 100
    && h.quarters.every((q) => typeof q === 'number')) && !JSON.stringify(e1).includes('script'));
  ok('yksikkö ja arvonlisävero kerrotaan', e1.unit === 'snt/kWh' && e1.vat_included === true);

  // Iltapäivällä rajapinnan ikkuna siirtyy ja päivän alku putoaa pois vastauksesta.
  sahkoFrom = midnight + 2 * HOUR;
  const e2 = await sahko.fetch();
  ok('aiemmin nähdyt tunnit säilyvät, kun rajapinnan ikkuna siirtyy',
    e2.hours.filter((h) => h.date === today).length === todayHours.length && e2.hours[0].hour === 0);
  sahkoFrom = midnight;

  // --- Välimuisti ja virhetilanteet ---
  const src = srv.sources.find((x) => x.id === 'sahko');
  ok('ennen ensimmäistä tallennusta sähkön data on tyhjä', get().sahko.data === null && get().sahko.failing === false);
  await srv.refresh(src);
  const s1 = get().sahko;
  ok('sähkön hinnat tallentuvat ja tarjoillaan', s1.data.hours.length === e1.hours.length && s1.failing === false && !!s1.fetched_at);
  const logsBefore = logs.length;
  sahkoMode = 'error';
  await srv.refresh(src);
  ok('rajoitusvastaus (429) säilyttää viimeisimmät hinnat', get().sahko.data.hours.length === e1.hours.length
    && get().sahko.failing === true && get().sahko.fetched_at === s1.fetched_at && logs[logs.length - 1].includes('429'));
  ok('sähkön virheen teksti ei vuoda selaimelle', !JSON.stringify(get().sahko).includes('429'));
  sahkoMode = 'garbage';
  await srv.refresh(src);
  ok('roskavastaus ei korvaa hintoja', get().sahko.data.hours.length === e1.hours.length && logs[logs.length - 1].includes('JSON'));
  sahkoMode = 'huge';
  await srv.refresh(src);
  ok('ylisuuri hintavastaus hylätään', get().sahko.data.hours.length === e1.hours.length && logs[logs.length - 1].includes('suuri'));
  sahkoMode = 'empty';
  await srv.refresh(src);
  ok('tyhjä hintalista on virhe eikä tyhjennä korttia', get().sahko.data.hours.length === e1.hours.length
    && logs[logs.length - 1].includes('kelvollisia') && logs.length === logsBefore + 4);
  sahkoMode = 'ok';
  await srv.refresh(src);
  ok('sähkön lähteen toivuttua tila palautuu', get().sahko.failing === false && get().sahko.fetched_at >= s1.fetched_at);
  ok('reitti palauttaa molemmat lähteet ja sähkön haut menivät omaan osoitteeseensa',
    Object.keys(get()).sort().join() === 'saa,sahko' && sahkoSeen === 8, String(sahkoSeen));

  fake.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nLähdetestit: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Testiajo kaatui:', e); process.exit(1); });
