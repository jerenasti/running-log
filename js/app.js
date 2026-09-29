// Entry point: loads the Garmin data and wires up the tabs.

import { state, save, restore } from './state.js';
import { fetchGarmin, garminToActivities, fetchContent, fetchStatus } from './data.js';
import { loadSettings, saveSettings, racesFromSettings, applySettings } from './settings.js';
import { parseDate } from './parse.js';
import { fmtDate, fmtTime, esc, setUnits } from './format.js';
import { initTabs } from './nav.js';
import { initTraining, renderTraining } from './tabs/training.js';
import { renderFitness } from './tabs/fitness.js';
import { renderRecovery } from './tabs/recovery.js';
import { renderNutrition } from './tabs/nutrition.js';
import { renderOverview } from './tabs/overview.js';
import { initSettings, renderSettings, renderWelcome, openSettings, startWelcome } from './tabs/settings.js';
import { renderViewState } from './tabs/states.js';

const $ = s => document.querySelector(s);
let fetchedAt = null;       // when data/activities.json was written, or null
let currentTab = null;

function notice(msg) { $('#notice').textContent = msg || ''; $('#notice').hidden = !msg; }

/** Render the header status and the open tab */
/** Header: time of the last SUCCESSFUL fetch (from activities.json) and whether the latest run worked */
function renderFetchStatus() {
  const fs = state.fetchStatus;
  const failed = fs?.ok === false;
  const el = $('#updated');
  el.hidden = !fetchedAt && !fs;
  // From the data file, or from the fetch status when the data file couldn't be read
  const when = fetchedAt || parseDate(fs?.ok ? fs.at : fs?.last_success);
  const last = when ? `Last successful fetch ${fmtDate(when)} at ${fmtTime(when)}` : 'No successful fetch yet';
  el.innerHTML = `<span>${last}</span>` + (failed
    ? `<a class="fetch-badge failed" href="#overview" title="${esc(fs.message || 'The last fetch failed')}">Fetch failed</a>`
    : `<span class="fetch-badge ok">OK</span>`);
}

function render() {
  renderFetchStatus();
  // Charts are drawn only for the visible tab (a hidden canvas has no size)
  if (currentTab === 'training') renderTraining();
  if (currentTab === 'fitness') renderFitness();
  if (currentTab === 'recovery') renderRecovery();
  if (currentTab === 'nutrition') renderNutrition();
  if (currentTab === 'overview') renderOverview();
  if (currentTab === 'settings') renderSettings();
  if (currentTab === 'welcome') renderWelcome();
  renderViewState(currentTab);   // loading skeleton or error card instead of an empty view
  markScrollable();
}

/** Tables wider than the screen scroll sideways: make those areas reachable and named for the keyboard */
function markScrollable() {
  for (const w of document.querySelectorAll('.table-wrap')) {
    const scrolls = w.scrollWidth > w.clientWidth + 1;
    if (scrolls) {
      w.tabIndex = 0;
      w.setAttribute('role', 'region');
      const title = w.closest('.card, details')?.querySelector('h2, summary')?.textContent.trim();
      w.setAttribute('aria-label', (title ? title + ': ' : '') + 'table, scrolls sideways');
    } else {
      w.removeAttribute('tabindex'); w.removeAttribute('role'); w.removeAttribute('aria-label');
    }
  }
}
window.addEventListener('resize', markScrollable);

/** Light / dark / same as the system (appearance.theme); tokens.css reads <html data-theme> */
function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** Use a (new) settings object everywhere: races, weekly goal, Garmin data with manual values, theme */
function useSettings(settings) {
  state.settings = settings;
  state.content = { ...state.content, races: { data: { races: racesFromSettings(settings) } } };
  state.goal = settings.goals.weekly_km || 0;
  state.meta = applySettings(state.garminMeta, settings);
  state.theme = settings.appearance.theme;
  state.units = settings.appearance.units;
  applyTheme(state.theme);
  setUnits(state.units);
  save();
  render();
}

/** Load data/activities.json (again) and show it; state.load says how it went */
async function loadGarmin() {
  let o;
  try {
    o = await fetchGarmin();
  } catch (err) {
    state.load = { status: err.missing ? 'missing' : 'error', error: err };
    throw err;
  }
  state.load = { status: 'ready', error: null };
  fetchedAt = parseDate(o.fetchedAt);
  state.fetchedAt = fetchedAt?.getTime() ?? null;
  const { acts, meta } = garminToActivities(o);
  state.acts = acts;
  state.garminMeta = meta;
  state.meta = applySettings(meta, state.settings);
  save();
}

// Redraw charts when the system switches between light and dark mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

/* ---------- Startup ---------- */
if (typeof Chart === 'undefined') notice('The chart library failed to load. Reload the page.');

// Show the data saved in the browser right away, then load the latest Garmin data.
restore();
applyTheme(state.theme);
setUnits(state.units);
state.meta = applySettings(state.garminMeta, null);
initTraining();
initSettings({
  onSaved: settings => { state.firstRun = false; useSettings(settings); },
  // After "Refresh now": reload the data and the fetch status
  onRefreshed: async () => {
    try { await loadGarmin(); notice(''); } catch (err) { if (state.acts.length) notice(err.message); }
    state.fetchStatus = await fetchStatus();
    render();
  },
});
initTabs(name => {
  currentTab = name;
  // The browser tab says where you are: "Training · Running Log"
  const label = document.querySelector(`[data-tab="${name}"]`)?.textContent.trim()
    || { settings: 'Settings', welcome: 'Welcome' }[name];
  document.title = label ? `${label} · Running Log` : 'Running Log';
  render();
});

// "Skip to content": move focus to the page content without changing the #tab in the address
document.querySelector('[data-skip]')?.addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('main').focus();
});

// Empty states offer a button instead of a dead end, e.g. <button data-open-settings="add-trial">
document.addEventListener('click', e => {
  const b = e.target.closest('[data-open-settings]');
  if (b) { e.preventDefault(); openSettings(b.dataset.openSettings); }
  // "Try again" on the error card
  if (e.target.closest('[data-action="retry-load"]')) {
    state.load = { status: 'loading', error: null };
    render();
    loadGarmin().then(() => { notice(''); render(); }).catch(() => render());
  }
});

// Meal ideas and the settings (goals, races) load alongside the Garmin data
Promise.all([fetchContent('meals.json'), loadSettings(), fetchStatus()]).then(async ([meals, loaded, status]) => {
  state.content = { meals, races: loaded.error ? { error: loaded.error } : null };
  state.fetchStatus = status;
  if (!loaded.settings) return render();
  let settings = loaded.settings;
  state.firstRun = loaded.firstRun;
  if (loaded.firstRun) {
    // No settings.json yet: the wizard asks for the essentials (the data still loads behind it)
    state.settings = settings;
    state.meta = applySettings(state.garminMeta, settings);
    startWelcome();
    return render();
  }
  if (!settings.goals.weekly_km && state.goal > 0 && !loaded.firstRun) {
    // A weekly goal saved in this browser by an older version moves into settings.json once
    const saved = await saveSettings({ ...settings, goals: { ...settings.goals, weekly_km: state.goal } });
    if (saved.settings) settings = saved.settings;
  }
  useSettings(settings);
});

loadGarmin().then(render).catch(err => {
  // With a saved copy, keep showing it and say why it may be out of date. Without one, the view
  // shows the empty state (no data yet) or the error card (renderViewState), not a notice.
  if (state.acts.length) notice('Could not load the latest Garmin data. ' + err.message + ' Showing the copy saved in this browser.');
  render();
});
