// Tab navigation. The open tab is kept in the address (#training), so a reload stays on it.
// Follows the WAI-ARIA tabs pattern: arrow keys move between tabs.

const DEFAULT_TAB = 'training';

/** On a phone the tab row scrolls sideways: scroll it so the chosen tab is fully visible.
    Sets scrollLeft directly (scrollIntoView is ignored while the page is still loading). */
function revealTab(tab) {
  const row = tab.parentElement, pad = 16;
  const t = tab.getBoundingClientRect(), r = row.getBoundingClientRect();
  if (t.left < r.left + pad) row.scrollLeft += t.left - r.left - pad;
  else if (t.right > r.right - pad) row.scrollLeft += t.right - r.right + pad;
}

export function initTabs(onShow) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const names = tabs.map(t => t.dataset.tab);

  function show(name, focus = false) {
    if (!names.includes(name)) name = DEFAULT_TAB;
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      if (on) {
        if (focus) t.focus();
        revealTab(t);
      }
    }
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    onShow(name);
  }

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  document.querySelector('[role="tablist"]').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    show(names[(next + tabs.length) % tabs.length], true);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  show(location.hash.slice(1));
}
