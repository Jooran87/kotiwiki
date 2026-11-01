// Kokoaa wikin sisällöstä yhden itsenäisen OFFLINE-HTML-tiedoston, joka
// toimii puhelimessa ilman verkkoa (nettikatkos, kentän katvealue tms.).
// Sama koodi toimii sekä selaimessa (sandbox) että Node.js:ssä (palvelin).
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  // Sama kevyt Markdown-renderöinti kuin sovelluksessa.
  function renderMarkdown(md) {
    const lines = esc(md).split('\n');
    let html = '', inList = false, inCode = false;
    const inline = (t) => t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // Liitekuvat eivät sisälly offline-versioon – näytetään merkintä.
      .replace(/!\[([^\]]*)\]\(liite:\d+\)/g, '<em style="color:#93a0b1">[kuva: ei sisälly offline-versioon]</em>')
      .replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px" />')
      .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
    for (const raw of lines) {
      if (raw.trim().startsWith('```')) {
        if (inCode) { html += '</code></pre>'; inCode = false; }
        else { if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
        continue;
      }
      if (inCode) { html += raw + '\n'; continue; }
      const h = raw.match(/^(#{1,3})\s+(.*)$/);
      const li = raw.match(/^\s*[-*]\s+(.*)$/);
      if (h) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      } else if (li) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline(li[1])}</li>`;
      } else if (raw.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
      } else if (raw.trim().startsWith('&gt;')) {
        html += `<blockquote>${inline(raw.replace(/^\s*&gt;\s?/, ''))}</blockquote>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<p>${inline(raw)}</p>`;
      }
    }
    if (inList) html += '</ul>';
    if (inCode) html += '</code></pre>';
    return html;
  }

  // data: { generatedAt, categories, pages, terms, contacts, announcements }
  function buildOfflineHtml(data) {
    const cats = (data.categories || []).slice();
    const pages = (data.pages || []).slice();
    const terms = (data.terms || []).slice().sort((a, b) => a.term.localeCompare(b.term, 'fi'));
    const contacts = (data.contacts || []).slice();
    const links = (data.links || []).slice();
    const anns = (data.announcements || []).slice()
      .sort((a, b) => (b.pinned - a.pinned) || String(b.created_at).localeCompare(String(a.created_at)));

    const pagesByCat = (catId) => pages.filter((p) => p.category_id === catId)
      .sort((a, b) => a.title.localeCompare(b.title, 'fi'));
    const orphans = pages.filter((p) => !cats.some((c) => c.id === p.category_id));
    const topCats = cats.filter((c) => !c.parent_id);
    const subCatsOf = (id) => cats.filter((c) => c.parent_id === id);

    const artHtml = (p) => `
      <details class="art">
        <summary>${esc(p.title)}</summary>
        <div class="doc">${p.content && p.content.trim() ? renderMarkdown(p.content) : '<p class="meta">Ei sisältöä.</p>'}</div>
        ${(p.attachments && p.attachments.length) ? `<p class="meta">📎 Liitteet (vain verkossa): ${p.attachments.map((a) => esc(a.original_name)).join(', ')}</p>` : ''}
        <p class="meta">Päivitetty ${fmtDate(p.updated_at)}${p.updated_by ? ' · ' + esc(p.updated_by) : ''}${p.verified_at ? ' · ✔ vahvistettu ' + fmtDate(p.verified_at) : ''}</p>
      </details>`;

    const catSection = (name, list) => list.length ? `
      <h2 class="cat">${esc(name)}</h2>
      ${list.map(artHtml).join('')}` : '';

    return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Työohjeet – offline</title>\n<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiNlYTZhMWUiLz48dGV4dCB4PSIzMiIgeT0iNDUiIGZvbnQtZmFtaWx5PSJBcmlhbCxIZWx2ZXRpY2Esc2Fucy1zZXJpZiIgZm9udC1zaXplPSIzOCIgZm9udC13ZWlnaHQ9IjgwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+UDwvdGV4dD48L3N2Zz4=" />
<style>
  :root { --brand:#ea6a1e; --ink:#b8500e; --soft:#fdeadd; --border:#e2e6ec; --muted:#6b7686; --text:#1c2430; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    color:var(--text); background:#fff; font-size:16px; line-height:1.55; }
  header { position:sticky; top:0; background:#fff; border-bottom:2px solid var(--brand);
    padding:10px 14px; z-index:10; }
  .brandrow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .mark { width:28px; height:28px; border-radius:7px; background:var(--brand); color:#fff;
    font-weight:800; display:inline-flex; align-items:center; justify-content:center; }
  .brandrow strong { font-size:16px; }
  .badge { background:#1c2430; color:#fff; font-size:10px; font-weight:700; padding:2px 8px;
    border-radius:9px; letter-spacing:.05em; }
  .gen { font-size:12px; color:var(--muted); margin:4px 0 8px; }
  #q { width:100%; padding:11px 14px; font-size:16px; border:1px solid var(--border);
    border-radius:22px; outline:none; }
  #q:focus { border-color:var(--brand); }
  #hits { font-size:12px; color:var(--muted); margin-top:4px; min-height:15px; }
  main, section { padding:8px 14px; }
  h2.cat, section > h2 { font-size:15px; text-transform:uppercase; letter-spacing:.04em;
    color:var(--ink); border-bottom:2px solid var(--soft); padding-bottom:4px; margin:20px 0 8px; }
  details.art { border:1px solid var(--border); border-radius:9px; margin-bottom:8px; overflow:hidden; }
  details.art summary { padding:13px 14px; font-weight:600; cursor:pointer; list-style-position:inside; }
  details.art[open] summary { background:var(--soft); }
  details.art .doc { padding:4px 16px 8px; }
  .doc h1 { font-size:19px; } .doc h2 { font-size:17px; } .doc h3 { font-size:16px; }
  .doc code { background:#eef2f7; padding:1px 5px; border-radius:4px; font-size:90%; }
  .doc pre { background:#1c2430; color:#e6edf3; padding:10px; border-radius:6px; overflow-x:auto; }
  .doc blockquote { border-left:3px solid var(--brand); margin:8px 0; padding:2px 12px; color:var(--muted); }
  .doc ul, .doc ol { padding-left:22px; }
  .meta { font-size:12px; color:var(--muted); padding:0 16px 10px; margin:0; }
  .contact { display:flex; flex-direction:column; padding:9px 0; border-bottom:1px solid var(--border); }
  .contact:last-child { border-bottom:none; }
  .contact b { font-size:15px; }
  .contact a { color:var(--ink); font-size:18px; font-weight:700; text-decoration:none; }
  .contact small { color:var(--muted); }
  .ann { border:1px solid var(--border); border-radius:9px; padding:10px 13px; margin-bottom:8px; }
  .ann.pin { background:var(--soft); border-color:#f5c9a4; }
  .ann b { display:block; }
  .ann .when { font-size:12px; color:var(--muted); }
  .term { padding:8px 0; border-bottom:1px solid var(--border); }
  .term:last-child { border-bottom:none; }
  .term b { color:var(--ink); }
  .hidden { display:none; }
  footer { padding:16px 14px 30px; font-size:12px; color:var(--muted); text-align:center; }
  /* Tumma tila automaattisesti puhelimen asetuksen mukaan */
  @media (prefers-color-scheme: dark) {
    :root { --ink:#f5944f; --soft:#3a2818; --border:#2b3442; --muted:#93a0b1; }
    body { background:#12161d; color:#e6ebf3; }
    header { background:#12161d; }
    .doc pre, .doc code { background:#263140; color:#e6edf3; }
    details.art[open] summary { background:var(--soft); }
    #q { background:#1b212b; color:#e6ebf3; }
  }
</style>
</head>
<body>
<header>
  <div class="brandrow">
    <span class="mark">O</span><strong>Oma dashboard</strong>
    <span class="badge">OFFLINE</span>
  </div>
  <div class="gen">Koottu ${fmtDate(data.generatedAt)} · toimii ilman verkkoa · liitetiedostot eivät sisälly</div>
  <input id="q" type="search" placeholder="Hae ohjeista ja termeistä…" autocomplete="off" />
  <div id="hits"></div>
</header>

<section>
  <h2>☎ Tärkeät numerot</h2>
  ${contacts.map((c) => `<div class="contact">
    <b>${esc(c.label)}</b>
    ${c.phone ? `<a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : ''}
    ${c.note ? `<small>${esc(c.note)}</small>` : ''}
  </div>`).join('') || '<p class="meta">Ei yhteystietoja.</p>'}
</section>

${links.length ? `<section>
  <h2>🔗 Linkit</h2>
  ${links.map((l) => `<div class="term"><b><a href="${esc(l.url)}">${esc(l.label)}</a></b>${l.note ? ' – ' + esc(l.note) : ''}<br/><small style="color:#6b7686">${esc(l.url)}</small></div>`).join('')}
  <p class="meta" style="padding:6px 0 0">Huom: linkit vaativat verkkoyhteyden.</p>
</section>` : ''}

${anns.length ? `<section>
  <h2>📢 Tiedotteet</h2>
  ${anns.map((a) => `<div class="ann ${a.pinned ? 'pin' : ''}">
    <b>${a.pinned ? '📌 ' : ''}${esc(a.title)}</b>
    ${a.content ? esc(a.content) : ''}
    <div class="when">${fmtDate(a.created_at)}${a.created_by ? ' · ' + esc(a.created_by) : ''}</div>
  </div>`).join('')}
</section>` : ''}

<main>
  ${topCats.map((c) => catSection(c.name, pagesByCat(c.id))
      + subCatsOf(c.id).map((s) => catSection(c.name + ' › ' + s.name, pagesByCat(s.id))).join('')
    ).join('')}
  ${catSection('Muut', orphans)}
</main>

<section>
  <h2>📖 Termipankki</h2>
  ${terms.map((t) => `<div class="term"><b>${esc(t.term)}</b> – ${esc(t.definition)}</div>`).join('')
    || '<p class="meta">Ei termejä.</p>'}
</section>

<footer>
  Oma dashboard · offline-kopio.<br/>
  Lataa uusi kopio wikistä säännöllisesti (📴 Offline-versio -nappi).
</footer>

<script>
/* Haku toimii ilman verkkoa. Huom: skripti-tagit kirjoitettu osissa,
   jotta tämä generaattori voidaan upottaa toisen sivun sisään. */
(function () {
  var q = document.getElementById('q');
  var hits = document.getElementById('hits');
  var arts = [].slice.call(document.querySelectorAll('details.art'));
  var terms = [].slice.call(document.querySelectorAll('.term'));
  var cats = [].slice.call(document.querySelectorAll('h2.cat'));
  q.addEventListener('input', function () {
    var s = q.value.trim().toLowerCase();
    var n = 0;
    arts.forEach(function (el) {
      var match = !s || el.textContent.toLowerCase().indexOf(s) !== -1;
      el.classList.toggle('hidden', !match);
      if (s && match) { el.open = true; n++; }
      if (!s) el.open = false;
    });
    terms.forEach(function (el) {
      var match = !s || el.textContent.toLowerCase().indexOf(s) !== -1;
      el.classList.toggle('hidden', !match);
      if (s && match) n++;
    });
    cats.forEach(function (h) {
      var el = h.nextElementSibling, any = false;
      while (el && el.tagName === 'DETAILS') {
        if (!el.classList.contains('hidden')) { any = true; break; }
        el = el.nextElementSibling;
      }
      h.classList.toggle('hidden', !any);
    });
    hits.textContent = s ? (n + ' osumaa') : '';
  });
})();
<\/script>
</body>
</html>
`;
  }

  root.buildOfflineHtml = buildOfflineHtml;
  if (typeof module !== 'undefined' && module.exports) module.exports = buildOfflineHtml;
})(typeof self !== 'undefined' ? self : this);
