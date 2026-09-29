// Loading, empty and error states for every view, drawn the same way everywhere.
//   loading  no data in this browser yet and data/activities.json still on its way → skeleton
//   missing  no data has been fetched yet → the tab's own empty card ("Fetch my Garmin data")
//   error    the data could not be loaded → error card with "Try again" and the details
//   ready    normal view (a failed update over saved data only shows the notice at the top)

import { state } from '../state.js';
import { esc } from '../format.js';

// The empty card of each tab (shown by the tab itself when it has nothing to show)
const EMPTY_CARDS = { overview: 'ovNoData', training: 'empty', fitness: 'fitNoData', recovery: 'recNoData', nutrition: 'nutNoData' };

/** Grey placeholder blocks in the shape of a view: key figures and two cards */
export function skeleton(label = 'Loading your data') {
  const kpi = '<div class="kpi sk-kpi"><span class="sk sk-line short"></span><span class="sk sk-block"></span><span class="sk sk-line"></span></div>';
  const card = '<div class="card sk-card"><span class="sk sk-line short"></span><span class="sk sk-line"></span><span class="sk sk-chart"></span></div>';
  return `<div class="skeleton" role="status" aria-live="polite" aria-busy="true">
    <span class="sr-only">${esc(label)}…</span>
    <div class="kpis">${kpi.repeat(4)}</div>
    <div class="grid">${card}${card}</div></div>`;
}

/** The error card: plain words, what to do, and the technical text under "Show details" */
export function errorCard(err) {
  return `<div class="card state-error" role="alert">
    <h2>Couldn't load your data</h2>
    <p class="hint">${esc(err?.message || 'Something went wrong while loading the Garmin data.')}</p>
    <div class="row-actions">
      <button type="button" class="btn" data-action="retry-load">Try again</button>
      <button type="button" class="btn" data-open-settings="refresh">Fetch my Garmin data</button>
    </div>
    ${err?.detail ? `<details class="info"><summary>Show details</summary><p><code>${esc(err.detail)}</code></p></details>` : ''}
  </div>`;
}

/** Put the right state on top of a tab after the tab has drawn itself */
export function renderViewState(tab) {
  const panel = document.getElementById('panel-' + tab);
  const empty = document.getElementById(EMPTY_CARDS[tab]);
  if (!panel || !empty) return;
  let box = panel.querySelector(':scope > .view-state');
  if (!box) {
    box = document.createElement('div');
    box.className = 'view-state';
    panel.prepend(box);
  }
  const noData = !state.acts.length;
  const mode = noData && state.load.status === 'loading' ? 'loading'
    : noData && state.load.status === 'error' ? 'error' : null;
  box.hidden = !mode;
  if (!mode) { box.innerHTML = ''; return; }
  empty.hidden = true;                 // not "no data yet": it is still coming, or it failed
  box.innerHTML = mode === 'loading' ? skeleton() : errorCard(state.load.error);
}
