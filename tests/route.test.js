// GPS route logic: points, splits, colors, map pieces and lookups. Made-up coordinates only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routePoints, routeState, smooth, kmSplits, fastestSlowest, colorScale, coloredRuns, indexAtDistance, indexAtLatLng, nearLatest, BUCKETS,
} from '../js/route.js';

const FIELDS = ['t', 'lat', 'lon', 'dist', 'speed', 'hr', 'ele'];
// A 2.5 km run, one point per 10 s: first km at 5:00/km (3.333 m/s), second at 4:00/km (4.167 m/s), then 5:00 again
function route({ hideFirst = 0 } = {}) {
  const points = [];
  let t = 0, dist = 0;
  while (dist < 2500) {
    const speed = dist < 1000 ? 1000 / 300 : dist < 2000 ? 1000 / 240 : 1000 / 300;
    points.push([t, 60 + dist / 111000, 25, +dist.toFixed(1), speed, dist < 1000 ? 140 : 160, 10 + dist / 100]);
    t += 10; dist += speed * 10;
  }
  points.forEach((p, i) => { if (i < hideFirst) { p[1] = null; p[2] = null; } });
  return { id: 1, gps: true, hidden: hideFirst, fields: FIELDS, points };
}

test('points: pace from speed, none when standing still', () => {
  const p = routePoints({ fields: FIELDS, points: [[0, 60, 25, 0, 4, 150, 10], [5, 60, 25, 20, 0.2, 150, 10]] });
  assert.equal(p[0].pace, 250);
  assert.equal(p[1].pace, null);
});

test('route state: route, hidden by privacy zones, or no GPS', () => {
  const r = route();
  assert.equal(routeState(r, routePoints(r)), 'route');
  const hidden = route({ hideFirst: 1000 });
  assert.equal(routeState(hidden, routePoints(hidden)), 'hidden');
  assert.equal(routeState({ gps: false, points: [] }, []), 'none');
  assert.equal(routeState(null, []), 'none');
});

test('kilometre splits are interpolated, with HR and climb; the partial last km is marked', () => {
  const s = kmSplits(routePoints(route()));
  assert.equal(s.length, 3);
  assert.ok(Math.abs(s[0].pace - 300) < 1, `first km ${s[0].pace}`);
  assert.ok(Math.abs(s[1].pace - 240) < 1, `second km ${s[1].pace}`);
  assert.ok(Math.abs(s[0].hr - 140) < 1 && Math.abs(s[1].hr - 160) < 1);
  assert.ok(Math.abs(s[0].climb - 10) < 0.5, 'elevation rises 1 m per 100 m');
  assert.equal(s[2].partial, true);
  assert.ok(Math.abs(s[2].dist - 500) < 40);
  assert.deepEqual(fastestSlowest(s), { fastest: 1, slowest: 0 }, 'the partial km is not compared');
});

test('splits still work when positions are hidden by a privacy zone', () => {
  assert.equal(kmSplits(routePoints(route({ hideFirst: 30 }))).length, 3);
});

test('color scale: 5 steps between the 5th and 95th percentile; a spike does not stretch it', () => {
  const values = [...Array.from({ length: 100 }, (_, i) => 200 + i), 5000];
  const b = colorScale(values);
  assert.equal(b(200), 0);
  assert.equal(b(299), BUCKETS - 1);
  assert.equal(b(5000), BUCKETS - 1, 'clipped');
  assert.equal(b(250), 2);
  assert.equal(colorScale(values, true)(200), BUCKETS - 1, 'inverted (fast pace = high)');
  assert.equal(b(null), null);
});

test('map pieces: one color each, broken at hidden positions and long pauses', () => {
  const pts = routePoints({ fields: FIELDS, points: [
    [0, 60, 25, 0, 3, 140, 0], [5, 60.001, 25, 15, 3, 140, 0], [10, 60.002, 25, 30, 3, 140, 0],
    [15, null, null, 45, 3, 140, 0], [20, 60.004, 25, 60, 3, 140, 0], [25, 60.005, 25, 75, 3, 140, 0],
    [200, 60.006, 25, 90, 3, 140, 0], [205, 60.007, 25, 105, 3, 140, 0],
  ] });
  const runs = coloredRuns(pts, [0, 0, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(runs.map(r => [r.bucket, r.latlngs.length]), [[0, 2], [1, 2], [1, 2], [1, 2]]);
  assert.deepEqual(runs[1].latlngs[0], [60.001, 25], 'a color change joins the pieces');
});

test('smoothing and lookups', () => {
  const pts = routePoints(route());
  const sm = smooth(pts, 'hr', 30);
  assert.equal(sm.length, pts.length);
  assert.ok(sm.every(v => v >= 140 && v <= 160));
  assert.equal(indexAtDistance(pts, 0), 0);
  assert.equal(indexAtLatLng(pts, pts[10].lat, 25), 10);
});

test('heatmap starts from the routes near the latest one', () => {
  const at = (lat, lon) => ({ points: [{ lat: null }, { lat, lon }] });
  const list = [at(60.17, 24.94), at(60.2, 24.9), at(59.33, 18.07)];
  assert.equal(nearLatest(list).length, 2, 'Stockholm is far from Helsinki');
});
