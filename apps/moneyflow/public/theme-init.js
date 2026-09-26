/**
 * Applied before first paint so a dark-mode user never sees a white flash.
 * Kept as a separate file rather than an inline <script> so the page works
 * under a strict `script-src 'self'` Content Security Policy.
 */
(function () {
  try {
    var stored = localStorage.getItem('moneyflow.theme');
    var system = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || ((!stored || stored === 'system') && system);
    document.documentElement.classList.toggle('dark', dark);
  } catch (error) {
    /* private browsing — the app applies the theme on mount instead */
  }
})();
