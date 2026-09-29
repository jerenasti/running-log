// GPS routes (data/routes/<id>.json, written by routes.py): points, kilometre splits, color scales
// and lookups for syncing the map with the curves. Pure logic, no DOM code.

export const STOP_SPEED = 0.5;       // m/s: slower than this counts as standing still (no pace)
export const GAP_SECONDS = 60;       // a pause this long breaks the line on the map
export const SMOOTH_SECONDS = 30;    // pace and heart rate curves: rolling average over 30 s
export const BUCKETS = 5;            // route colors: 5 steps from low to high
const MIN_LAST_SPLIT_M = 100;        // a last partial kilometre shorter than this is left out

/** Route file → points [{ t, lat, lon, dist, speed, hr, ele, pace }]; pace in s/km, null when standing */
export function routePoints(route) {
  const f = route?.fields || [];
  const at = name => f.indexOf(name);
  const i = { t: at('t'), lat: at('lat'), lon: at('lon'), dist: at('dist'), speed: at('speed'), hr: at('hr'), ele: at('ele') };
  return (route?.points || []).map(p => {
    const speed = p[i.speed] ?? null;
    return {
      t: p[i.t], lat: p[i.lat] ?? null, lon: p[i.lon] ?? null, dist: p[i.dist] ?? null,
      speed, hr: p[i.hr] ?? null, ele: p[i.ele] ?? null,
      pace: speed != null && speed >= STOP_SPEED ? 1000 / speed : null,
    };
  });
}

/** What the map can show: 'route' | 'hidden' (all positions inside privacy zones) | 'none' (no GPS) */
export function routeState(route, points) {
  if (!route || !route.gps || !points.length) return 'none';
  return points.some(p => p.lat != null) ? 'route' : 'hidden';
}

/** Rolling average over `seconds` (centred), skipping nulls; returns a new array of values */
export function smooth(points, key, seconds = SMOOTH_SECONDS) {
  const half = seconds / 2;
  let lo = 0, hi = 0, sum = 0, n = 0;
  return points.map(p => {
    while (hi < points.length && points[hi].t <= p.t + half) { const v = points[hi][key]; if (v != null) { sum += v; n++; } hi++; }
    while (points[lo].t < p.t - half) { const v = points[lo][key]; if (v != null) { sum -= v; n--; } lo++; }
    return p[key] == null || !n ? null : sum / n;
  });
}

/**
 * Kilometre splits: [{ km, dist, sec, pace, hr, climb }]. The time at each full kilometre is
 * interpolated between the two points around it; hr is time-weighted; climb = metres gained.
 * The last partial kilometre is included (partial: true) when it is at least 100 m.
 */
export function kmSplits(points) {
  const pts = points.filter(p => p.dist != null && p.t != null);
  if (pts.length < 2) return [];
  const timeAt = d => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (b.dist >= d) return a.t + (b.t - a.t) * ((d - a.dist) / ((b.dist - a.dist) || 1));
    }
    return pts[pts.length - 1].t;
  };
  const total = pts[pts.length - 1].dist;
  const splits = [];
  for (let from = 0, km = 1; from < total; from += 1000, km++) {
    const to = Math.min(from + 1000, total);
    if (to - from < 1000 && to - from < MIN_LAST_SPLIT_M) break;
    const t0 = timeAt(from), t1 = timeAt(to), sec = t1 - t0;
    let hrSum = 0, hrSec = 0, climb = 0, prevEle = null;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (b.t <= t0 || a.t >= t1) continue;
      const dt = Math.min(b.t, t1) - Math.max(a.t, t0);
      if (b.hr != null) { hrSum += b.hr * dt; hrSec += dt; }
      if (b.ele != null) { if (prevEle != null && b.ele > prevEle) climb += b.ele - prevEle; prevEle = b.ele; }
    }
    splits.push({ km, dist: to - from, sec, pace: sec / ((to - from) / 1000), hr: hrSec ? hrSum / hrSec : null,
      climb, partial: to - from < 1000 });
  }
  return splits;
}

/** Indexes of the fastest and slowest full kilometre (null with fewer than two) */
export function fastestSlowest(splits) {
  const full = splits.map((s, i) => ({ s, i })).filter(x => !x.s.partial);
  if (full.length < 2) return { fastest: null, slowest: null };
  const by = full.slice().sort((a, b) => a.s.pace - b.s.pace);
  return { fastest: by[0].i, slowest: by[by.length - 1].i };
}

/** Value → 0 … BUCKETS-1, from the 5th to the 95th percentile (one GPS spike doesn't stretch the scale) */
export function colorScale(values, invert = false) {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return () => null;
  const q = f => v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))];
  const lo = q(0.05), hi = q(0.95), span = hi - lo || 1;
  const bucket = x => {
    if (x == null) return null;
    const r = Math.max(0, Math.min(1, (x - lo) / span));
    const b = Math.min(BUCKETS - 1, Math.floor(r * BUCKETS));
    return invert ? BUCKETS - 1 - b : b;
  };
  bucket.range = [lo, hi];
  return bucket;
}

/**
 * The line on the map in pieces of one color: [{ bucket, latlngs: [[lat, lon], …] }]. A piece ends
 * where the color changes, where the position is hidden (privacy zone) and at a pause over GAP_SECONDS.
 */
export function coloredRuns(points, buckets) {
  const runs = [];
  let cur = null, prev = null;
  points.forEach((p, i) => {
    if (p.lat == null) { cur = null; prev = null; return; }
    const b = buckets[i];
    const gap = prev && p.t - prev.t > GAP_SECONDS;
    if (!cur || gap || cur.bucket !== b) {
      const start = cur && !gap ? [cur.latlngs[cur.latlngs.length - 1]] : [];   // pieces join up
      cur = { bucket: b, latlngs: start };
      runs.push(cur);
    }
    cur.latlngs.push([p.lat, p.lon]);
    prev = p;
  });
  return runs.filter(r => r.latlngs.length > 1);
}

/** Index of the point closest to `dist` metres (the curves' x axis) */
export function indexAtDistance(points, dist) {
  let best = -1, bestD = Infinity;
  points.forEach((p, i) => { if (p.dist != null && Math.abs(p.dist - dist) < bestD) { bestD = Math.abs(p.dist - dist); best = i; } });
  return best;
}

/** Index of the point on the map closest to [lat, lon] (equirectangular distance is plenty at this scale) */
export function indexAtLatLng(points, lat, lon) {
  const k = Math.cos(lat * Math.PI / 180);
  let best = -1, bestD = Infinity;
  points.forEach((p, i) => {
    if (p.lat == null) return;
    const d = (p.lat - lat) ** 2 + ((p.lon - lon) * k) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Routes around the most recent one (starting within `km` of it), for the heatmap's first view */
export function nearLatest(routeList, km = 50) {
  const withStart = routeList.map(r => ({ r, s: r.points.find(p => p.lat != null) })).filter(x => x.s);
  if (!withStart.length) return [];
  const ref = withStart[0].s;
  const k = Math.cos(ref.lat * Math.PI / 180), deg = km / 111;
  return withStart.filter(x => Math.hypot(x.s.lat - ref.lat, (x.s.lon - ref.lon) * k) <= deg).map(x => x.r);
}
