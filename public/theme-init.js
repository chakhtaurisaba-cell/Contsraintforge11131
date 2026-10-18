// Runs before first paint so the saved (or OS) theme is applied without a flash.
// Kept as an external file so the strict Content-Security-Policy needs no inline-script exception.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('cf-theme'); } catch (e) { /* storage blocked */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = theme === 'dark' ? '#0b0b0d' : '#ffffff';
  document.head.appendChild(meta);
})();
