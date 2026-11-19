const themeKey = 'startupbot-site-theme';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let preference;
try { preference = localStorage.getItem(themeKey); } catch {}
function applyTheme() {
  const dark = preference === 'dark' || (preference !== 'light' && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = dark ? '#0d121c' : '#f6f8fc';
  document.querySelector('#theme')?.setAttribute('aria-pressed', String(dark));
}
applyTheme();
systemTheme.addEventListener('change', applyTheme);
window.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('#theme');
  applyTheme();
  button?.addEventListener('click', () => {
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(themeKey, preference); } catch {}
    applyTheme();
  });
});
