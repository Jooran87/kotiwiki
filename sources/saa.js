'use strict';
// Sää Helsingistä Ilmatieteen laitoksen avoimesta datasta (opendata.fmi.fi).
//
// Kaksi hakua samasta rajapinnasta, avainta ei tarvita:
//   1. Havainnot: lähin mittausasema (Helsinki Kaisaniemi), viimeisin arvo
//   2. Ennuste: Ilmatieteen laitoksen meteorologin tarkistama ennuste, 72 h
//
// Lisenssi: CC BY 4.0. Lähde on mainittava siellä missä data näytetään
// (sääkortti tekee sen: "Lähde: Ilmatieteen laitos").
//
// Vastaus on XML:ää, jossa jokainen arvo on omana alkionaan (aika, suureen
// nimi, arvo). Se luetaan ilman XML-kirjastoa. Vastaukseen EI luoteta:
// mukaan otetaan vain kelvolliset aikaleimat ja luvut, kaikki muu hylätään.
//
// Paikan vaihto: muuta PLACE. Toinen paikkakunta rinnalle = toinen lähde
// samalla koodilla (ks. dashboard-sources.js).

const PLACE = 'Helsinki';
const ZONE = 'Europe/Helsinki';
// FMI_URL on testejä varten (paikallinen valepalvelin). Tuotannossa oletus.
const BASE = process.env.FMI_URL || 'https://opendata.fmi.fi/wfs';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3 * 1024 * 1024; // ennuste on noin 0,3 Mt; tätä isompi on virhe
const HOURS = 72;

const OBS_QUERY = 'fmi::observations::weather::simple';
const OBS_PARAMS = ['t2m', 'ws_10min', 'wd_10min', 'rh'];
const FC_QUERY = 'fmi::forecast::edited::weather::scandinavia::point::simple';
const FC_PARAMS = ['Temperature', 'FeelsLike', 'WindSpeedMS', 'WindDirection', 'PoP', 'Precipitation1h', 'SmartSymbol'];

const isoSec = (d) => d.toISOString().slice(0, 19) + 'Z';

function buildUrl(query, params, start, end) {
  const u = new URL(BASE);
  u.search = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'getFeature', storedquery_id: query,
    place: PLACE, parameters: params.join(','), starttime: isoSec(start), endtime: isoSec(end),
    timestep: query === OBS_QUERY ? '10' : '60',
  }).toString();
  return u.toString();
}

async function getXml(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  if (!res.ok) throw new Error(`Ilmatieteen laitos vastasi virheellä ${res.status}`);
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
  return Buffer.concat(chunks).toString('utf8');
}

// XML → Map(aikaleima ms → { suure: luku }). Vain tunnetut suureet ja
// äärelliset luvut kelpaavat ("NaN" = mittaus puuttuu).
const ELEMENT = /<BsWfs:Time>([^<]{1,40})<\/BsWfs:Time>\s*<BsWfs:ParameterName>([^<]{1,40})<\/BsWfs:ParameterName>\s*<BsWfs:ParameterValue>([^<]{0,40})<\/BsWfs:ParameterValue>/g;
function parseSimple(xml, allowed) {
  const rows = new Map();
  for (const m of String(xml).matchAll(ELEMENT)) {
    const t = Date.parse(m[1].trim());
    const name = m[2].trim();
    const raw = m[3].trim();
    const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(t) || !allowed.includes(name) || !Number.isFinite(value)) continue;
    if (!rows.has(t)) rows.set(t, {});
    rows.get(t)[name] = value;
  }
  return rows;
}

