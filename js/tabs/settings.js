// Settings page (gear icon in the header): goals, training plan, body and heart rate, privacy, data, appearance.
// The form edits a draft; Save sends the whole settings object to the app server, which validates it
// (settings.py) and answers with a message per invalid field.
// The first-run wizard (#welcome, when settings.json doesn't exist yet) uses the same fields and checks.

import { state } from '../state.js';
import { saveSettings, validateSettings, checkTokens } from '../settings.js';
import { fmtDate, fmtTime, fmtDec1, esc, distIn, distFromUnit, distLabel, units } from '../format.js';
import { parseDate } from '../parse.js';

const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));
const idOf = path => 'set-' + path.replace(/\./g, '-');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let draft = null;        // the values in the form, not saved yet
let draftBase = null;    // the saved settings the draft started from
let dirty = false;       // the user has changed something since then
let errors = {};         // { 'goals.main_race.date': 'Use the format …' } from the server
let message = null;      // { kind: 'ok' | 'error', text } after saving
let refresh = { busy: false, text: '' };
let hooks = { onSaved: () => {}, onRefreshed: async () => {} };
let pendingAction = null; // an action to run when the settings page opens (from an empty state's button)
let wizardStep = 0;       // first-run wizard: 0 Garmin, 1 main race, 2 plan and weekly goal, 3 done
let tokenCheck = null;    // { found, folder } from /api/check-tokens
let tokenWarned = false;  // the "no tokens in this folder" warning has been shown for this folder

const onWelcome = () => location.hash === '#welcome';
const activeForm = () => onWelcome() ? $('#welcomeForm') : $('#settingsForm');
/** Redraw whichever form is showing */
const rerender = () => onWelcome() ? renderWelcome() : renderSettings();

/* ---------- Reading and writing values by path ("goals.time_trials.0.name") ---------- */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}

function readValue(el) {
  const v = el.value.trim();
  if (el.dataset.kind === 'number') return v === '' ? (el.dataset.empty === '0' ? 0 : null) : Number(v);
  if (el.dataset.kind === 'words') return v.split(',').map(w => w.trim()).filter(Boolean);
  if (el.dataset.kind === 'distance') {
    if (v === '') return el.dataset.empty === '0' ? 0 : null;
    // Untouched: keep the exact km value (42.195 must not become 42.198 after a km → mi → km round trip)
    if (v === el.dataset.shown && el.dataset.km !== '') return Number(el.dataset.km);
    return distFromUnit(Number(v));
  }
  return v;
}

/** The draft with every value currently in the form */
function collect() {
  const d = clone(draft);
  for (const el of activeForm().querySelectorAll('[name]')) {
    if (el.type === 'radio' && !el.checked) continue;
    setPath(d, el.name, readValue(el));
  }
  return d;
}

/* ---------- Form controls ---------- */
function field(label, control, path, hint = '') {
  const err = errors[path];
  return `<div class="field${err ? ' invalid' : ''}">
    <label for="${idOf(path)}">${label}</label>
    ${control}
    ${hint ? `<p class="field-hint" id="${idOf(path)}-hint">${hint}</p>` : ''}
    ${err ? `<p class="field-error" id="${idOf(path)}-err">${esc(err)}</p>` : ''}
  </div>`;
}

function attrs(path, hint) {
  const described = [hint ? idOf(path) + '-hint' : '', errors[path] ? idOf(path) + '-err' : ''].filter(Boolean).join(' ');
  return `id="${idOf(path)}" name="${path}"${errors[path] ? ' aria-invalid="true"' : ''}${described ? ` aria-describedby="${described}"` : ''}`;
}

const text = (label, path, value, { hint = '', placeholder = '', mono = false, kind = '' } = {}) =>
  field(label, `<input type="text" ${attrs(path, hint)} value="${esc(value ?? '')}" placeholder="${esc(placeholder)}"${mono ? ' class="mono"' : ''}${kind ? ` data-kind="${kind}"` : ''} autocomplete="off">`, path, hint);

const dateInput = (label, path, value, hint = '') =>
  field(label, `<input type="date" class="mono" ${attrs(path, hint)} value="${esc(value ?? '')}">`, path, hint);

const timeInput = (label, path, value, hint = '') =>
  field(label, `<input type="text" class="mono" ${attrs(path, hint)} value="${esc(value ?? '')}" placeholder="h:mm:ss" autocomplete="off" spellcheck="false">`, path, hint);

