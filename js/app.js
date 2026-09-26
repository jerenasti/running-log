// Entry point: loads data, wires up the data source controls and the tabs.

import { state, save, restore, clearData } from './state.js';
import { fetchGarmin, garminToActivities, parseCsvFile, sampleActivities } from './data.js';
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

function setData({ acts, cols, meta = null }, source, live) {
  Object.assign(state, { acts, cols, meta, source, live, showAll: false });
  notice('');
  save();
  render();
}

const applyGarmin = () => garmin && setData(garminToActivities(garmin), 'Garmin Connect data', true);

async function loadFile(file) {
  if (!file) return;
  try { setData(await parseCsvFile(file), file.name, false); }
  catch (e) { notice(e.message); }
}

/* ---------- Events ---------- */
$('#file').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
$('#demo').addEventListener('click', () => setData(sampleActivities(), 'sample data', false));
$('#garmin').addEventListener('click', applyGarmin);
$('#clear').addEventListener('click', () => { clearData(); render(); });

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('drag'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });

// Redraw charts when the system switches between light and dark mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

/* ---------- Startup ---------- */
if (typeof Chart === 'undefined' || typeof Papa === 'undefined') {
  notice('The app libraries failed to load. Reload the page.');
}

// Show data saved in the browser right away, then fetch Garmin data in the background.
const storedAt = restore();
initTraining();
initTabs(name => { currentTab = name; render(); });

fetchGarmin().then(o => {
  garmin = o;
  // Garmin data replaces saved data, unless the user uploaded a CSV after this fetch.
  if (!state.acts.length || state.live || storedAt < Date.parse(o.fetchedAt)) applyGarmin();
  else render();
}).catch(err => {
  // No Garmin data: CSV upload and sample data still work as fallbacks.
  if (!state.acts.length) notice(err.message);
});
