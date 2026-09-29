// Routes tab: plan a run on the map. Click to add points; the route follows roads and paths
// (openrouteservice through the app server, POST /api/route). Points can be dragged and removed, with
// undo/redo, "Back to start" and "Out and back". Below the map: stats, an elevation profile synced with
// the map, and the hills. Logic lives in ../planner.js.

import { state } from '../state.js';
import {
  addPoint, movePoint, removePoint, backToStart, outAndBack, history, segmentKey, joinSegments,
  climbDescent, grades, gradeBucket, kmMarkers, findHills, timeEstimate, toGpx, inZone, HILLS, GRADE_STEPS,
} from '../planner.js';
import { coloredRuns, indexAtLatLng } from '../route.js';
import { isEasyRun } from '../metrics.js';
import { easyRule } from '../settings.js';
import { fmtKm, fmtDec1, fmtInt, fmtPace, fmtDuration, fmtDate, esc, distLabel, paceLabel, distIn, KM_PER_MILE, units } from '../format.js';
import { theme, baseOptions, drawChart, mainLine } from '../charts.js';
import { loadLeaflet, baseMap, routeColors } from '../map.js';
import { addDays } from '../dates.js';
import { confirmDialog } from './dialog.js';

const $ = s => document.querySelector(s);
const hist = history();
const segments = new Map();          // segmentKey → { points, distance, ascent, descent }
let map = null, L = null;
let layers = null, wpLayer = null, hoverMarker = null;
let line = [], hills = [];
let colorBy = 'plain';
let paceSec = null;                  // s/km on the flat, for the time estimate
let busy = false, chart = null;
let plan = { id: null, name: '' };  // the saved plan being edited (id null = not saved yet)
let dirty = false;                   // edited since the last save or open
let shareView = false;               // privacy zones hidden from the map (for screenshots)
const zones = () => state.settings?.privacy?.zones || [];
const hideZonesWhenSharing = () => state.settings?.privacy?.hide_in_plans !== false;

/* ---------- Pace ---------- */
/** Default: the average pace of easy runs in the last 8 weeks (total time ÷ total distance), else 6:00/km */
function defaultPace() {
  const since = addDays(new Date(), -56), rule = easyRule(state.settings, state.meta);
  const easy = state.acts.filter(a => a.date >= since && isEasyRun(a, rule));
  const km = easy.reduce((s, a) => s + a.km, 0), sec = easy.reduce((s, a) => s + a.sec, 0);
  return km > 0 ? { pace: sec / km, from: easy.length } : { pace: 360, from: 0 };
}
const unitFactor = () => (units() === 'mi' ? KM_PER_MILE : 1);
/** "5:45" in the chosen unit → s/km */
function parsePace(text) {
  const m = String(text).trim().match(/^(\d{1,2}):([0-5]\d)$/);
  return m ? (+m[1] * 60 + +m[2]) / unitFactor() : null;
}

/* ---------- Page ---------- */
export function renderRoutes() {
  const el = $('#routesView');
  if (!state.settings) return;                       // settings still loading
  if (!el.dataset.ready) build(el);
  const hasKey = !!state.settings.routing?.ors_api_key;
  $('#routesNoKey').hidden = hasKey;
  $('#routesPlanner').hidden = !hasKey;
  if (hasKey) startMap();
}

