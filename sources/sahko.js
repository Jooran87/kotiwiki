'use strict';
// Pörssisähkön hinta Suomessa: porssisahko.net-palvelun avoin rajapinta.
//
// Yksi haku, avainta ei tarvita:
//   GET https://api.porssisahko.net/v2/latest-prices.json
//   → { prices: [{ price, startDate, endDate }] }, uusimmat 48 tuntia vartin
//     jaksoina (192 riviä). Yksikkö snt/kWh, arvonlisävero mukana. Huomisen
//     hinnat tulevat mukaan noin klo 14.
//
// Käyttöehdot (porssisahko.net/api, luettu 10.11.2026): rajapinta on vapaasti
// käytettävissä ja ilmainen. Raja on 30 pyyntöä 10 sekunnissa, mutta
// ylläpitäjä pyytää hakemaan harvoin, koska jokainen pyyntö maksaa hänelle:
// kaksi hakua päivässä riittäisi. Tässä haetaan kerran tunnissa, jotta
// huomisen hinnat näkyvät viimeistään tunnin kuluttua julkaisusta. ÄLÄ tihennä.
// Lähde mainitaan kortissa.
//
// Vastaukseen EI luoteta: mukaan otetaan vain rivit, joiden aikaleima on
// kelvollinen ja vartin tasalla ja joiden hinta on uskottava luku. Kaikki muu
// hylätään. Kortti (cards.js) tarkistaa arvot vielä kerran ja escapettaa ne.

const ZONE = 'Europe/Helsinki';
// SAHKO_URL on testejä varten (paikallinen valepalvelin). Tuotannossa oletus.
const URL_LATEST = process.env.SAHKO_URL || 'https://api.porssisahko.net/v2/latest-prices.json';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 512 * 1024; // oikea vastaus on noin 18 kt
const QUARTER = 15 * 60000;
const HOUR = 3600000;
// Pörssin hintarajat ovat −500 ja +4000 €/MWh eli veroineen noin −63 ja
// +502 snt/kWh. Näiden ulkopuolinen luku on virhe, ei hinta.
const MIN_PRICE = -100;
const MAX_PRICE = 1000;
const MAX_ROWS = 1000;

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`porssisahko.net vastasi virheellä ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('Vastaus on odottamattoman suuri');
  // Luetaan paloina ja katkaistaan, jos raja ylittyy (pituusotsake voi puuttua).
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Vastaus on odottamattoman suuri');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw new Error('Vastaus ei ollut JSONia');
  }
}

// Vastaus → Map(vartin alku ms → hinta). Kelpaamaton rivi ohitetaan.
function parsePrices(body) {
  const out = new Map();
  const rows = body && Array.isArray(body.prices) ? body.prices.slice(0, MAX_ROWS) : [];
  for (const row of rows) {
    if (!row || typeof row.price !== 'number' || !Number.isFinite(row.price)) continue;
    if (row.price < MIN_PRICE || row.price > MAX_PRICE) continue;
    if (typeof row.startDate !== 'string' || row.startDate.length > 40) continue;
    const t = Date.parse(row.startDate);
    if (!Number.isFinite(t) || t % QUARTER !== 0) continue;
    out.set(t, row.price);
  }
  return out;
}

// Päivä ja tunti Suomen ajassa (palvelin voi olla eri aikavyöhykkeellä).
const zoneFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
function localParts(ms) {
  const p = {};
  for (const part of zoneFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const round3 = (v) => Math.round(v * 1000) / 1000;
const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;

// Vartit tunneiksi. Tunnin hinta on sen varttien keskiarvo; kortti laskee
// päivän keskihinnan, alimman ja ylimmän tunnin näistä.
// Mukaan otetaan tunnit kuluvan päivän (Suomen aikaa) alusta eteenpäin.
function buildPrices(quarters, now) {
  const today = localParts(now).date;
  const byHour = new Map();
  for (const [t, price] of quarters) {
    const start = t - (t % HOUR);
    if (!byHour.has(start)) byHour.set(start, [null, null, null, null]);
    byHour.get(start)[(t - start) / QUARTER] = round3(price);
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b).map((start) => {
    const q = byHour.get(start);
    const lp = localParts(start);
    return { time: new Date(start).toISOString(), date: lp.date, hour: lp.hour, price: round3(mean(q.filter((v) => v !== null))), quarters: q };
  }).filter((h) => h.date >= today);
  if (!hours.some((h) => h.date === today)) throw new Error('Vastauksessa ei ollut tämän päivän hintoja');

  // Vajaa päivä jätetään pois: vastaus ulottuu Keski-Euroopan vuorokauden
  // loppuun eli tunnin yli Suomen keskiyön. Tämä päivä näytetään aina.
  const count = new Map();
  for (const h of hours) count.set(h.date, (count.get(h.date) || 0) + 1);
  return {
    unit: 'snt/kWh', vat_included: true,
    hours: hours.filter((h) => h.date === today || count.get(h.date) >= 12),
  };
}

// Rajapinta palauttaa liukuvan 48 tunnin ikkunan. Kun huomisen hinnat tulevat
// mukaan (noin klo 14), ikkunan alku siirtyy ja kuluvan päivän ensimmäinen
// tunti (klo 00) putoaa pois. Aiemmin nähdyt vartit pidetään siksi muistissa
// ja yhdistetään uuteen vastaukseen, jotta päivän kaavio ja keskihinta
// pysyvät kokonaisina. Palvelimen uudelleenkäynnistys iltapäivällä tyhjentää
// muistin: silloin klo 00 puuttuu loppupäivän, mikä näkyy vain kaavion alussa.
const memory = new Map();
const KEEP_MS = 36 * HOUR;

async function fetchPrices() {
  const now = Date.now();
  const fresh = parsePrices(await getJson(URL_LATEST));
  if (fresh.size < 4) throw new Error('Vastauksessa ei ollut kelvollisia hintoja');
  for (const [t, price] of fresh) memory.set(t, price);
  for (const t of memory.keys()) if (t < now - KEEP_MS) memory.delete(t);
  return buildPrices(memory, now);
}

module.exports = {
  id: 'sahko',
  intervalMs: 60 * 60 * 1000, // ks. käyttöehdot yllä: älä tihennä
  fetch: fetchPrices,
  // Testejä varten:
  parsePrices, buildPrices,
};
