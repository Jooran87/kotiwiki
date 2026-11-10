'use strict';
// Etusivun ulkoiset lähteet (sää ja sähkön hinta, myöhemmin uutiset...).
//
// Selain EI ota yhteyttä ulos. Palvelin hakee datan ajastetusti, tallentaa
// viimeisimmän onnistuneen tuloksen SQLiteen (taulu dashboard_cache) ja
// tarjoilee sen reitistä GET /api/dashboard. Näin
//   - tiukka CSP säilyy ja mahdolliset avaimet pysyvät palvelimella
//   - yksi haku palvelee kaikkia laitteita
//   - lähteen ollessa alhaalla näytetään viimeisin arvo (failing = true)
//
// UUSI LÄHDE: tee sources/<nimi>.js, joka vie { id, intervalMs, fetch },
// ja lisää se SOURCES-listaan. fetch palauttaa JSON-kelpoisen olion tai
// heittää virheen. Kortti lukee sen: Store.dashboard.get('<nimi>').
//
// ELAMA_SOURCES=off estää haut kokonaan (testit, koneet ilman verkkoa).

const SOURCES = [require('./sources/saa'), require('./sources/sahko')];

module.exports = function mountSources(app, db, opts = {}) {
  const sources = opts.sources || SOURCES;
  const enabled = opts.enabled !== undefined ? opts.enabled : process.env.ELAMA_SOURCES !== 'off';
  const log = opts.log || ((msg) => console.warn(msg));
  const running = new Set();

  const saveOk = db.prepare(`INSERT INTO dashboard_cache (source, data, fetched_at, failed_at, error)
    VALUES (?, ?, ?, NULL, '') ON CONFLICT(source) DO UPDATE SET data = excluded.data,
    fetched_at = excluded.fetched_at, failed_at = NULL, error = ''`);
  // Epäonnistunut haku EI koske aiempaan dataan: vain virhe kirjataan.
  const saveFail = db.prepare(`INSERT INTO dashboard_cache (source, data, fetched_at, failed_at, error)
    VALUES (?, '', NULL, ?, ?) ON CONFLICT(source) DO UPDATE SET failed_at = excluded.failed_at,
    error = excluded.error`);

  async function refresh(src) {
    if (running.has(src.id)) return; // edellinen haku on vielä kesken
    running.add(src.id);
    try {
      const data = await src.fetch();
      saveOk.run(src.id, JSON.stringify(data), new Date().toISOString());
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 300);
      saveFail.run(src.id, new Date().toISOString(), msg);
      log(`Lähde "${src.id}": haku epäonnistui: ${msg}`);
    } finally {
      running.delete(src.id);
    }
  }

  if (enabled) {
    for (const src of sources) {
      // unref(): ajastin ei pidä prosessia (eikä testiajoa) hengissä.
      setTimeout(() => refresh(src), 1500).unref();
      setInterval(() => refresh(src), src.intervalMs).unref();
    }
  }

  // { saa: { data, fetched_at, failing }, sahko: { ... } }. Virheen teksti jää palvelimen
  // lokiin ja kantaan; selaimelle kerrotaan vain, että haku ei onnistu.
  app.get('/api/dashboard', (req, res) => {
    const rows = db.prepare('SELECT * FROM dashboard_cache').all();
    const out = {};
    for (const src of sources) {
      const row = rows.find((r) => r.source === src.id);
      let data = null;
      if (row && row.data) { try { data = JSON.parse(row.data); } catch (_) { data = null; } }
      out[src.id] = { data, fetched_at: (row && row.fetched_at) || null, failing: !!(row && row.failed_at) };
    }
    res.json(out);
  });

  return { refresh, sources };
};
