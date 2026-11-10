// Ulkoisten lähteiden testit (sää). Verkkoa EI käytetä: Ilmatieteen laitosta
// esittää paikallinen valepalvelin, jolle sources/saa.js ohjataan FMI_URL:lla.
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

let mode = 'ok';
const seen = [];
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
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

  fake.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nLähdetestit: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Testiajo kaatui:', e); process.exit(1); });