/** A distance kept in km, shown and typed in the chosen unit (Settings → Appearance → Units) */
function dist(label, path, km, { decimals = 2, hint = '', empty = '' } = {}) {
  const shown = km == null || km === '' || (empty && !km) ? '' : String(+distIn(km).toFixed(decimals));
  const input = `<span class="with-unit"><input type="number" class="mono" ${attrs(path, hint)} data-kind="distance"
    ${empty ? `data-empty="${empty}"` : ''} data-km="${km ?? ''}" data-shown="${shown}" value="${shown}" step="any" min="0" inputmode="decimal"><span class="unit">${distLabel()}</span></span>`;
  return field(label, input, path, hint);
}
const raceHint = () => units() === 'mi' ? 'Marathon 26.22, half 13.11' : 'Marathon 42.195, half 21.0975';

function num(label, path, value, { unit = '', hint = '', step = 'any', min = '', max = '', empty = '', enabledBy = null } = {}) {
  const on = !enabledBy || enabledBy.on;
  const input = `<span class="with-unit"><input type="number" class="mono" ${attrs(path, hint)} data-kind="number"
    ${empty ? `data-empty="${empty}"` : ''} value="${value ?? ''}" step="${step}" min="${min}" max="${max}" inputmode="decimal"
    ${enabledBy ? `data-enabled-by="${enabledBy.path}" data-enabled-value="${enabledBy.value}"` : ''}${on ? '' : ' disabled'}>${unit ? `<span class="unit">${unit}</span>` : ''}</span>`;
  return field(label, input, path, hint);
}

