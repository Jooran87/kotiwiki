'use strict';
/* ============================================================================
   Dashboardin korttirunko
   ----------------------------------------------------------------------------
   Etusivu koostuu KORTEISTA. Jokainen kortti on itsenäinen pala, joka
   rekisteröidään tähän – etusivun koodiin ei tarvitse koskea uutta korttia
   lisätessä.

   UUDEN KORTIN LISÄÄMINEN:

     Dashboard.register({
       id: 'saa',                    // pysyvä tunniste (asetuksissa, järjestys)
       title: 'Sää',                 // otsikkorivin teksti
       slot: 'rail',                 // 'main' = leveä palsta, 'rail' = oikea kaista
       order: 20,                    // pienempi ensin
       icon: 'droplet',              // valinnainen, app.js:n ICON_PATHS
       // Valinnainen: hakee datan. Palautettu arvo tulee renderin ensimmäiseksi
       // argumentiksi. Virhe tässä ei kaada dashboardia (kortti näyttää virheen).
       load: async () => Store.dashboard.get('saa'),
       // Palauttaa kortin sisällön HTML:nä. MUISTA esc() kaikelle mikä tulee
       // ulkopuolelta – myös rajapinnan vastauksille.
       render: (data) => `<div class="dash-body">${esc(data.lampotila)} °C</div>`,
       // Valinnainen: tapahtumankäsittelijät renderöinnin jälkeen.
       bind: (el, data) => {},
     });

   MIKSI load JA render ON EROTETTU:
   kaikkien korttien datat haetaan rinnakkain, joten hidas lähde ei jarruta
   muita. Yksittäisen kortin virhe jää sen omaan laatikkoon.

   ULKOISET LÄHTEET (uutiset, sää, korot) EIVÄT KUULU TÄNNE:
   ne haetaan palvelimella ja tarjoillaan valmiiksi haettuna. Selain ei ota
   yhteyttä ulos – näin tiukka CSP säilyy, avaimet pysyvät palvelimella ja
   viimeisin onnistunut arvo voidaan näyttää vaikka lähde olisi alhaalla.
   ========================================================================== */

const Dashboard = (() => {
  const cards = [];

  // Käyttäjän piilottamat kortit (muistetaan selaimeen).
  const HIDDEN_KEY = 'elama_dash_hidden';
  const hidden = () => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
    catch (_) { return new Set(); }
  };
  const setHidden = (set) => {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch (_) {}
  };

  function register(card) {
    if (!card || !card.id || typeof card.render !== 'function') {
      throw new Error('Dashboard.register: id ja render ovat pakollisia');
    }
    if (cards.some((c) => c.id === card.id)) {
      throw new Error('Dashboard.register: id on jo käytössä: ' + card.id);
    }
    cards.push({ slot: 'main', order: 100, ...card });
  }

  const visible = () => {
    const off = hidden();
    return cards.filter((c) => !off.has(c.id)).sort((a, b) => a.order - b.order);
  };

  // Kortin kehys. Sisältö tulee myöhemmin (load on asynkroninen), joten
  // ensin piirretään luuranko – näin asettelu ei hyppää datan saapuessa.
  function shellHtml(c) {
    return `<section class="d2-card dash-card" data-card="${esc(c.id)}">
      <div class="d2-cardhead">
        ${c.icon ? icon(c.icon) : ''}<h3>${esc(c.title || c.id)}</h3>
        ${c.headExtra || ''}
        <button class="dash-hide" data-hide="${esc(c.id)}" title="Piilota kortti">${icon('close', 'ic-sm')}</button>
      </div>
      <div class="dash-slot" data-slot="${esc(c.id)}"><div class="dash-skel"></div></div>
    </section>`;
  }

  // Piirtää kaikki kortit ja täyttää ne sitä mukaa kun data saapuu.
  async function render(root) {
    const list = visible();
    const inSlot = (s) => list.filter((c) => c.slot === s).map(shellHtml).join('');
    root.innerHTML = `
      <div class="d2-home">
        <div class="d2-main">${inSlot('main') || emptyHtml('main')}</div>
        <div class="d2-rail">${inSlot('rail')}</div>
      </div>`;

    root.querySelectorAll('[data-hide]').forEach((b) => b.onclick = () => {
      const h = hidden(); h.add(b.dataset.hide); setHidden(h);
      toast('Kortti piilotettu – saat sen takaisin Asetuksista');
      render(root);
    });

    // Kaikki kortit rinnakkain: hidas lähde ei jarruta muita.
    await Promise.all(list.map(async (c) => {
      const slot = root.querySelector(`[data-slot="${CSS.escape(c.id)}"]`);
      if (!slot) return;
      try {
        const data = c.load ? await c.load() : null;
        slot.innerHTML = c.render(data);
        if (c.bind) c.bind(slot, data);
      } catch (err) {
        // Yksittäisen kortin virhe ei saa kaataa koko etusivua.
        slot.innerHTML = `<div class="dash-err">${icon('warn', 'ic-sm')} ${esc(err.message || 'Tietoja ei saatu')}</div>`;
      }
    }));
  }

  const emptyHtml = () => `<div class="d2-card"><div class="dash-empty">
    Kaikki kortit on piilotettu. Palauta ne Asetuksista.</div></div>`;

  return {
    register,
    render,
    all: () => cards.slice().sort((a, b) => a.order - b.order),
    isHidden: (id) => hidden().has(id),
    show: (id) => { const h = hidden(); h.delete(id); setHidden(h); },
    hide: (id) => { const h = hidden(); h.add(id); setHidden(h); },
  };
})();
