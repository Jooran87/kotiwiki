/* Teema ennen renderöintiä, ettei sivu välähdä väärällä värillä.
   Erillinen tiedosto, jotta palvelimen Content-Security-Policy voi
   kieltää inline-skriptit kokonaan. */
(function () {
  try {
    var t = localStorage.getItem('elama_theme');
    if (!t && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark';
    document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
  } catch (e) { /* oletusteema kelpaa */ }
})();
