// Entry point: loads the Garmin data and wires up the tabs.

import { state, save, restore } from './state.js';
import { fetchGarmin, garminToActivities, fetchContent } from './data.js';
import { parseDate } from './parse.js';
import { fmtDate, fmtTime } from './format.js';
import { initTabs } from './nav.js';
import { initTraining, renderTraining } from './tabs/training.js';
import { renderFitness } from './tabs/fitness.js';
import { renderRecovery } from './tabs/recovery.js';
import { renderNutrition } from './tabs/nutrition.js';

const $ = s => document.querySelector(s);
let fetchedAt = null;       // when data/activities.json was written, or null
let currentTab = null;

function notice(msg) { $('#notice').textContent = msg || ''; $('#notice').hidden = !msg; }

/** Render the header status and the open tab */
function render() {
  $('#updated').hidden = !fetchedAt;
  if (fetchedAt) $('#updated').textContent = 'Garmin data updated ' + fmtDate(fetchedAt) + ' at ' + fmtTime(fetchedAt);
  // Charts are drawn only for the visible tab (a hidden canvas has no size)
  if (currentTab === 'training') renderTraining();
  if (currentTab === 'fitness') renderFitness();
  if (currentTab === 'recovery') renderRecovery();
  if (currentTab === 'nutrition') renderNutrition();
}

// Redraw charts when the system switches between light and dark mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

/* ---------- Startup ---------- */
if (typeof Chart === 'undefined') notice('The chart library failed to load. Reload the page.');

// Show the data saved in the browser right away, then load the latest Garmin data.
restore();
initTraining();
initTabs(name => { currentTab = name; render(); });

// Editable content files (meal ideas, races) load alongside the Garmin data
Promise.all([fetchContent('meals.json'), fetchContent('races.json')]).then(([meals, races]) => {
  state.content = { meals, races };
  render();
});

fetchGarmin().then(o => {
  fetchedAt = parseDate(o.fetchedAt);
  Object.assign(state, garminToActivities(o));
  save();
  render();
}).catch(err => {
  // Keep showing the saved copy if there is one, and say why it may be out of date.
  notice(state.acts.length ? 'Could not load the latest Garmin data. ' + err.message + ' Showing the copy saved in this browser.' : err.message);
  render();
});
