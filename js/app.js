// Entry point: loads data, wires up the data source controls and the tabs.

import { state, save, restore, clearData } from './state.js';
import { fetchGarmin, garminToActivities, sampleActivities, SAMPLE_SOURCE } from './data.js';
import { parseDate } from './parse.js';
import { fmtDate, fmtTime } from './format.js';
import { initTabs } from './nav.js';
import { initTraining, renderTraining } from './tabs/training.js';
import { renderFitness } from './tabs/fitness.js';

const $ = s => document.querySelector(s);
let garmin = null;          // loaded data/activities.json, or null
let currentTab = null;

function notice(msg) { $('#notice').textContent = msg || ''; $('#notice').hidden = !msg; }

/** Render the header status, data source buttons and the open tab */
function render() {
  const d = garmin && parseDate(garmin.fetchedAt);
  $('#updated').hidden = !d;
  if (d) $('#updated').textContent = 'Garmin data updated ' + fmtDate(d) + ' at ' + fmtTime(d);
  $('#garmin').hidden = !garmin || state.live;
  $('#liveHint').hidden = !garmin;
  // Charts are drawn only for the visible tab (a hidden canvas has no size)
  if (currentTab === 'training') renderTraining();
  if (currentTab === 'fitness') renderFitness();
}

function setData({ acts, meta = null }, source, live) {
  Object.assign(state, { acts, meta, source, live, showAll: false });
  notice('');
  save();
  render();
}

const applyGarmin = () => garmin && setData(garminToActivities(garmin), 'Garmin Connect data', true);

/* ---------- Events ---------- */
$('#demo').addEventListener('click', () => setData(sampleActivities(), SAMPLE_SOURCE, false));
$('#garmin').addEventListener('click', applyGarmin);
$('#clear').addEventListener('click', () => { clearData(); render(); });

// Redraw charts when the system switches between light and dark mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

/* ---------- Startup ---------- */
if (typeof Chart === 'undefined') notice('The chart library failed to load. Reload the page.');

// Show data saved in the browser right away, then fetch Garmin data in the background.
const storedAt = restore();
initTraining();
initTabs(name => { currentTab = name; render(); });

fetchGarmin().then(o => {
  garmin = o;
  // Garmin data replaces saved data, unless the user chose sample data after this fetch.
  const keepSample = !state.live && state.source === SAMPLE_SOURCE && storedAt >= Date.parse(o.fetchedAt);
  if (keepSample) render(); else applyGarmin();
}).catch(err => {
  // No Garmin data: explain how to fetch it (sample data still works for trying the app).
  if (!state.acts.length) notice(err.message);
  render();
});
