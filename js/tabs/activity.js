// Activity page (#activity/<id>): the route on a map colored by pace, heart rate or elevation,
// pace/HR/elevation curves synced with the map, and kilometre splits.

import { state } from '../state.js';
import { fmtKm, fmtDec1, fmtInt, fmtPace, fmtClock, fmtDuration, fmtDate, fmtTime, fmtWorkout, esc, distLabel, paceLabel, distIn, paceIn, DASH } from '../format.js';
import { describeWorkout, planTitles } from '../workouts.js';
import { routePoints, routeState, smooth, kmSplits, fastestSlowest, colorScale, coloredRuns, indexAtDistance, indexAtLatLng } from '../route.js';
import { theme, baseOptions, drawChart, mainLine } from '../charts.js';
import { loadLeaflet, baseMap, routeColors } from '../map.js';
import { skeleton } from './states.js';

const $ = s => document.querySelector(s);
const COLOR_BY = { pace: 'Pace', hr: 'Heart rate', ele: 'Elevation' };

let view = null;          // { id, act, route, points, map, layers, marker, charts }
let colorBy = 'pace';
const routeCache = new Map();

async function loadRoute(id) {
  if (routeCache.has(id)) return routeCache.get(id);
  const res = await fetch(`data/routes/${id}.json`, { cache: 'no-store' });
  const route = res.ok ? await res.json() : null;
  routeCache.set(id, route);
  return route;
}

/* ---------- Page ---------- */
export async function renderActivity(id) {
  const el = $('#activityView');
  const act = state.acts.find(a => String(a.id) === String(id));
  if (!act) {
    el.innerHTML = state.acts.length
      ? `<div class="card state-error" role="alert"><h2>Activity not found</h2><p class="hint">It may be older than the fetched range.</p>
         <div class="row-actions"><a class="btn" href="#training">Back to Training</a></div></div>`
      : skeleton('Loading the activity');
    return;
  }
  if (view?.id === act.id && view.drawn) return;   // already showing it (a redraw of the app)
  view = { id: act.id, act, drawn: false };
  const d = describeWorkout(act, planTitles(state.meta?.schedule).get(act.workoutId));
  el.innerHTML = `
    <div class="page-head activity-head">
      <a class="more-link back-link" href="#training">← Training</a>
      <h2 class="page-title">${fmtWorkout({ ...d, repeatsKind: false })}</h2>
      <p class="hint">${fmtDate(act.date)} at ${fmtTime(act.date)}</p>
    </div>
    <div class="kpis" id="actStats"></div>
    <div class="grid">
      <section class="card span-2" id="actMapCard">${skeleton('Loading the route')}</section>
      <section class="card span-2" id="actCurves" hidden></section>
      <section class="card span-2" id="actSplits" hidden></section>
    </div>`;
  renderStats(act, null);

  let route = null;
  try { route = act.route ? await loadRoute(act.id) : null; } catch (e) { route = null; }
  if (view?.id !== act.id) return;                   // the user moved on while it loaded
  const points = route ? routePoints(route) : [];
  Object.assign(view, { route, points });
  renderStats(act, points);
  const where = routeState(route, points);
  if (where === 'route') await drawMap(points); else renderNoRoute(act, route, where);
  if (points.length > 1) { renderCurves(points); renderSplits(points); }
  view.drawn = true;
}

function renderStats(act, points) {
  const climb = points?.length ? kmSplits(points).reduce((s, x) => s + x.climb, 0) : null;
  const kpi = (label, value, unit = '') => `<div class="kpi"><div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div></div>`;
  $('#actStats').innerHTML =
    kpi('Distance', fmtKm(act.km), distLabel()) +
    kpi('Time', fmtDuration(act.sec)) +
    kpi('Average pace', act.km > 0 ? fmtPace(act.sec / act.km) : DASH, paceLabel()) +
    kpi('Average HR', fmtInt(act.hr), 'bpm') +
    (climb != null ? kpi('Climb', fmtInt(climb), 'm') : '');
}

/* ---------- No map ---------- */
function renderNoRoute(act, route, where) {
  const indoor = /treadmill|indoor|virtual/i.test(act.type);
  const [title, text] = where === 'hidden'
    ? ['Route hidden', 'The whole route is inside your privacy zones, so its positions were not saved.']
    : indoor ? ['No GPS route', 'Treadmill and indoor runs have no route. The curves and splits below come from the watch.']
    : !/run|juoks|trail/i.test(act.type) ? ['No route', 'Routes are saved for runs only.']
    : !act.route ? ['No GPS route yet', 'Routes of outdoor runs are fetched with the next Garmin fetch.']
    : ['No GPS route', 'The watch recorded this run without GPS.'];
  $('#actMapCard').innerHTML = `<div class="no-route" role="status">
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/><path d="M4 4l16 16"/></svg>
    <div><h2>${title}</h2><p class="hint">${text}</p></div></div>`;
}

