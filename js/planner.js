// Route planning: waypoints and their edits (undo/redo, back to start, out and back), the planned line
// from routed segments, kilometre markers, climb and descent, hills, grade colors, a time estimate that
// accounts for hills, and GPX. Pure logic, no DOM code.

import { BUCKETS } from './route.js';

export const SMOOTH_M = 50;           // elevation is averaged over 50 m before grades, climbs and hills
export const HILLS = { minGain: 20, minGrade: 0.03, maxGap: 50 };   // a hill: ≥ 20 m up at ≥ 3 %, flat bits up to 50 m allowed
export const GRADE_STEPS = [-0.06, -0.02, 0.02, 0.06];                 // grade colors: ≤ −6 %, −6…−2, flat, 2…6, ≥ 6 %
export const MINETTI_LIMITS = { grade: 0.3, minFactor: 0.85, maxFactor: 3 };
const EARTH_M = 6_371_000;
const rad = d => d * Math.PI / 180;

/** Metres between two [lat, lon] points (haversine) */
export function distanceM(a, b) {
  const dp = rad(b[0] - a[0]), dl = rad(b[1] - a[1]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/* ---------- Waypoints and edits (every edit returns a new array) ---------- */
export const addPoint = (pts, p) => [...pts, p];
export const movePoint = (pts, i, p) => pts.map((q, k) => (k === i ? p : q));
export const removePoint = (pts, i) => pts.filter((_, k) => k !== i);
/** Close the loop: end where the route started */
export const backToStart = pts => (pts.length > 1 ? [...pts, pts[0]] : pts);
/** Run the same way back: the waypoints in reverse after the turn point */
export const outAndBack = pts => (pts.length > 1 ? [...pts, ...pts.slice(0, -1).reverse()] : pts);

/** Undo/redo over snapshots of the waypoints */
export function history(initial = []) {
  const past = [], future = [];
  let now = initial;
  return {
    get current() { return now; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    push(next) { past.push(now); now = next; future.length = 0; return now; },
    undo() { if (past.length) { future.push(now); now = past.pop(); } return now; },
    redo() { if (future.length) { past.push(now); now = future.pop(); } return now; },
    reset(to = []) { past.length = 0; future.length = 0; now = to; return now; },
  };
}

/** The key of the segment between two waypoints (for caching the routed lines) */
export const segmentKey = (a, b) => `${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}`;

/* ---------- The planned line ---------- */
/**
 * Join routed segments ([{ points: [[lat, lon, ele]] }]) into one line of
 * [{ lat, lon, ele, dist (m from the start), wp (index of the waypoint that ends here, or null) }].
 */
export function joinSegments(segments) {
  const line = [];
  segments.forEach((seg, s) => {
    seg.points.forEach((p, i) => {
      if (s > 0 && i === 0) return;                  // the joint is the last point of the previous segment
      const prev = line[line.length - 1];
      const dist = prev ? prev.dist + distanceM([prev.lat, prev.lon], p) : 0;
      line.push({ lat: p[0], lon: p[1], ele: p[2] ?? null, dist, wp: null });
    });
    if (line.length) line[line.length - 1].wp = s + 1;
  });
  if (line.length) line[0].wp = 0;
  return line;
}

/** Elevation averaged over `window` metres (centred); null where there is no elevation */
export function smoothElevation(line, window = SMOOTH_M) {
  const half = window / 2;
  let lo = 0, hi = 0, sum = 0, n = 0;
  return line.map(p => {
    while (hi < line.length && line[hi].dist <= p.dist + half) { if (line[hi].ele != null) { sum += line[hi].ele; n++; } hi++; }
    while (line[lo].dist < p.dist - half) { if (line[lo].ele != null) { sum -= line[lo].ele; n--; } lo++; }
    return n ? sum / n : null;
  });
}

/** Total climb and descent in metres, from the smoothed elevation */
export function climbDescent(line) {
  const ele = smoothElevation(line);
  let up = 0, down = 0, prev = null;
  for (const e of ele) {
    if (e == null) continue;
    if (prev != null) { if (e > prev) up += e - prev; else down += prev - e; }
    prev = e;
  }
  return { climb: up, descent: down };
}

/** Grade (rise / run) at each point, from the smoothed elevation over SMOOTH_M on both sides */
export function grades(line) {
  const ele = smoothElevation(line);
  return line.map((p, i) => {
    let a = i, b = i;
    while (a > 0 && p.dist - line[a].dist < SMOOTH_M / 2) a--;
    while (b < line.length - 1 && line[b].dist - p.dist < SMOOTH_M / 2) b++;
    const run = line[b].dist - line[a].dist;
    return run > 0 && ele[a] != null && ele[b] != null ? (ele[b] - ele[a]) / run : null;
  });
}

/** Grade → 0 … BUCKETS-1 (steep down … steep up) */
export const gradeBucket = g => (g == null ? null : GRADE_STEPS.filter(step => g > step).length);

/** Positions of every whole kilometre along the line: [{ km, lat, lon }] */
export function kmMarkers(line, every = 1000) {
  const out = [];
  let next = every;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    while (b.dist >= next) {
      const f = (next - a.dist) / ((b.dist - a.dist) || 1);
      out.push({ km: next / 1000, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      next += every;
    }
  }
  return out;
}

/**
 * Hills: stretches where the grade is at least HILLS.minGrade, allowing flat or dipping bits of up to
 * HILLS.maxGap metres inside, that climb at least HILLS.minGain metres in total. (Measuring from low
 * point to top instead would merge a steep hill with the gentle road after it and lose it.)
 * [{ from, to (indexes), startKm, length (m), gain (m), grade }]
 */
export function findHills(line, rules = HILLS) {
  const ele = smoothElevation(line), g = grades(line);
  const hills = [];
  let start = null, lastUp = null;
  const close = () => {
    if (start == null) return;
    const gain = ele[lastUp] - ele[start], length = line[lastUp].dist - line[start].dist;
    if (gain >= rules.minGain && length > 0 && gain / length >= rules.minGrade) {
      hills.push({ from: start, to: lastUp, startKm: line[start].dist / 1000, length, gain, grade: gain / length });
    }
    start = lastUp = null;
  };
  for (let i = 0; i < line.length; i++) {
    const up = g[i] != null && g[i] >= rules.minGrade;
    if (up) {
      if (start == null) start = i;
      lastUp = i;
    } else if (start != null && line[i].dist - line[lastUp].dist > rules.maxGap) {
      close();
    }
  }
  close();
  return hills;
}

/**
 * Minetti et al. (2002) energy cost of running at grade i, J/kg/m:
 * C(i) = 155.4 i⁵ − 30.4 i⁴ − 43.3 i³ + 46.3 i² + 19.5 i + 3.6.  Pace factor = C(i) / C(0), limited to
 * MINETTI_LIMITS (the formula is too optimistic about steep downhills).
 */
export function hillFactor(grade) {
  const i = Math.max(-MINETTI_LIMITS.grade, Math.min(MINETTI_LIMITS.grade, grade || 0));
  const c = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  return Math.max(MINETTI_LIMITS.minFactor, Math.min(MINETTI_LIMITS.maxFactor, c / 3.6));
}

/** Estimated seconds at `pace` (s/km on the flat), each SMOOTH_M piece slowed or sped up by its grade */
export function timeEstimate(line, pace) {
  if (line.length < 2 || !(pace > 0)) return null;
  const ele = smoothElevation(line);
  let sec = 0, from = 0;
  for (let i = 1; i < line.length; i++) {
    if (line[i].dist - line[from].dist < SMOOTH_M && i < line.length - 1) continue;
    const run = line[i].dist - line[from].dist;
    const grade = ele[from] != null && ele[i] != null && run > 0 ? (ele[i] - ele[from]) / run : 0;
    sec += run / 1000 * pace * hillFactor(grade);
    from = i;
  }
  return sec;
}

/* ---------- GPX ---------- */
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** GPX 1.1 with one track; points with elevation when known */
export function toGpx(line, name = 'Planned route') {
  const pts = line.map(p => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Running Log" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(name)}</name></metadata>
  <trk>
    <name>${xml(name)}</name>
    <trkseg>
${pts.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
}

export { BUCKETS };
