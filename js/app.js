// Entry point: loads the Garmin data and wires up the tabs.

import { state, save, restore } from './state.js';
import { fetchGarmin, garminToActivities, fetchContent, fetchStatus } from './data.js';
import { loadSettings, saveSettings, racesFromSettings } from './settings.js';
import { parseDate } from './parse.js';
import { fmtDate, fmtTime, esc } from './format.js';
import { initTabs } from './nav.js';
import { initTraining, renderTraining } from './tabs/training.js';
import { renderFitness } from './tabs/fitness.js';
import { renderRecovery } from './tabs/recovery.js';
import { renderNutrition } from './tabs/nutrition.js';
import { renderOverview } from './tabs/overview.js';

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
  const last = fetchedAt ? `Last successful fetch ${fmtDate(fetchedAt)} at ${fmtTime(fetchedAt)}` : 'No successful fetch yet';
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
}

// Redraw charts when the system switches between light and dark mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

/* ---------- Startup ---------- */
if (typeof Chart === 'undefined') notice('The chart library failed to load. Reload the page.');

// Show the data saved in the browser right away, then load the latest Garmin data.
restore();
initTraining();
initTabs(name => { currentTab = name; render(); });

// Meal ideas and the settings (goals, races) load alongside the Garmin data
Promise.all([fetchContent('meals.json'), loadSettings(), fetchStatus()]).then(async ([meals, loaded, status]) => {
  state.settings = loaded.settings || null;
  const races = loaded.error ? { error: loaded.error } : { data: { races: racesFromSettings(loaded.settings) } };
  state.content = { meals, races };
  state.fetchStatus = status;
  if (state.settings) {
    const weekly = state.settings.goals.weekly_km;
    if (!weekly && state.goal > 0 && !loaded.firstRun) {
      // A weekly goal saved in this browser by an older version moves into settings.json once
      const saved = await saveSettings({ ...state.settings, goals: { ...state.settings.goals, weekly_km: state.goal } });
      if (saved.settings) { state.settings = saved.settings; save(); }
    } else {
      state.goal = weekly || 0;
    }
  }
  render();
});

fetchGarmin().then(o => {
  fetchedAt = parseDate(o.fetchedAt);
  state.fetchedAt = fetchedAt?.getTime() ?? null;
  Object.assign(state, garminToActivities(o));
  save();
  render();
}).catch(err => {
  // Keep showing the saved copy if there is one, and say why it may be out of date.
  notice(state.acts.length ? 'Could not load the latest Garmin data. ' + err.message + ' Showing the copy saved in this browser.' : err.message);
  render();
});