/* ---------- Map ---------- */
function valuesFor(points, key) {
  return key === 'pace' ? smooth(points, 'pace') : key === 'hr' ? smooth(points, 'hr') : points.map(p => p.ele);
}

async function drawMap(points) {
  const card = $('#actMapCard');
  let L;
  try { L = await loadLeaflet(); } catch (e) {
    card.innerHTML = `<div class="no-route" role="alert"><div><h2>Map not available</h2><p class="hint">${esc(e.message)}</p></div></div>`;
    return;
  }
  card.innerHTML = `
    <div class="card-head"><div><h2>Route</h2>
      <p class="sub">${view.route.hidden ? 'Parts inside your privacy zones are not shown.' : 'Point at the route or the curves to see the same spot on both.'}</p></div>
      <div class="seg" id="colorBy" role="group" aria-label="Color the route by">
        ${Object.entries(COLOR_BY).map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === colorBy}">${l}</button>`).join('')}
      </div></div>
    <div class="map" id="actMap" role="region" aria-label="Route map"></div>
    <div class="map-legend" id="mapLegend"></div>`;
  const map = baseMap(L, $('#actMap'));
  view.map = map;
  view.L = L;
  paintRoute();
  const latlngs = points.filter(p => p.lat != null).map(p => [p.lat, p.lon]);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
  const c = routeColors();
  L.circleMarker(latlngs[0], { radius: 5, color: c.surface, weight: 2, fillColor: c.marker, fillOpacity: 1 }).addTo(map).bindTooltip('Start');
  L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: c.marker, weight: 2, fillColor: c.surface, fillOpacity: 1 }).addTo(map).bindTooltip('Finish');
  view.marker = L.circleMarker(latlngs[0], { radius: 7, color: c.surface, weight: 3, fillColor: c.marker, fillOpacity: 1, interactive: false });

  $('#colorBy').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    colorBy = b.dataset.v;
    $('#colorBy').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    paintRoute();
  });
}

/** Draw the route in the chosen coloring (casing underneath, then the colored pieces) */
function paintRoute() {
  const { L, map, points } = view;
  if (view.layers) view.layers.remove();
  const c = routeColors();
  const values = valuesFor(points, colorBy);
  const scale = colorScale(values, colorBy === 'pace');   // fast pace = high end of the scale
  const buckets = values.map(scale);
  const group = L.featureGroup();
  for (const run of coloredRuns(points, buckets.map(b => b ?? 0))) {
    L.polyline(run.latlngs, { color: c.casing, weight: 7, opacity: 0.9, interactive: false }).addTo(group);
  }
  for (const run of coloredRuns(points, buckets.map(b => b ?? 0))) {
    L.polyline(run.latlngs, { color: c.steps[run.bucket], weight: 4, opacity: 1 }).addTo(group);
  }
  group.on('mousemove', e => setHover(indexAtLatLng(points, e.latlng.lat, e.latlng.lng)));
  group.on('mouseout', () => setHover(null));
  group.addTo(map);
  view.layers = group;

  const [lo, hi] = scale.range || [];
  const fmt = v => colorBy === 'pace' ? `${fmtPace(v)} ${paceLabel()}` : colorBy === 'hr' ? `${fmtInt(v)} bpm` : `${fmtInt(v)} m`;
  const [left, right] = colorBy === 'pace' ? [hi, lo] : [lo, hi];   // slow → fast, low → high
  $('#mapLegend').innerHTML = lo == null ? '' : `
    <span class="num">${fmt(left)}</span>
    <span class="legend-steps" aria-hidden="true">${c.steps.map(s => `<i style="background:${s}"></i>`).join('')}</span>
    <span class="num">${fmt(right)}</span>
    <span class="hint">${COLOR_BY[colorBy]}${colorBy === 'pace' ? ', slow to fast' : ', low to high'}</span>`;
}

/* ---------- Curves, synced with the map ---------- */
// A vertical line at the hovered point, on every curve
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const a = chart.getActiveElements()[0];
    if (!a) return;
    const { top, bottom } = chart.chartArea, c = chart.ctx;
    c.save(); c.strokeStyle = theme().axis; c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(a.element.x, top); c.lineTo(a.element.x, bottom); c.stroke(); c.restore();
  },
};

function renderCurves(points) {
  const card = $('#actCurves');
  card.hidden = false;
  card.innerHTML = `<div class="card-head"><div><h2>Pace, heart rate and elevation</h2>
      <p class="sub">By distance. Pace and heart rate are 30-second averages.</p></div></div>
    <div class="curve"><canvas id="curvePace" aria-label="Pace along the run" role="img"></canvas></div>
    <div class="curve"><canvas id="curveHr" aria-label="Heart rate along the run" role="img"></canvas></div>
    <div class="curve"><canvas id="curveEle" aria-label="Elevation along the run" role="img"></canvas></div>`;
  const t = theme();
  const x = points.map(p => distIn((p.dist || 0) / 1000));
  const series = [
    ['curvePace', 'Pace', smooth(points, 'pace').map(v => v == null ? null : paceIn(v)), v => `${fmtClock(v)} ${paceLabel()}`, true],
    ['curveHr', 'Heart rate', smooth(points, 'hr'), v => `${fmtInt(v)} bpm`, false],
    ['curveEle', 'Elevation', points.map(p => p.ele), v => `${fmtInt(v)} m`, false],
  ];
  view.charts = series.map(([id, label, data, fmt, reverse]) => {
    const base = baseOptions(t, items => `${fmtDec1(x[items[0].dataIndex])} ${distLabel()}`);
    return drawChart(id, {
      type: 'line',
      data: { datasets: [{ label, data: data.map((y, i) => ({ x: x[i], y })), ...mainLine(t, { borderWidth: 1.5, spanGaps: true, tension: 0 }) }] },
      options: { ...base,
        interaction: { mode: 'index', intersect: false },
        onHover: (e, els) => setHover(els.length ? els[0].index : null, id),
        plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { title: base.plugins.tooltip.callbacks.title, label: c => `${label}: ${fmt(c.parsed.y)}` } } },
        scales: {
          x: { ...base.scales.x, type: 'linear', min: 0, max: x[x.length - 1], ticks: { ...base.scales.x.ticks, callback: v => Number.isInteger(v) ? `${v} ${distLabel()}` : '' } },   // whole km only
          y: { ...base.scales.y, reverse, ticks: { ...base.scales.y.ticks, maxTicksLimit: 4, callback: v => fmt(v).split(' ')[0] } },
        } },
      plugins: [crosshair],
    });
  });
  $('#actCurves').addEventListener('mouseleave', () => setHover(null));
}

/** One hovered point for the map and all curves (from = the chart that started it) */
function setHover(i, from = null) {
  if (!view) return;
  const p = i == null || i < 0 ? null : view.points[i];
  if (view.marker && view.map) {
    if (p?.lat != null) view.marker.setLatLng([p.lat, p.lon]).addTo(view.map);
    else view.marker.remove();
  }
  for (const chart of view.charts || []) {
    if (chart.canvas.id === from) continue;
    const active = p ? [{ datasetIndex: 0, index: i }] : [];
    chart.setActiveElements(active);
    chart.tooltip.setActiveElements(active, { x: 0, y: 0 });
    chart.update('none');
  }
}

/* ---------- Splits ---------- */
function renderSplits(points) {
  const splits = kmSplits(points);
  if (!splits.length) return;
  const { fastest, slowest } = fastestSlowest(splits);
  const card = $('#actSplits');
  card.hidden = false;
  card.innerHTML = `<div class="card-head"><div><h2>Kilometre splits</h2>
      <p class="sub">Every kilometre from the watch's distance. The fastest and slowest full kilometres are marked.</p></div></div>
    <div class="table-wrap"><table class="splits">
      <thead><tr><th class="num">km</th><th class="num">Time</th><th class="num">Pace</th><th class="num">Avg HR</th><th class="num">Climb</th><th></th></tr></thead>
      <tbody>${splits.map((s, i) => `
        <tr class="${i === fastest ? 'split-fast' : i === slowest ? 'split-slow' : ''}">
          <td class="num">${s.partial ? fmtKm(s.dist / 1000) : s.km}</td>
          <td class="num">${fmtDuration(s.sec)}</td>
          <td class="num">${fmtPace(s.pace)} ${paceLabel()}</td>
          <td class="num">${fmtInt(s.hr)}</td>
          <td class="num">${fmtInt(s.climb)} m</td>
          <td>${i === fastest ? '<span class="kind split-tag">Fastest</span>' : i === slowest ? '<span class="kind split-tag">Slowest</span>' : ''}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    ${splits.at(-1).partial ? `<p class="hint">The last row is the final ${fmtKm(splits.at(-1).dist / 1000)} ${distLabel()}.</p>` : ''}`;
  if (distLabel() !== 'km') card.querySelector('.sub').insertAdjacentText('beforeend', ' Splits are per kilometre in every unit setting.');
}

/** Leaving the page: forget the map so it is rebuilt next time */
export function leaveActivity() {
  if (view?.map) view.map.remove();
  view = null;
}

/** Link to an activity page, wrapping any HTML (e.g. fmtWorkout) */
export const activityLink = (act, html) => act?.id != null ? `<a class="workout-link" href="#activity/${act.id}">${html}</a>` : html;
