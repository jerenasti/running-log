// Routes tab: plan a run on the map. Click to add points; the route follows roads and paths
// (openrouteservice through the app server, POST /api/route). Points can be dragged and removed, with
// undo/redo, "Back to start" and "Out and back". Below the map: stats, an elevation profile synced with
// the map, and the hills. Logic lives in ../planner.js.

import { state } from '../state.js';
import {
  addPoint, movePoint, removePoint, backToStart, outAndBack, history, segmentKey, joinSegments,
  climbDescent, grades, gradeBucket, kmMarkers, findHills, timeEstimate, HILLS, GRADE_STEPS,
} from '../planner.js';
import { coloredRuns, indexAtLatLng } from '../route.js';
import { isEasyRun } from '../metrics.js';
import { easyRule } from '../settings.js';
import { fmtKm, fmtDec1, fmtInt, fmtPace, fmtDuration, distLabel, paceLabel, distIn, KM_PER_MILE, units } from '../format.js';
import { theme, baseOptions, drawChart, mainLine } from '../charts.js';
import { loadLeaflet, baseMap, routeColors } from '../map.js';
import { addDays } from '../dates.js';

const $ = s => document.querySelector(s);
const hist = history();
const segments = new Map();          // segmentKey → { points, distance, ascent, descent }
let map = null, L = null;
let layers = null, wpLayer = null, hoverMarker = null;
let line = [], hills = [];
let colorBy = 'plain';
let paceSec = null;                  // s/km on the flat, for the time estimate
let busy = false, chart = null;

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
            <p><b>Elevation</b> comes from openrouteservice (a satellite elevation model with a 30–90 m grid, so small hills look flatter than they are). It is averaged over 50 m before anything is calculated.</p>
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
       outback: () => edit(outAndBack(pts)), clear: () => edit([]) })[b.dataset.plan]();
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
  if (ok) update(hist.push(next));
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
}

/* ---------- Map ---------- */
function draw() {
  if (!map) return;
  if (layers) layers.remove();
  layers = L.featureGroup();
  const c = routeColors();
  if (line.length > 1) {
    const latlngs = line.map(p => [p.lat, p.lon]);
    L.polyline(latlngs, { color: c.casing, weight: 8, opacity: 0.9, interactive: false }).addTo(layers);
    if (colorBy === 'grade') {
      const buckets = grades(line).map(g => gradeBucket(g) ?? 2);
      for (const run of coloredRuns(line.map((p, i) => ({ ...p, t: i })), buckets)) {
        L.polyline(run.latlngs, { color: c.steps[run.bucket], weight: 5 }).addTo(layers);
      }
    } else {
      L.polyline(latlngs, { color: c.marker, weight: 4 }).addTo(layers);
      for (const h of hills) {
        L.polyline(latlngs.slice(h.from, h.to + 1), { color: c.heat, weight: 6 })
          .bindTooltip(`Hill: ${fmtInt(h.gain)} m up at ${fmtDec1(h.grade * 100)} %`, { sticky: true }).addTo(layers);
      }
    }
    for (const m of kmMarkers(line, units() === 'mi' ? KM_PER_MILE * 1000 : 1000)) {
      L.marker([m.lat, m.lon], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'km-marker', html: `<span>${Math.round(distIn(m.km))}</span>`, iconSize: [20, 20] }) }).addTo(layers);
    }
    layers.on('mousemove', e => hover(indexAtLatLng(line, e.latlng.lat, e.latlng.lng)));
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

function drawProfile() {
  const has = line.length > 1 && line.some(p => p.ele != null);
  $('#planProfileSub').textContent = has
    ? 'Point at the profile to see the place on the map. Shaded: hills.'
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
  if (hoverMarker && map) { if (p) hoverMarker.setLatLng([p.lat, p.lon]).addTo(map); else hoverMarker.remove(); }
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

/** The current plan (for saving and GPX in the next step) */
export const currentPlan = () => ({ points: hist.current, line });