function build(el) {
  el.dataset.ready = '1';
  const d = defaultPace();
  paceSec = d.pace;
  el.innerHTML = `
    <div class="card" id="routesNoKey" hidden>
      <h2>Add an openrouteservice key to plan routes</h2>
      <p class="hint">Route planning follows roads and paths with openrouteservice. The key is free (2 000 routes a day) and stays on this computer.</p>
      <div class="row-actions"><a class="btn" href="#settings">Open Settings → Routing</a></div>
    </div>
    <div id="routesPlanner" hidden>
      <section class="card">
        <div class="planner-bar" role="toolbar" aria-label="Route tools">
          <button type="button" class="btn small" data-plan="undo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" class="btn small" data-plan="redo" title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" class="btn small" data-plan="back">Back to start</button>
          <button type="button" class="btn small" data-plan="outback">Out and back</button>
          <button type="button" class="btn small" data-plan="clear">Clear</button>
          <button type="button" class="btn small" data-plan="share" aria-pressed="false" title="Hide your privacy zones from the map, e.g. for a screenshot">Share view</button>
          <span class="bar-gap"></span>
          <div class="seg" id="planColor" role="group" aria-label="Color the route">
            <button type="button" data-v="plain" aria-pressed="true">Plain</button>
            <button type="button" data-v="grade" aria-pressed="false">Grade</button>
          </div>
          <label class="goal-input">Pace <input type="text" id="planPace" inputmode="numeric" value="${fmtPace(paceSec)}" aria-describedby="planPaceHint"> <span id="planPaceUnit">${paceLabel()}</span></label>
        </div>
        <p class="hint" id="planPaceHint">${d.from ? `Your average easy pace over the last 8 weeks (${d.from} runs).` : 'No easy runs in the last 8 weeks: 6:00 /km to start with.'} Click the map to add points; drag a point to move it, click it to remove it.</p>
        <p class="hint plan-message" id="planMessage" role="status"></p>
        <div class="map planner-map" id="planMap" role="region" aria-label="Route planning map"></div>
        <div class="map-legend" id="planLegend"></div>
      </section>
      <section class="card" id="planSaved">
        <div class="card-head"><div><h2>Saved routes</h2><p class="sub" id="planSavedSub">Name the route to save it. Saved routes stay on this computer.</p></div></div>
        <div class="planner-save">
          <label class="field grow"><span class="field-label">Name</span>
            <input type="text" id="planName" maxlength="80" placeholder="e.g. Seaside loop" autocomplete="off"></label>
          <button type="button" class="btn primary" data-save="save">Save</button>
          <button type="button" class="btn" data-save="copy" hidden>Save as new</button>
          <button type="button" class="btn" data-save="new">New route</button>
          <button type="button" class="btn" data-save="gpx">Export GPX</button>
        </div>
        <p class="hint plan-message" id="planSaveMessage" role="status"></p>
        <div id="savedPlans"></div>
      </section>
      <div class="kpis" id="planStats"></div>
      <div class="grid">
        <section class="card span-2" id="planProfileCard">
          <div class="card-head"><div><h2>Elevation</h2><p class="sub" id="planProfileSub">Add at least two points to see the profile.</p></div></div>
          <div class="chart short"><canvas id="planProfile" aria-label="Elevation profile of the planned route" role="img"></canvas></div>
        </section>
        <section class="card span-2" id="planHillsCard">
          <div class="card-head"><div><h2>Hills</h2><p class="sub">At least ${HILLS.minGain} m up at an average grade of ${HILLS.minGrade * 100} % or more.</p></div></div>
          <div id="planHills"><p class="hint">No hills yet.</p></div>
          <details class="info"><summary>How it's calculated</summary>
            <p><b>Elevation</b>: in Finland, with an MML key in Settings, from the National Land Survey's 2 m laser-scanned elevation model (about 0.3 m accurate); otherwise from openrouteservice's satellite model (30–90 m grid, so small hills look flatter than they are). The line under the profile says which one this route uses. Heights are averaged over 50 m before anything is calculated.</p>
            <p><b>Hills</b>: stretches where the grade is at least ${HILLS.minGrade * 100} %, allowing flat bits of up to ${HILLS.maxGap} m, that climb at least ${HILLS.minGain} m.</p>
            <p><b>Time</b>: every 50 m at your pace × a hill factor from Minetti et al. (2002): the energy cost of running at grade i is C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6 J/kg/m, and the factor is C(i) ÷ C(0). So +5 % takes about 1.30× as long and +10 % about 1.66×; downhill gives at most 15 % back.</p>
          </details>
        </section>
      </div>
    </div>`;

  el.querySelector('.planner-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-plan]');
    if (!b || busy) return;
    const pts = hist.current;
    ({ undo: () => update(hist.undo()), redo: () => update(hist.redo()), back: () => edit(backToStart(pts)),
       outback: () => edit(outAndBack(pts)), clear: () => edit([]), share: toggleShare })[b.dataset.plan]();
  });
  $('#planColor').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    colorBy = b.dataset.v;
    $('#planColor').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  });
  $('#planPace').addEventListener('change', e => {
    const p = parsePace(e.target.value);
    if (p) { paceSec = p; e.target.removeAttribute('aria-invalid'); renderStats(); }
    else { e.target.setAttribute('aria-invalid', 'true'); message('Write the pace as m:ss, e.g. 6:15.'); }
  });
  $('#planSaved').addEventListener('click', e => {
    const b = e.target.closest('[data-save], [data-open], [data-delete]');
    if (!b || busy) return;
    if (b.dataset.save === 'save') savePlan(false);
    if (b.dataset.save === 'copy') savePlan(true);
    if (b.dataset.save === 'new') newPlan();
    if (b.dataset.save === 'gpx') exportGpx();
    if (b.dataset.open) openPlan(b.dataset.open);
    if (b.dataset.delete) deletePlan(b.dataset.delete, b.dataset.name);
  });
  $('#planName').addEventListener('input', () => { dirty = true; saveState(); });
  listPlans();
  document.addEventListener('keydown', e => {
    if (location.hash !== '#routes' || !(e.ctrlKey || e.metaKey) || e.target.matches('input, textarea')) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); update(hist.undo()); }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); update(hist.redo()); }
  });
}

