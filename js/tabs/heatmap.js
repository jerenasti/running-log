// Route heatmap on the Training tab: every saved route of the selected range on one map, drawn thin and
// see-through in the accent so often-run streets build up. Starts around the latest run; loads Leaflet
// and the route files only when the card scrolls into view.

import { fmtDate, esc } from '../format.js';
import { describeWorkout } from '../workouts.js';
import { routePoints, nearLatest } from '../route.js';
import { loadLeaflet, baseMap, routeColors } from '../map.js';

const $ = s => document.querySelector(s);
let map = null, L = null, layer = null, drawnKey = null, pending = null, observer = null, showAll = false;
const cache = new Map();

async function loadRoute(id) {
  if (!cache.has(id)) {
    cache.set(id, fetch(`data/routes/${id}.json`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(id);
}

/** acts: the runs in the Training range, newest first */
export function renderHeatmap(acts) {
  const withRoute = acts.filter(a => a.route);
  const card = $('#heatCard');
  $('#heatSub').textContent = withRoute.length
    ? `${withRoute.length} ${withRoute.length === 1 ? 'route' : 'routes'} in the selected range. Click a route to open the run.`
    : 'No routes in the selected range yet.';
  $('#heatMap').hidden = !withRoute.length;
  $('#heatAll').hidden = true;
  if (!withRoute.length) return;
  pending = withRoute;
  // Draw when the card is on screen (Leaflet and the route files are loaded then)
  if (!observer) {
    observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && pending) draw(pending); }, { rootMargin: '200px' });
    observer.observe(card);
  } else if (card.getBoundingClientRect().top < innerHeight + 200) {
    draw(withRoute);
  }
}

async function draw(acts) {
  const key = acts.map(a => a.id).join(',') + (showAll ? ':all' : '');
  if (key === drawnKey && map) { map.invalidateSize(); return; }   // same routes: only fit the map to its box again
  drawnKey = key;
  pending = null;
  try { L = await loadLeaflet(); } catch (e) {
    $('#heatSub').textContent = e.message;
    return;
  }
  const loaded = (await Promise.all(acts.map(async a => ({ act: a, route: await loadRoute(a.id) }))))
    .filter(x => x.route?.gps).map(x => ({ act: x.act, points: routePoints(x.route) }));
  if (!map) {
    map = baseMap(L, $('#heatMap'));
    $('#heatAll').addEventListener('click', () => { showAll = !showAll; drawnKey = null; draw(acts); });
  }
  if (layer) layer.remove();
  const near = nearLatest(loaded);
  const shown = showAll ? loaded : near;
  const c = routeColors();
  layer = L.featureGroup();
  for (const { act, points } of loaded) {
    // Each route may be split by privacy zones: draw every visible stretch
    let line = [];
    const parts = [];
    for (const p of points) {
      if (p.lat == null) { if (line.length > 1) parts.push(line); line = []; } else line.push([p.lat, p.lon]);
    }
    if (line.length > 1) parts.push(line);
    const d = describeWorkout(act);
    for (const part of parts) {
      L.polyline(part, { color: c.heat, weight: 3, opacity: 0.35 })
        .bindTooltip(`${esc(d.label ? d.label + ' · ' : '')}${esc(d.name)}<br>${fmtDate(act.date)}`, { sticky: true })
        .on('click', () => { location.hash = `#activity/${act.id}`; })
        .addTo(layer);
    }
  }
  layer.addTo(map);
  const bounds = L.latLngBounds(shown.flatMap(r => r.points.filter(p => p.lat != null).map(p => [p.lat, p.lon])));
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
  $('#heatSub').textContent = `${loaded.length} ${loaded.length === 1 ? 'route' : 'routes'} in the selected range. Click a route to open the run.`;
  const others = loaded.length - near.length;
  $('#heatAll').hidden = others <= 0;
  $('#heatAll').textContent = showAll ? 'Show the area of the latest run' : `Show all routes (${others} elsewhere)`;
  map.invalidateSize();
}
