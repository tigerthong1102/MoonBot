const suggestedPlatform = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'win';
  if (/Mac OS|Macintosh/i.test(ua)) return 'mac';
};
const recommended = document.querySelector('[data-platform="' + suggestedPlatform() + '"] .suggested');
if (recommended) recommended.hidden = false;

for (const link of document.querySelectorAll('a[data-expires]')) {
  if (Date.parse(link.dataset.expires) <= Date.now()) {
    const label = document.createElement('span');
    label.className = 'note';
    label.textContent = link.closest('section').dataset.expired;
    link.replaceWith(label);
  }
}

const caseNav = document.querySelector('.case-nav');
if (caseNav) {
  const tabs = Array.from(caseNav.querySelectorAll('a'));
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));
  const select = index => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(index === i));
      tab.tabIndex = index === i ? 0 : -1;
      panels[i].hidden = index !== i;
    });
  };
  caseNav.setAttribute('role', 'tablist');
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[i].id);
    panels[i].setAttribute('role', 'tabpanel');
    panels[i].setAttribute('aria-labelledby', tab.id);
    panels[i].tabIndex = 0;
    tab.addEventListener('click', event => { event.preventDefault(); select(i); });
    tab.addEventListener('keydown', event => {
      const targets = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (!(event.key in targets)) return;
      event.preventDefault();
      const next = targets[event.key];
      select(next);
      tabs[next].focus();
    });
  });
  select(Math.max(0, tabs.findIndex(tab => tab.hash === location.hash)));
}