function choice(label, path, value, options, hint = '') {
  const err = errors[path];
  return `<fieldset class="field choice${err ? ' invalid' : ''}">
    <legend>${label}</legend>
    <div class="choice-row">${options.map(([v, l]) => `
      <label class="choice-opt"><input type="radio" name="${path}" value="${v}"${v === value ? ' checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    ${hint ? `<p class="field-hint">${hint}</p>` : ''}
    ${err ? `<p class="field-error">${esc(err)}</p>` : ''}
  </fieldset>`;
}

const button = (textLabel, action, extra = '') => `<button type="button" class="btn" data-action="${action}"${extra}>${textLabel}</button>`;

/* ---------- Sections ---------- */
function goalsCard(g) {
  const main = g.main_race
    ? `<div class="fields">
        ${text('Name', 'goals.main_race.name', g.main_race.name, { placeholder: 'e.g. City Marathon' })}
        ${dateInput('Race day', 'goals.main_race.date', g.main_race.date)}
        ${dist('Distance', 'goals.main_race.distance_km', g.main_race.distance_km, { hint: raceHint() })}
        ${timeInput('Goal time', 'goals.main_race.goal', g.main_race.goal, 'h:mm:ss, e.g. 3:30:00')}
      </div>
      <div class="row-actions">${button('Remove main race', 'remove-main')}</div>`
    : `<div class="cta"><p class="hint">No main race yet. The marathon forecast, countdown and long-run plan need one.</p>
        ${button('Add your main race', 'add-main')}</div>`;

  const trials = g.time_trials.map((t, i) => `
    <div class="row-item">
      <div class="fields">
        ${text('Name', `goals.time_trials.${i}.name`, t.name, { placeholder: 'e.g. 10 km test run' })}
        ${dateInput('Date', `goals.time_trials.${i}.date`, t.date)}
        ${dist('Distance', `goals.time_trials.${i}.distance_km`, t.distance_km)}
        ${timeInput('Result', `goals.time_trials.${i}.result`, t.result, 'Optional. Add it after the run.')}
      </div>
      <div class="row-actions">${button('Remove', 'remove-trial', ` data-index="${i}" aria-label="Remove ${esc(t.name || 'time trial')}"`)}</div>
    </div>`).join('');

  return `<section class="card span-2">
    <div class="card-head"><div><h2>Goals</h2><p class="sub">Your main race, time trials and weekly distance.</p></div></div>
    <h3 class="form-sub">Main race</h3>
    ${main}
    <h3 class="form-sub">Time trials and test races</h3>
    ${trials || '<p class="hint">No time trials yet. Their results calibrate the marathon forecast.</p>'}
    <div class="row-actions">${button('Add a time trial', 'add-trial')}</div>
    <h3 class="form-sub">Weekly distance</h3>
    <div class="fields">${dist('Weekly goal', 'goals.weekly_km', g.weekly_km, { decimals: 0, empty: '0', hint: 'Empty or 0 = no goal' })}</div>
  </section>`;
}

function planCard(p) {
  const zone4 = state.meta?.hrSettings?.zone_floors?.[3];
  return `<section class="card">
    <div class="card-head"><div><h2>Training plan</h2><p class="sub">Where planned workouts come from and what counts as an easy run.</p></div></div>
    ${choice('Plan source', 'plan.source', p.source, [['garmin', 'Garmin calendar'], ['none', 'No plan']],
      'Garmin calendar: workouts scheduled in Garmin Connect, e.g. synced from Runna.')}
    <div class="fields">
      ${text('Easy run words', 'plan.easy_keywords', p.easy_keywords.join(', '), { kind: 'words', hint: 'Comma separated. A run with one of these in its name can count as easy.' })}
      ${num('Easy run heart rate limit', 'plan.easy_max_hr', p.easy_max_hr, { unit: 'bpm', step: 1, min: 80, max: 220,
        hint: `Average HR must stay below this. Empty = below zone 4${zone4 ? ` (${zone4} bpm)` : ''}.` })}
    </div>
  </section>`;
}

function bodyCard(b) {
  const g = state.garminMeta || {};
  const gWeight = g.weight ? `${fmtDec1(g.weight.kg)} kg (${fmtDate(parseDate(g.weight.date))})` : 'no weigh-in';
  const gMax = g.hrSettings?.max_hr ? `${g.hrSettings.max_hr} bpm` : 'not available';
  const lastRhr = (g.restingHr || []).at(-1);
  const gRest = lastRhr ? `${lastRhr.bpm} bpm (${fmtDate(parseDate(lastRhr.date))})` : 'not available';
  const pair = (key, field, label, unit, garminText, step, min, max, hint) => `
    <div class="pair">
      ${choice(label, `body.${key}_source`, b[`${key}_source`], [['garmin', `Garmin: ${garminText}`], ['manual', 'Enter myself']])}
      ${num(`${label} (manual)`, `body.${field}`, b[field], { unit, step, min, max, hint,
        enabledBy: { path: `body.${key}_source`, value: 'manual', on: b[`${key}_source`] === 'manual' } })}
    </div>`;
  return `<section class="card">
    <div class="card-head"><div><h2>Body and heart rate</h2><p class="sub">Garmin's values, or your own.</p></div></div>
    ${pair('weight', 'weight_kg', 'Weight', 'kg', gWeight, 0.1, 30, 250, 'Used for the nutrition targets (g/kg).')}
    ${pair('max_hr', 'max_hr', 'Maximum heart rate', 'bpm', gMax, 1, 120, 230,
      'Sets the heart rate zone limits and the easy-run limit. The watch has already counted the time in each zone, so past training load stays the same.')}
    ${pair('resting_hr', 'resting_hr', 'Resting heart rate', 'bpm', gRest, 1, 25, 120,
      "Shown on the Fitness tab. The Recovery checks keep using Garmin's nightly values, because one number can't show day-to-day change.")}
  </section>`;
}

function privacyCard(p) {
  const zones = p.zones.map((z, i) => `
    <div class="row-item">
      <div class="fields">
        ${text('Name', `privacy.zones.${i}.name`, z.name, { placeholder: 'e.g. Home' })}
        ${num('Latitude', `privacy.zones.${i}.lat`, z.lat, { min: -90, max: 90, hint: 'Decimal degrees, e.g. 51.5007' })}
        ${num('Longitude', `privacy.zones.${i}.lon`, z.lon, { min: -180, max: 180, hint: 'e.g. -0.1246' })}
        ${num('Radius', `privacy.zones.${i}.radius_m`, z.radius_m, { unit: 'm', step: 1, min: 50, max: 5000 })}
      </div>
      <div class="row-actions">${button('Remove', 'remove-zone', ` data-index="${i}" aria-label="Remove ${esc(z.name || 'zone')}"`)}</div>
    </div>`).join('');
  return `<section class="card">
    <div class="card-head"><div><h2>Privacy</h2><p class="sub">Places to hide from route maps.</p></div></div>
    ${zones || '<p class="hint">No privacy zones yet.</p>'}
    <div class="row-actions">${button('Add a privacy zone', 'add-zone')}</div>
    <p class="field-hint">Route maps are not in the app yet; these zones will be hidden from them. To find coordinates, right-click a place on openstreetmap.org and choose "Show address".</p>
  </section>`;
}

function dataCard(d) {
  const at = state.fetchedAt ? new Date(state.fetchedAt) : null;
  const fs = state.fetchStatus;
  const last = at ? `${fmtDate(at)} at ${fmtTime(at)}` : 'none yet';
  const latest = fs?.ok === false ? `The latest fetch failed: ${esc(fs.message || '')}` : '';
  return `<section class="card">
    <div class="card-head"><div><h2>Data</h2><p class="sub">Garmin Connect sign-in and fetching.</p></div></div>
    <div class="fields">
      ${text('Garmin token folder', 'data.garmin_tokens_dir', d.garmin_tokens_dir, { mono: true,
        hint: 'The folder with garmin_tokens.json, created by the garmin-mcp-auth tool. The app never asks for your Garmin password.' })}
      ${num('Fetch range', 'data.fetch_days', d.fetch_days, { unit: 'days', step: 1, min: 7, max: 1095, hint: 'How far back each fetch goes. Used from the next fetch on.' })}
    </div>
    <p class="data-line">Last successful fetch: <span class="num">${last}</span></p>
    ${latest ? `<p class="data-line warn-text">${latest}</p>` : ''}
    <div class="row-actions">
      <button type="button" class="btn" data-action="refresh"${refresh.busy ? ' disabled' : ''}>${refresh.busy ? 'Fetching…' : 'Refresh now'}</button>
      <span class="hint" id="refreshText" role="status">${esc(refresh.text)}</span>
    </div>
    <p class="field-hint">The data is also fetched automatically every morning. Garmin limits requests, so a manual fetch is allowed once every 15 minutes.</p>
  </section>`;
}

function appearanceCard(a) {
  return `<section class="card">
    <div class="card-head"><div><h2>Appearance</h2><p class="sub">How the app looks.</p></div></div>
    ${choice('Theme', 'appearance.theme', a.theme, [['system', 'Same as the system'], ['dark', 'Dark'], ['light', 'Light']])}
    ${choice('Units', 'appearance.units', a.units, [['km', 'Kilometres'], ['mi', 'Miles']],
      'Distances and paces are shown in this unit. Everything is still calculated and saved in kilometres.')}
  </section>`;
}

/* ---------- Page ---------- */
export function renderSettings() {
  const form = $('#settingsForm');
  if (!state.settings) {
    const why = state.content?.races?.error || 'Loading…';
    form.innerHTML = `<div class="card"><h2>Settings are not available</h2><p class="hint">${esc(why)}</p></div>`;
    return;
  }
  // Start from the saved settings unless the user is in the middle of editing
  if (!draft || (state.settings !== draftBase && !dirty)) {
    draft = clone(state.settings);
    draftBase = state.settings;
  }
  const count = Object.keys(errors).length;

  form.innerHTML = `
    ${count ? `<div class="notice error-summary" role="alert" tabindex="-1" id="errorSummary">
      Not saved: check the highlighted ${count === 1 ? 'field' : `fields (${count})`}.</div>` : ''}
    <div class="grid">
      ${goalsCard(draft.goals)}
      ${planCard(draft.plan)}
      ${bodyCard(draft.body)}
      ${privacyCard(draft.privacy)}
      ${dataCard(draft.data)}
      ${appearanceCard(draft.appearance)}
    </div>
    <div class="form-actions">
      <button type="submit" class="btn primary">Save settings</button>
      <button type="button" class="btn" data-action="discard"${dirty ? '' : ' disabled'}>Discard changes</button>
      <span class="form-message ${message?.kind || ''}" role="status">${message ? esc(message.text) : dirty ? 'Unsaved changes' : ''}</span>
    </div>`;

  // Errors for things without their own input (e.g. a whole list) go into the summary
  const extra = Object.entries(errors).filter(([path]) => !document.getElementById(idOf(path)) && !form.querySelector(`[name="${path}"]`));
  if (extra.length && $('#errorSummary')) $('#errorSummary').insertAdjacentHTML('beforeend', `<ul>${extra.map(([, m]) => `<li>${esc(m)}</li>`).join('')}</ul>`);

  // An empty state's button asked for something here, e.g. "Add a time trial"
  if (pendingAction) {
    const action = pendingAction;
    pendingAction = null;
    if (action === 'refresh') { $('#settingsForm [data-action="refresh"]')?.scrollIntoView({ block: 'center' }); startRefresh(); }
    else runAction(action);
  }
}

async function save() {
  draft = collect();
  const r = await saveSettings(draft);
  if (r.settings) {
    errors = {}; dirty = false; message = { kind: 'ok', text: 'Saved.' };
    draft = clone(r.settings);
    hooks.onSaved(r.settings);        // app.js stores them and redraws (this page included)
    draftBase = state.settings;
    renderSettings();
    return;
  }
  errors = r.errors || {};
  message = { kind: 'error', text: r.error || 'Not saved.' };
  renderSettings();
  const first = $('#settingsForm [aria-invalid="true"]');
  (first || $('#errorSummary'))?.focus();
}

async function startRefresh() {
  refresh = { busy: true, text: 'Starting…' };
  rerender();
  let res, body;
  try {
    res = await fetch('api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    body = await res.json();
  } catch (e) {
    refresh = { busy: false, text: 'Could not reach the app server.' };
    return rerender();
  }
  if (res.status !== 202) {
    refresh = { busy: false, text: body.error || `The fetch could not start (HTTP ${res.status}).` };
    return rerender();
  }
  refresh.text = 'Fetching from Garmin. This usually takes under a minute.';
  rerender();
  // Ask the local app server (not Garmin) every 2 s whether the fetch has finished; give up after 10 min
  for (let i = 0; i < 300; i++) {
    await sleep(2000);
    try {
      const s = await (await fetch('api/status', { cache: 'no-store' })).json();
      if (!s.running) break;
    } catch (e) { /* server busy or restarting: try again */ }
  }
  await hooks.onRefreshed();
  const fs = state.fetchStatus;
  refresh = { busy: false, done: !!fs?.ok, text: fs?.ok ? 'Done: the data is up to date.' : `The fetch failed: ${fs?.message || 'see data/refresh.log'}` };
  rerender();
}

/** Buttons inside the forms: add/remove rows, discard, refresh */
function runAction(action, i) {
  if (action === 'refresh') return startRefresh();
  if (action === 'discard') {
    draft = clone(state.settings); dirty = false; errors = {}; message = null;
    return renderSettings();
  }
  draft = collect();
  const g = draft.goals;
  if (action === 'add-main') g.main_race = g.main_race || { name: '', date: '', distance_km: 42.195, goal: '' };
  if (action === 'remove-main') g.main_race = null;
  if (action === 'add-trial') g.time_trials.push({ name: '', date: '', distance_km: null, result: '' });
  if (action === 'remove-trial') g.time_trials.splice(i, 1);
  if (action === 'add-zone') draft.privacy.zones.push({ name: '', lat: null, lon: null, radius_m: 400 });
  if (action === 'remove-zone') draft.privacy.zones.splice(i, 1);
  dirty = true; message = null;
  errors = {};   // indexes may have moved; the next save checks everything again
  renderSettings();
  // Put the cursor in the first field of what was just added
  if (action.startsWith('add-')) {
    const sel = { 'add-main': 'goals.main_race.name', 'add-trial': `goals.time_trials.${g.time_trials.length - 1}.name`,
      'add-zone': `privacy.zones.${draft.privacy.zones.length - 1}.name` }[action];
    const el = document.getElementById(idOf(sel));
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  }
}

/* ---------- First-run wizard (#welcome) ---------- */
const STEPS = ['Garmin', 'Main race', 'Training', 'Done'];
// Which settings each step asks for; only their errors stop the step
const STEP_FIELDS = [['data.'], ['goals.main_race'], ['plan.', 'goals.weekly_km']];
const BLANK_RACE = () => ({ name: '', date: '', distance_km: 42.195, goal: '' });

function stepsBar() {
  return `<ol class="steps">${STEPS.map((name, i) => `<li${i === wizardStep ? ' aria-current="step"' : ''}${i < wizardStep ? ' class="done"' : ''}>
    <span class="num">${i + 1}</span> ${name}</li>`).join('')}</ol>`;
}

function tokenLine() {
  if (!tokenCheck) return '';
  return tokenCheck.found
    ? `<p class="data-line ok-text">Found garmin_tokens.json in <code>${esc(tokenCheck.folder)}</code>.</p>`
    : `<p class="data-line warn-text">No garmin_tokens.json in <code>${esc(tokenCheck.folder)}</code>. Sign in once with the garmin-mcp-auth tool, or fix the folder. You can also continue and fix it later in Settings.</p>`;
}

function welcomeStep() {
  const d = draft;
  if (wizardStep === 0) return `
    <h2 id="welcomeHeading" tabindex="-1">Welcome to Running Log</h2>
    <p class="lead">Three short steps and the app is ready. Everything can be changed later in Settings (the gear icon).</p>
    <div class="fields one">${text('Garmin token folder', 'data.garmin_tokens_dir', d.data.garmin_tokens_dir, { mono: true,
      hint: 'The folder with garmin_tokens.json. Create it by signing in once with the garmin-mcp-auth tool. The app never asks for your Garmin password.' })}</div>
    ${tokenLine()}`;
  if (wizardStep === 1) {
    const r = d.goals.main_race;
    return `
    <h2 id="welcomeHeading" tabindex="-1">Your main race</h2>
    <p class="lead">The race you are training for. The marathon forecast, countdown and long-run plan are built around it.</p>
    <div class="fields">
      ${text('Name', 'goals.main_race.name', r.name, { placeholder: 'e.g. City Marathon' })}
      ${dateInput('Race day', 'goals.main_race.date', r.date)}
      ${dist('Distance', 'goals.main_race.distance_km', r.distance_km, { hint: raceHint() })}
      ${timeInput('Goal time', 'goals.main_race.goal', r.goal, 'h:mm:ss, e.g. 3:30:00')}
    </div>`;
  }
  if (wizardStep === 2) return `
    <h2 id="welcomeHeading" tabindex="-1">Training plan and weekly goal</h2>
    <p class="lead">Where your planned workouts are, and how far you want to run each week.</p>
    ${choice('Plan source', 'plan.source', d.plan.source, [['garmin', 'Garmin calendar'], ['none', 'No plan']],
      'Garmin calendar: workouts scheduled in Garmin Connect, e.g. synced from Runna.')}
    <div class="fields">${dist('Weekly goal', 'goals.weekly_km', d.goals.weekly_km, { decimals: 0, empty: '0', hint: 'Empty or 0 = no goal' })}</div>`;
  const hasData = state.acts.length > 0;
  return `
    <h2 id="welcomeHeading" tabindex="-1">All set</h2>
    <p class="lead">Your settings are saved in settings.json. ${hasData ? 'Your Garmin data is already here.' : 'Next, fetch your Garmin data. After that it can be fetched automatically every morning.'}</p>
    ${hasData || refresh.done ? '' : `<div class="row-actions">
      <button type="button" class="btn" data-action="refresh"${refresh.busy ? ' disabled' : ''}>${refresh.busy ? 'Fetching…' : 'Fetch my Garmin data now'}</button>
      <span class="hint" role="status">${esc(refresh.text)}</span></div>`}
    ${refresh.done ? `<p class="data-line ok-text" role="status">${esc(refresh.text)}</p>` : ''}`;
}

export function renderWelcome() {
  const form = $('#welcomeForm');
  if (!state.settings) { form.innerHTML = '<div class="card"><p class="hint">Loading…</p></div>'; return; }
  if (!draft) { draft = clone(state.settings); draftBase = state.settings; }
  if (wizardStep === 1 && !draft.goals.main_race) draft.goals.main_race = BLANK_RACE();
  const count = Object.keys(errors).length;
  const back = wizardStep > 0 && wizardStep < 3 ? '<button type="button" class="btn" data-wizard="back">Back</button>' : '';
  const skip = wizardStep === 1 ? '<button type="button" class="btn" data-wizard="skip">I have no race yet</button>' : '';
  const next = wizardStep < 2 ? `<button type="submit" class="btn primary">${wizardStep === 0 && tokenWarned ? 'Continue anyway' : 'Next'}</button>`
    : wizardStep === 2 ? '<button type="submit" class="btn primary">Save and finish</button>'
    : '<a class="btn primary" href="#overview">Go to the overview</a>';
  form.innerHTML = `
    ${stepsBar()}
    <section class="card wizard">
      ${count ? `<div class="notice error-summary" role="alert" id="errorSummary" tabindex="-1">Check the highlighted ${count === 1 ? 'field' : `fields (${count})`}.</div>` : ''}
      ${message?.kind === 'error' ? `<p class="data-line warn-text" role="alert">${esc(message.text)}</p>` : ''}
      ${welcomeStep()}
      <div class="row-actions wizard-actions">${back}${skip}${next}</div>
    </section>`;
}

async function wizardNext() {
  draft = collect();
  message = null;
  if (wizardStep === 0) tokenCheck = await checkTokens(draft.data.garmin_tokens_dir);
  const all = (await validateSettings(draft)).errors || {};
  errors = Object.fromEntries(Object.entries(all).filter(([path]) => STEP_FIELDS[wizardStep].some(p => path.startsWith(p))));
  if (!Object.keys(errors).length && wizardStep === 2) {
    const r = await saveSettings(draft);
    if (r.settings) {
      draft = clone(r.settings); dirty = false;
      hooks.onSaved(r.settings);
      draftBase = state.settings;
    } else {
      errors = r.errors || {};
      message = { kind: 'error', text: r.error || 'Not saved: check the earlier steps.' };
    }
  }
  // Missing tokens don't stop the wizard, but the warning is shown once before moving on
  const warnFirst = wizardStep === 0 && tokenCheck && !tokenCheck.found && !tokenWarned;
  if (warnFirst) tokenWarned = true;
  if (!Object.keys(errors).length && !message && !warnFirst) wizardStep++;
  renderWelcome();
  ($('#welcomeForm [aria-invalid="true"]') || $('#welcomeHeading'))?.focus();
}

function wizardMove(kind) {
  draft = collect();
  errors = {}; message = null;
  if (kind === 'skip') { draft.goals.main_race = null; wizardStep = 2; }
  if (kind === 'back') {
    wizardStep = Math.max(0, wizardStep - 1);
    // Back from the plan step to a skipped race: show the empty race form again
    if (wizardStep === 1 && !draft.goals.main_race) draft.goals.main_race = BLANK_RACE();
  }
  renderWelcome();
  $('#welcomeHeading')?.focus();
}

/* ---------- Events ---------- */
export function initSettings({ onSaved, onRefreshed }) {
  hooks = { onSaved, onRefreshed };

  for (const form of [$('#settingsForm'), $('#welcomeForm')]) {
    form.addEventListener('submit', e => { e.preventDefault(); if (form.id === 'welcomeForm') wizardNext(); else save(); });

    form.addEventListener('input', e => {
      if (!e.target.name) return;
      dirty = true;
      message = null;
      draft = collect();
      if (e.target.name === 'data.garmin_tokens_dir') { tokenCheck = null; tokenWarned = false; }
      // An edited field is no longer marked invalid
      if (errors[e.target.name]) {
        delete errors[e.target.name];
        e.target.removeAttribute('aria-invalid');
        e.target.closest('.field')?.classList.remove('invalid');
        e.target.closest('.field')?.querySelector('.field-error')?.remove();
      }
      const status = form.querySelector('.form-message');
      if (status) { status.className = 'form-message'; status.textContent = 'Unsaved changes'; }
      const discard = form.querySelector('[data-action="discard"]');
      if (discard) discard.disabled = false;
    });

    // Garmin / manual: the manual number is editable only when "Enter myself" is chosen
    form.addEventListener('change', e => {
      if (e.target.type !== 'radio') return;
      for (const el of form.querySelectorAll(`[data-enabled-by="${e.target.name}"]`)) el.disabled = e.target.value !== el.dataset.enabledValue;
    });

    form.addEventListener('click', e => {
      const w = e.target.closest('[data-wizard]');
      if (w) return wizardMove(w.dataset.wizard);
      const b = e.target.closest('[data-action]');
      if (b) runAction(b.dataset.action, +b.dataset.index);
    });
  }
}

/** Show the settings page, doing `action` there first (e.g. "add-trial" from an empty state's button) */
export function openSettings(action) {
  pendingAction = action || null;
  if (location.hash === '#settings') { renderSettings(); return; }
  location.hash = '#settings';      // nav.js shows the page, then app.js calls renderSettings()
}

/** Start the first-run wizard from the beginning */
export function startWelcome() {
  wizardStep = 0; errors = {}; message = null; tokenCheck = null; tokenWarned = false;
  draft = state.settings ? clone(state.settings) : null;
  draftBase = state.settings;
  location.hash = '#welcome';
}