// Päivä ja tunti Helsingin ajassa (palvelin voi olla eri aikavyöhykkeellä).
const zoneFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
function localParts(ms) {
  const p = {};
  for (const part of zoneFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const num = (v) => (Number.isFinite(v) ? v : null);
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// Havainnot ja ennuste yhdeksi sääkortin tietorakenteeksi.
function buildWeather(obsRows, fcRows, now) {
  // Viimeisin havainto suureittain (uusin mittaus voi olla osin tyhjä).
  const latest = {};
  let observedAt = null;
  for (const t of [...obsRows.keys()].sort((a, b) => b - a)) {
    const row = obsRows.get(t);
    for (const name of OBS_PARAMS) {
      if (latest[name] === undefined && row[name] !== undefined) latest[name] = row[name];
    }
    if (observedAt === null && row.t2m !== undefined) observedAt = t;
  }

  const hours = [...fcRows.keys()].sort((a, b) => a - b)
    .filter((t) => t > now - 3600000 && fcRows.get(t).Temperature !== undefined)
    .map((t) => {
      const r = fcRows.get(t);
      const lp = localParts(t);
      return {
        time: new Date(t).toISOString(), date: lp.date, hour: lp.hour,
        temp: round1(r.Temperature), feels: round1(r.FeelsLike), wind: round1(r.WindSpeedMS),
        wind_dir: num(r.WindDirection), pop: num(r.PoP), rain: round1(r.Precipitation1h), symbol: num(r.SmartSymbol),
      };
    });
  if (!hours.length) throw new Error('Ennusteessa ei ollut yhtään kelvollista tuntia');

  // Päiväkohtainen kooste: alin ja ylin lämpötila, sadesumma, päivän symboli
  // (iltapäivän tunti, jos sellainen on mukana).
  const byDate = new Map();
  for (const h of hours) {
    if (!byDate.has(h.date)) byDate.set(h.date, []);
    byDate.get(h.date).push(h);
  }
  const days = [...byDate.entries()].map(([date, list], i) => ({ date, list, i }))
    // Vajaa viimeinen päivä (vain muutama yön tunti) jätetään pois.
    .filter(({ list, i }) => i === 0 || list.length >= 12)
    .map(({ date, list }) => {
    const temps = list.map((h) => h.temp);
    const mid = list.find((h) => h.hour === 14) || list.find((h) => h.hour >= 11 && h.hour <= 16) || list[0];
    return {
      date, hours: list.length, min: Math.min(...temps), max: Math.max(...temps),
      rain: round1(list.reduce((s, h) => s + (h.rain || 0), 0)),
      // Päivän symboli aina päiväversiona (yösymbolit ovat +100).
      symbol: mid.symbol === null ? null : mid.symbol % 100,
    };
  });

  const first = hours[0];
  if (latest.t2m === undefined && first.temp === null) throw new Error('Lämpötilaa ei saatu');
  return {
    place: PLACE,
    observed_at: observedAt === null ? null : new Date(observedAt).toISOString(),
    // Nykyhetki: mitattu arvo, ja jos asema ei juuri nyt vastaa, ennusteen arvo.
    temp: round1(latest.t2m !== undefined ? latest.t2m : first.temp),
    wind: round1(latest.ws_10min !== undefined ? latest.ws_10min : first.wind),
    wind_dir: num(latest.wd_10min !== undefined ? latest.wd_10min : first.wind_dir),
    humidity: latest.rh !== undefined ? Math.round(latest.rh) : null,
    feels: first.feels,
    symbol: first.symbol,
    hours: hours.slice(0, 24),
    days: days.slice(0, 4),
  };
}

async function fetchWeather() {
  const now = Date.now();
  const [obsXml, fcXml] = await Promise.all([
    getXml(buildUrl(OBS_QUERY, OBS_PARAMS, new Date(now - 2 * 3600000), new Date(now))),
    getXml(buildUrl(FC_QUERY, FC_PARAMS, new Date(now), new Date(now + HOURS * 3600000))),
  ]);
  return buildWeather(parseSimple(obsXml, OBS_PARAMS), parseSimple(fcXml, FC_PARAMS), now);
}

module.exports = {
  id: 'saa',
  intervalMs: 20 * 60 * 1000, // havainnot päivittyvät 10 min välein, ennuste harvemmin
  fetch: fetchWeather,
  // Testejä varten:
  parseSimple, buildWeather, OBS_PARAMS, FC_PARAMS,
};