async function startMap() {
  if (map) { map.invalidateSize(); return; }
  try { L = await loadLeaflet(); } catch (e) { message(e.message); return; }
  if (map) return;
  map = baseMap(L, $('#planMap'));
  map.setView(startView(), 13);
  map.on('click', e => { if (!busy) edit(addPoint(hist.current, [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)])); });
  update(hist.current);
}

/** Where the map opens: your first privacy zone (usually home) if you have one, else central Helsinki */
function startView() {
  const z = state.settings?.privacy?.zones?.[0];
  return z ? [z.lat, z.lon] : [60.1699, 24.9384];
}

/* ---------- Editing ---------- */
function message(text) { const m = $('#planMessage'); if (m) m.textContent = text || ''; }

/** A new set of points: route the new segments; if one fails, the edit is not kept */
async function edit(next) {
  const ok = await routeSegments(next);
  if (ok) { dirty = true; update(hist.push(next)); }
}

async function routeSegments(pts) {
  const missing = [];
  for (let i = 1; i < pts.length; i++) if (!segments.has(segmentKey(pts[i - 1], pts[i]))) missing.push([pts[i - 1], pts[i]]);
  if (!missing.length) return true;
  busy = true;
  message(`Planning ${missing.length === 1 ? 'the route' : `${missing.length} parts of the route`}…`);
  try {
    for (const [a, b] of missing) {
      const res = await fetch('api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a, b }) });
      const body = await res.json();
      if (!res.ok) { message(body.error || `Routing failed (HTTP ${res.status}).`); return false; }
      segments.set(segmentKey(a, b), body);
    }
    message('');
    return true;
  } catch (e) {
    message('Could not reach the app server. Is it still running?');
    return false;
  } finally {
    busy = false;
  }
}

/** Show a set of points (after an edit, undo or redo; undo and redo only use cached segments) */
async function update(pts) {
  await routeSegments(pts);
  const segs = [];
  for (let i = 1; i < pts.length; i++) { const s = segments.get(segmentKey(pts[i - 1], pts[i])); if (s) segs.push(s); }
  line = joinSegments(segs);
  hills = findHills(line);
  draw();
  drawWaypoints(pts);
  renderStats();
  drawProfile();
  renderHills();
  const b = $('#routesPlanner');
  b.querySelector('[data-plan="undo"]').disabled = !hist.canUndo;
  b.querySelector('[data-plan="redo"]').disabled = !hist.canRedo;
  b.querySelector('[data-plan="back"]').disabled = pts.length < 2;
  b.querySelector('[data-plan="outback"]').disabled = pts.length < 2;
  b.querySelector('[data-plan="clear"]').disabled = !pts.length;
  saveState();
}

/* ---------- Map ---------- */
function toggleShare() {
  shareView = !shareView;
  $('[data-plan="share"]').setAttribute('aria-pressed', String(shareView));
  message(shareView ? (zones().length ? 'Share view: your privacy zones and the points are hidden. Take the screenshot now.' : 'Share view: no privacy zones set in Settings, so the whole route shows.') : '');
  draw();
  drawWaypoints(hist.current);
}

function draw() {
  if (!map) return;
  if (layers) layers.remove();
  layers = L.featureGroup();
  const c = routeColors();
  // Share view: points inside privacy zones have no position, so the line breaks there
  const hidden = shareView ? line.map(p => inZone(p.lat, p.lon, zones())) : line.map(() => false);
  const shown = line.map((p, i) => (hidden[i] ? { ...p, lat: null, lon: null } : p));
  if (line.length > 1) {
    const visible = coloredRuns(shown.map((p, i) => ({ ...p, t: i })), shown.map(() => 0)).map(r => r.latlngs);
    for (const part of visible) L.polyline(part, { color: c.casing, weight: 8, opacity: 0.9, interactive: false }).addTo(layers);
    if (colorBy === 'grade') {
      const buckets = grades(line).map(g => gradeBucket(g) ?? 2);
      for (const run of coloredRuns(shown.map((p, i) => ({ ...p, t: i })), buckets)) {
        L.polyline(run.latlngs, { color: c.steps[run.bucket], weight: 5 }).addTo(layers);
      }
    } else {
      for (const part of visible) L.polyline(part, { color: c.marker, weight: 4 }).addTo(layers);
      for (const h of hills) {
        const hillShown = coloredRuns(shown.slice(h.from, h.to + 1).map((p, i) => ({ ...p, t: i })), shown.slice(h.from, h.to + 1).map(() => 0));
        for (const run of hillShown) {
          L.polyline(run.latlngs, { color: c.heat, weight: 6 })
            .bindTooltip(`Hill: ${fmtInt(h.gain)} m up at ${fmtDec1(h.grade * 100)} %`, { sticky: true }).addTo(layers);
        }
      }
    }
    for (const m of kmMarkers(line, units() === 'mi' ? KM_PER_MILE * 1000 : 1000)) {
      if (shareView && inZone(m.lat, m.lon, zones())) continue;
      L.marker([m.lat, m.lon], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'km-marker', html: `<span>${Math.round(distIn(m.km))}</span>`, iconSize: [20, 20] }) }).addTo(layers);
    }
    layers.on('mousemove', e => hover(indexAtLatLng(shown, e.latlng.lat, e.latlng.lng)));
    layers.on('mouseout', () => hover(null));
  }
  layers.addTo(map);
  hoverMarker = L.circleMarker([0, 0], { radius: 6, color: c.surface, weight: 3, fillColor: c.marker, fillOpacity: 1, interactive: false });
  const g = GRADE_STEPS.map(x => `${x > 0 ? '+' : ''}${x * 100}`);
  $('#planLegend').innerHTML = colorBy === 'grade'
    ? `<span class="num">Down</span><span class="legend-steps" aria-hidden="true">${c.steps.map(s => `<i style="background:${s}"></i>`).join('')}</span><span class="num">Up</span>
       <span class="hint">Grade: below ${g[0]} %, ${g[0]}…${g[1]}, flat, ${g[2]}…${g[3]}, over ${g[3]} %</span>`
    : hills.length ? '<span class="legend-steps" aria-hidden="true"><i style="background:var(--route-heat)"></i></span><span class="hint">Hills</span>' : '';
}

