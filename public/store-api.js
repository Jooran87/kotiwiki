'use strict';
// Datakerros PALVELINVERSIOLLE: puhuu REST-rajapinnalle (Node + SQLite).
// Sandbox-versio korvaa tämän tiedoston omalla localStorage-toteutuksellaan,
// mutta tarjoaa saman `Store`-rajapinnan, joten app.js pysyy samana.

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = 'Virhe';
    try { msg = (await res.json()).error || msg; } catch (_) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function jsonBody(method, obj) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function withAttachmentUrls(page) {
  page.attachments.forEach((a) => { a.url = '/api/attachments/' + a.id; });
  return page;
}

const Store = {
  mode: 'server',

  // Kirjautuminen (vain palvelinversiossa; sandboxissa Store.auth = null).
  auth: {
    status: () => api('/api/auth-status'),
    setup: (data) => api('/api/setup', jsonBody('POST', data)),
    login: (data) => api('/api/login', jsonBody('POST', data)),
    logout: () => api('/api/logout', { method: 'POST' }),
  },

  users: {
    list: () => api('/api/users'),
    create: (data) => api('/api/users', jsonBody('POST', data)),
    update: (id, data) => api('/api/users/' + id, jsonBody('PUT', data)),
    remove: (id) => api('/api/users/' + id, { method: 'DELETE' }),
  },

  categories: {
    list: () => api('/api/categories'),
    create: (data) => api('/api/categories', jsonBody('POST', data)),
    update: (id, data) => api('/api/categories/' + id, jsonBody('PUT', data)),
    // Poisto vaatii ylläpitäjän salasanan vahvistuksena (lähetetään bodyssa).
    remove: (id, password) => api('/api/categories/' + id, jsonBody('DELETE', { password })),
    reorder: (ids) => api('/api/categories/reorder', jsonBody('POST', { ids })),
  },

  contacts: {
    list: () => api('/api/contacts'),
    create: (data) => api('/api/contacts', jsonBody('POST', data)),
    update: (id, data) => api('/api/contacts/' + id, jsonBody('PUT', data)),
    remove: (id) => api('/api/contacts/' + id, { method: 'DELETE' }),
    reorder: (ids) => api('/api/contacts/reorder', jsonBody('POST', { ids })),
  },

  pages: {
    list: (categoryId) => api('/api/pages' + (categoryId ? '?category_id=' + categoryId : '')),
    get: (id, { track } = {}) => api('/api/pages/' + id + (track ? '?track=1' : '')).then(withAttachmentUrls),
    create: (data) => api('/api/pages', jsonBody('POST', data)),
    update: (id, data) => api('/api/pages/' + id, jsonBody('PUT', data)),
    // Poisto = siirto roskakoriin; vaatii salasanavahvistuksen.
    remove: (id, password) => api('/api/pages/' + id, jsonBody('DELETE', { password })),
    restore: (id) => api('/api/pages/' + id + '/restore', { method: 'POST' }),
    revisions: (id) => api('/api/pages/' + id + '/revisions'),
    verify: (id, author) => api('/api/pages/' + id + '/verify', jsonBody('POST', { author })),
    reorder: (ids) => api('/api/pages/reorder', jsonBody('POST', { ids })),
  },

  revisions: {
    get: (id) => api('/api/revisions/' + id),
  },

  trash: {
    list: () => api('/api/trash'),
    // Lopullinen poisto: vain ylläpitäjä + salasana.
    remove: (id, password) => api('/api/trash/' + id, jsonBody('DELETE', { password })),
  },

  links: {
    list: () => api('/api/links'),
    create: (data) => api('/api/links', jsonBody('POST', data)),
    update: (id, data) => api('/api/links/' + id, jsonBody('PUT', data)),
    remove: (id) => api('/api/links/' + id, { method: 'DELETE' }),
    reorder: (ids) => api('/api/links/reorder', jsonBody('POST', { ids })),
  },

  terms: {
    list: () => api('/api/terms'),
    create: (data) => api('/api/terms', jsonBody('POST', data)),
    update: (id, data) => api('/api/terms/' + id, jsonBody('PUT', data)),
    remove: (id) => api('/api/terms/' + id, { method: 'DELETE' }),
  },

  announcements: {
    list: (limit) => api('/api/announcements' + (limit ? '?limit=' + limit : '')),
    create: (data) => api('/api/announcements', jsonBody('POST', data)),
    update: (id, data) => api('/api/announcements/' + id, jsonBody('PUT', data)),
    remove: (id) => api('/api/announcements/' + id, { method: 'DELETE' }),
  },

  attachments: {
    // Vakaa osoite kuvaviittauksille artikkelin sisällä (liite:ID).
    url: (id) => Promise.resolve('/api/attachments/' + id),
    upload: (pageId, files, author) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('author', author);
      return api('/api/pages/' + pageId + '/attachments', { method: 'POST', body: fd });
    },
    remove: (id) => api('/api/attachments/' + id, { method: 'DELETE' }),
  },

  notes: {
    list: ({ categoryId, limit } = {}) => {
      const p = new URLSearchParams();
      if (categoryId) p.set('category_id', categoryId);
      if (limit) p.set('limit', limit);
      return api('/api/shift-notes?' + p.toString());
    },
    create: (data) => api('/api/shift-notes', jsonBody('POST', data)),
    remove: (id) => api('/api/shift-notes/' + id, { method: 'DELETE' }),
  },

  // Varmuusvarasto: { categories: [...], items: [...] }
  pantry: {
    list: () => api('/api/pantry'),
    lookup: (barcode) => api('/api/pantry/catalog/' + encodeURIComponent(barcode)),
    create: (data) => api('/api/pantry', jsonBody('POST', data)),
    update: (id, data) => api('/api/pantry/' + id, jsonBody('PUT', data)),
    useOne: (id) => api('/api/pantry/' + id + '/use', { method: 'POST' }),
    remove: (id) => api('/api/pantry/' + id, { method: 'DELETE' }),
  },

  // Yhteinen kauppalista. add: category on varaston kategoria vihjeeksi
  // osaston päättelyyn (valinnainen).
  shopping: {
    list: () => api('/api/shopping'),
    add: (text, qty, category) => api('/api/shopping', jsonBody('POST', { text, qty: qty || '', category })),
    update: (id, data) => api('/api/shopping/' + id, jsonBody('PUT', data)),
    remove: (id) => api('/api/shopping/' + id, { method: 'DELETE' }),
    clearDone: () => api('/api/shopping/clear-done', { method: 'POST' }),
  },

  // Toistuvat kotityöt. done: date on selaimen päivä (YYYY-MM-DD).
  chores: {
    list: () => api('/api/chores'),
    create: (data) => api('/api/chores', jsonBody('POST', data)),
    update: (id, data) => api('/api/chores/' + id, jsonBody('PUT', data)),
    done: (id, date) => api('/api/chores/' + id + '/done', jsonBody('POST', { date })),
    remove: (id) => api('/api/chores/' + id, { method: 'DELETE' }),
  },

  // Etusivun ulkoiset lähteet (sää ym.): palvelimen valmiiksi hakema data.
  // get('saa') → { data, fetched_at, failing } tai null.
  dashboard: {
    get: (id) => api('/api/dashboard').then((all) => all[id] || null),
  },

  // Reaaliaikaiset muutokset muilta laitteilta (Server-Sent Events).
  // on('shopping', fn) palauttaa funktion, jolla kuuntelun voi lopettaa.
  events: (() => {
    let es = null;
    const handlers = { pantry: new Set(), shopping: new Set(), chores: new Set() };
    function ensure() {
      if (es || typeof EventSource === 'undefined') return;
      es = new EventSource('/api/events');
      // Verkkokatkos: EventSource yhdistää itse. Jos palvelin vastaa virheellä
      // (esim. istunto vanheni), yhteys sulkeutuu pysyvästi → yritetään hetken päästä.
      es.onerror = () => {
        if (es && es.readyState === 2) {
          es = null;
          setTimeout(() => {
            if (Object.values(handlers).some((set) => set.size)) ensure();
          }, 10000);
        }
      };
      Object.keys(handlers).forEach((type) => {
        es.addEventListener(type, () => handlers[type].forEach((fn) => { try { fn(); } catch (_) {} }));
      });
    }
    return {
      on(type, fn) {
        if (!handlers[type]) return () => {};
        handlers[type].add(fn);
        ensure();
        return () => handlers[type].delete(fn);
      },
    };
  })(),

  search: (q) => api('/api/search?q=' + encodeURIComponent(q)).then((r) => {
    r.files.forEach((f) => { f.url = '/api/attachments/' + f.id; });
    return r;
  }),
};
