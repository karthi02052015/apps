// Applied before first paint to avoid a light/dark flash. Kept external for a strict CSP.
(function () {
  try {
    var pref = localStorage.getItem('taskflow.theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    /* storage unavailable — fall back to light */
  }
})();