function drawWaypoints(pts) {
  if (!map) return;
  if (wpLayer) wpLayer.remove();
  wpLayer = L.layerGroup();
  if (shareView) { wpLayer.addTo(map); return; }    // no draggable points (or a start marker at home) in a screenshot
  pts.forEach((p, i) => {
    const first = i === 0, last = i === pts.length - 1 && i > 0;
    const m = L.marker(p, { draggable: true, keyboard: true, title: first ? 'Start' : last ? 'End' : `Point ${i + 1}`,
      icon: L.divIcon({ className: `wp-marker${first ? ' start' : ''}`, html: first ? '<span>S</span>' : '', iconSize: first ? [22, 22] : [14, 14] }) });
    m.on('dragend', () => { const ll = m.getLatLng(); if (!busy) edit(movePoint(hist.current, i, [+ll.lat.toFixed(6), +ll.lng.toFixed(6)])); });
    m.on('click', () => {
      const box = document.createElement('div');
      box.innerHTML = `<button type="button" class="btn small">Remove this point</button>`;
      box.querySelector('button').addEventListener('click', () => { map.closePopup(); edit(removePoint(hist.current, i)); });
      m.bindPopup(box).openPopup();
    });
    m.addTo(wpLayer);
  });
  wpLayer.addTo(map);
}

/* ---------- Stats, profile, hills ---------- */
function renderStats() {
  const kpi = (label, value, unit = '', sub = '') => `<div class="kpi"><div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  const dist = line.length ? line.at(-1).dist : 0;
  const cd = climbDescent(line);
  const sec = timeEstimate(line, paceSec);
  $('#planStats').innerHTML =
    kpi('Distance', fmtKm(dist / 1000), distLabel()) +
    kpi('Climb', fmtInt(cd.climb), 'm', `Descent ${fmtInt(cd.descent)} m`) +
    kpi('Estimated time', sec ? fmtDuration(sec) : '–', '', `At ${fmtPace(paceSec)} ${paceLabel()} on the flat`) +
    kpi('Hills', fmtInt(hills.length), '', hills.length ? `Steepest ${fmtDec1(Math.max(...hills.map(h => h.grade)) * 100)} %` : '');
}

// Hills as shaded bands behind the profile
const hillBands = {
  id: 'hillBands',
  beforeDatasetsDraw(ch) {
    const { top, bottom } = ch.chartArea, x = ch.scales.x, c = ch.ctx;
    c.save(); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft');
    for (const h of hills) {
      const x0 = x.getPixelForValue(distIn(line[h.from].dist / 1000)), x1 = x.getPixelForValue(distIn(line[h.to].dist / 1000));
      c.fillRect(x0, top, x1 - x0, bottom - top);
    }
    c.restore();
  },
};

/** Where the heights came from: MML's 2 m model (Finland, with a key) or openrouteservice's satellite model */
function elevationSource() {
  const segs = hist.current.slice(1).map((p, i) => segments.get(segmentKey(hist.current[i], p))).filter(Boolean);
  const kinds = new Set(segs.map(s => s.elevation || 'ors'));
  const note = segs.find(s => s.elevation_note)?.elevation_note;
  const text = kinds.size === 1 && kinds.has('mml') ? 'Heights: MML 2 m elevation model.'
    : kinds.has('mml') || kinds.has('mixed') ? 'Heights: MML 2 m where available, elsewhere openrouteservice.'
    : 'Heights: openrouteservice (30–90 m satellite model).';
  return note ? `${text} ${note}` : text;
}

function drawProfile() {
  const has = line.length > 1 && line.some(p => p.ele != null);
  $('#planProfileSub').textContent = has
    ? `Point at the profile to see the place on the map. Shaded: hills. ${elevationSource()}`
    : 'Add at least two points to see the profile.';
  if (!has) { if (chart) { chart.destroy(); chart = null; } return; }
  const t = theme();
  const x = line.map(p => distIn(p.dist / 1000));
  const base = baseOptions(t, items => `${fmtDec1(x[items[0].dataIndex])} ${distLabel()}`);
  chart = drawChart('planProfile', {
    type: 'line',
    data: { datasets: [{ label: 'Elevation', data: line.map((p, i) => ({ x: x[i], y: p.ele })),
      ...mainLine(t, { borderWidth: 1.5, tension: 0, fill: 'start', backgroundColor: t.band }) }] },
    options: { ...base,
      onHover: (e, els) => hover(els.length ? els[0].index : null, true),
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { title: base.plugins.tooltip.callbacks.title, label: c => `${fmtInt(c.parsed.y)} m` } } },
      scales: {
        x: { ...base.scales.x, type: 'linear', min: 0, max: x.at(-1), ticks: { ...base.scales.x.ticks, callback: v => (Number.isInteger(v) ? `${v} ${distLabel()}` : '') } },
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, maxTicksLimit: 5, callback: v => `${fmtInt(v)} m` } },
      } },
    plugins: [hillBands],
  });
  $('#planProfile').parentElement.onmouseleave = () => hover(null);
}

/** One hovered point for the map and the profile */
function hover(i, fromChart = false) {
  const p = i == null || i < 0 ? null : line[i];
  const onMap = p && !(shareView && inZone(p.lat, p.lon, zones()));
  if (hoverMarker && map) { if (onMap) hoverMarker.setLatLng([p.lat, p.lon]).addTo(map); else hoverMarker.remove(); }
  if (chart && !fromChart) {
    const active = p ? [{ datasetIndex: 0, index: i }] : [];
    chart.setActiveElements(active);
    chart.tooltip.setActiveElements(active, { x: 0, y: 0 });
    chart.update('none');
  }
}

function renderHills() {
  const el = $('#planHills');
  if (!hills.length) { el.innerHTML = `<p class="hint">${line.length > 1 ? 'No hills on this route.' : 'No hills yet.'}</p>`; return; }
  el.innerHTML = `<div class="table-wrap"><table class="rules hills">
    <thead><tr><th>#</th><th class="num">Starts at</th><th class="num">Length</th><th class="num">Climb</th><th class="num">Average grade</th></tr></thead>
    <tbody>${hills.map((h, i) => `<tr data-hill="${i}" tabindex="0" title="Show on the map">
      <td>${i + 1}</td><td class="num">${fmtDec1(distIn(h.startKm))} ${distLabel()}</td>
      <td class="num">${fmtInt(h.length)} m</td>
      <td class="num">${fmtInt(h.gain)} m</td><td class="num">${fmtDec1(h.grade * 100)} %</td></tr>`).join('')}</tbody>
  </table></div>`;
  const zoom = row => {
    const h = hills[+row.dataset.hill];
    map.fitBounds(L.latLngBounds(line.slice(h.from, h.to + 1).map(p => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 17 });
    $('#planMap').scrollIntoView({ block: 'center' });
  };
  el.querySelectorAll('[data-hill]').forEach(row => {
    row.addEventListener('click', () => zoom(row));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(row); } });
  });
}

/* ---------- Saved routes ---------- */
const saveMessage = text => { $('#planSaveMessage').textContent = text || ''; };

/** Buttons and the "unsaved" note follow the plan's state */
function saveState() {
  const ready = hist.current.length > 1 && line.length > 1;
  const box = $('#planSaved');
  if (!box) return;
  box.querySelector('[data-save="save"]').disabled = !ready;
  box.querySelector('[data-save="gpx"]').disabled = !ready;
  box.querySelector('[data-save="copy"]').hidden = !plan.id;
  $('#planSavedSub').textContent = plan.id
    ? `Editing "${plan.name}"${dirty ? ' · unsaved changes' : ''}.`
    : dirty && ready ? 'Not saved yet. Name the route and save it.' : 'Name the route to save it. Saved routes stay on this computer.';
}

/** The segments of the current points, in order (all are cached once the route is drawn) */
const currentSegments = () => hist.current.slice(1).map((p, i) => segments.get(segmentKey(hist.current[i], p)));

async function savePlan(asNew) {
  const name = $('#planName').value.trim();
  if (!name) { $('#planName').setAttribute('aria-invalid', 'true'); $('#planName').focus(); saveMessage('Give the route a name first.'); return; }
  $('#planName').removeAttribute('aria-invalid');
  const segs = currentSegments();
  if (segs.some(x => !x)) { saveMessage('The route is still being planned. Try again in a moment.'); return; }
  const body = { name, points: hist.current, segments: segs.map(x => ({ points: x.points })),
    distance: line.at(-1).dist, climb: climbDescent(line).climb, ...(plan.id && !asNew ? { id: plan.id } : {}) };
  try {
    const res = await fetch('api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) { saveMessage(out.error || Object.values(out.errors || {})[0] || `Saving failed (HTTP ${res.status}).`); return; }
    plan = { id: out.plan.id, name: out.plan.name };
    dirty = false;
    saveMessage(`Saved "${plan.name}".`);
    saveState();
    listPlans();
  } catch (e) { saveMessage('Could not reach the app server. Is it still running?'); }
}

async function listPlans() {
  const el = $('#savedPlans');
  try {
    const { plans } = await (await fetch('api/plans', { cache: 'no-store' })).json();
    el.innerHTML = plans.length ? `<ul class="plan-list">${plans.map(p => `
      <li${p.id === plan.id ? ' aria-current="true"' : ''}>
        <span class="plan-name">${esc(p.name)}</span>
        <span class="muted num">${fmtKm(p.distance / 1000)} ${distLabel()} · ${fmtInt(p.climb)} m up · ${fmtDate(new Date(p.updated))}</span>
        <span class="plan-actions">
          <button type="button" class="btn small" data-open="${p.id}">Open</button>
          <button type="button" class="btn small" data-delete="${p.id}" data-name="${esc(p.name)}">Delete</button>
        </span></li>`).join('')}</ul>`
      : '<p class="hint">No saved routes yet.</p>';
  } catch (e) { el.innerHTML = '<p class="hint">Saved routes could not be loaded.</p>'; }
}

/** Unsaved changes are not thrown away without asking */
const okToLeave = async () => !dirty || hist.current.length < 2 || confirmDialog({
  title: 'Discard unsaved changes?', text: 'The current route has changes that are not saved.', confirm: 'Discard changes', danger: true });

async function openPlan(id) {
  if (!(await okToLeave())) return;
  try {
    const res = await fetch(`api/plans/${id}`, { cache: 'no-store' });
    const out = await res.json();
    if (!res.ok) { saveMessage(out.error || 'The route could not be opened.'); return; }
    const p = out.plan;
    // The saved segments go into the cache, so opening and editing need no routing requests
    p.segments.forEach((sg, i) => segments.set(segmentKey(p.points[i], p.points[i + 1]), sg));
    plan = { id: p.id, name: p.name };
    $('#planName').value = p.name;
    dirty = false;
    saveMessage('');
    await update(hist.reset(p.points));
    if (map && line.length > 1) map.fitBounds(L.latLngBounds(line.map(q => [q.lat, q.lon])), { padding: [30, 30] });
    listPlans();
    $('#planMap').scrollIntoView({ block: 'center' });
  } catch (e) { saveMessage('Could not reach the app server. Is it still running?'); }
}

async function newPlan() {
  if (!(await okToLeave())) return;
  plan = { id: null, name: '' };
  $('#planName').value = '';
  dirty = false;
  saveMessage('');
  update(hist.reset([]));
  listPlans();
}

async function deletePlan(id, name) {
  if (!(await confirmDialog({ title: `Delete "${name}"?`, text: "The saved route is removed from this computer. This can't be undone.", confirm: 'Delete', danger: true }))) return;
  try {
    const res = await fetch('api/plans/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!res.ok) { saveMessage((await res.json()).error || 'The route could not be deleted.'); return; }
    if (plan.id === id) { plan = { id: null, name: $('#planName').value.trim() }; dirty = true; }
    saveMessage(`Deleted "${name}".`);
    saveState();
    listPlans();
  } catch (e) { saveMessage('Could not reach the app server. Is it still running?'); }
}

/** Download the planned line as a GPX file */
function exportGpx() {
  if (line.length < 2) return;
  const name = $('#planName').value.trim() || 'Planned route';
  const hide = hideZonesWhenSharing() && zones().length > 0;
  const blob = new Blob([toGpx(line, name, hide ? zones() : [])], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'route'}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  saveMessage(`Exported ${a.download}${hide ? ', without the parts inside your privacy zones' : ''}.`);
}
