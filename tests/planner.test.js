// Route planning logic: edits, joined line, kilometre markers, climb, hills, grade colors, time estimate, GPX.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceM, addPoint, movePoint, removePoint, backToStart, outAndBack, history, segmentKey, joinSegments,
  climbDescent, grades, gradeBucket, kmMarkers, findHills, hillFactor, timeEstimate, toGpx, HILLS,
} from '../js/planner.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const M_PER_DEG = 111195;   // metres per degree of latitude with the app's Earth radius

/** A straight line north, one point every `step` metres, elevation from eleAt(metres) */
function straight(length, eleAt = () => 10, step = 10) {
  const pts = [];
  for (let d = 0; d <= length; d += step) pts.push([60 + d / M_PER_DEG, 25, eleAt(d)]);
  return joinSegments([{ points: pts }]);
}

test('distance', () => {
  near(distanceM([60, 25], [60.001, 25]), 111.2, 0.2, '0.001° of latitude');
});

test('edits: add, move, remove, back to start, out and back', () => {
  let p = addPoint([], [60, 25]);
  p = addPoint(p, [60.01, 25]);
  p = addPoint(p, [60.01, 25.02]);
  assert.deepEqual(movePoint(p, 1, [60.02, 25]), [[60, 25], [60.02, 25], [60.01, 25.02]]);
  assert.deepEqual(removePoint(p, 1), [[60, 25], [60.01, 25.02]]);
  assert.deepEqual(backToStart(p).at(-1), [60, 25]);
  assert.deepEqual(outAndBack(p), [[60, 25], [60.01, 25], [60.01, 25.02], [60.01, 25], [60, 25]]);
  assert.deepEqual(backToStart([[60, 25]]), [[60, 25]], 'nothing to close with one point');
});

test('undo and redo', () => {
  const h = history();
  h.push([[1, 1]]);
  h.push([[1, 1], [2, 2]]);
  assert.deepEqual(h.undo(), [[1, 1]]);
  assert.equal(h.canRedo, true);
  assert.deepEqual(h.redo(), [[1, 1], [2, 2]]);
  h.undo();
  h.push([[1, 1], [3, 3]]);
  assert.equal(h.canRedo, false, 'a new edit clears redo');
  assert.equal(segmentKey([60.1, 25], [60.2, 25.5]), '60.100000,25.000000;60.200000,25.500000');
});

test('segments join into one line with distance and waypoint marks', () => {
  const line = joinSegments([
    { points: [[60, 25, 1], [60.001, 25, 2]] },
    { points: [[60.001, 25, 2], [60.002, 25, 3]] },
  ]);
  assert.equal(line.length, 3, 'the shared joint is not doubled');
  near(line[2].dist, 222.4, 0.5, 'distance');
  assert.deepEqual(line.map(p => p.wp), [0, 1, 2]);
});

test('kilometre markers at every whole km', () => {
  const m = kmMarkers(straight(3500));
  assert.deepEqual(m.map(x => x.km), [1, 2, 3]);
  near(m[0].lat, 60 + 1000 / M_PER_DEG, 1e-6, 'first marker');
});

test('climb and descent from the smoothed elevation', () => {
  // up 30 m over 600 m, then down 30 m over 600 m
  const cd = climbDescent(straight(1200, d => (d <= 600 ? d * 0.05 : 30 - (d - 600) * 0.05)));
  near(cd.climb, 30, 2, 'climb');
  near(cd.descent, 30, 2, 'descent');
});

test('hills: 20 m at ≥ 3 % counts, a gentle or short rise does not', () => {
  // flat 300 m, 400 m at 6 % (24 m), flat, then 200 m at 5 % (10 m, too little), then 1 km at 2 % (20 m, too gentle)
  const ele = d => d < 300 ? 0 : d < 700 ? (d - 300) * 0.06 : d < 1000 ? 24 : d < 1200 ? 24 + (d - 1000) * 0.05
    : d < 1300 ? 34 : d < 2300 ? 34 + (d - 1300) * 0.02 : 54;
  const hills = findHills(straight(2500, ele));
  assert.equal(hills.length, 1, JSON.stringify(hills.map(h => [h.startKm, h.gain, h.grade])));
  near(hills[0].gain, 24, 3, 'gain');
  near(hills[0].grade, 0.06, 0.012, 'grade');
  near(hills[0].startKm, 0.3, 0.05, 'starts at 0.3 km');
  assert.deepEqual(HILLS, { minGain: 20, minGrade: 0.03, maxGap: 50 });
});

test('grade colors: 5 steps from steep down to steep up', () => {
  assert.deepEqual([-0.1, -0.03, 0, 0.03, 0.1].map(gradeBucket), [0, 1, 2, 3, 4]);
  assert.equal(gradeBucket(null), null);
  const g = grades(straight(400, d => d * 0.04));
  near(g[20], 0.04, 0.001, 'grade in the middle');
});

test('Minetti pace factor: 1 on the flat, slower uphill, a little faster downhill, limited', () => {
  near(hillFactor(0), 1, 1e-9, 'flat');
  near(hillFactor(0.05), 1.30, 0.01, '+5 %');
  near(hillFactor(-0.05), 0.85, 1e-9, '−5 % is 0.76 by the formula, limited to 0.85');
  near(hillFactor(0.1), 1.66, 0.01, '+10 %');
  assert.equal(hillFactor(-0.4), 0.85, 'steep downhill is limited');
  assert.ok(hillFactor(0.5) <= 3);
});

test('time estimate: flat = distance × pace; a hill adds time', () => {
  near(timeEstimate(straight(5000), 360), 1800, 1, '5 km at 6:00/km');
  const hilly = timeEstimate(straight(5000, d => (d < 2500 ? d * 0.04 : 100 - (d - 2500) * 0.04)), 360);
  assert.ok(hilly > 1800, `up 100 m and down again is slower (${hilly})`);
  assert.equal(timeEstimate([], 360), null);
});

test('GPX 1.1 with elevation and an escaped name', () => {
  const gpx = toGpx(straight(20, () => 12.34), 'Loop <A & B>');
  assert.match(gpx, /<gpx version="1.1"/);
  assert.match(gpx, /<name>Loop &lt;A &amp; B&gt;<\/name>/);
  assert.match(gpx, /<trkpt lat="60\.000000" lon="25\.000000"><ele>12\.3<\/ele><\/trkpt>/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 3);
});

test('regression: a steep hill that runs straight into a gentle climb is still found', () => {
  // 400 m at 6 % (24 m), then 1 km at 2 %: measured low-to-top it would average 2.9 % and be lost
  const hills = findHills(straight(1600, d => (d < 400 ? d * 0.06 : 24 + (d - 400) * 0.02)));
  assert.equal(hills.length, 1);
  near(hills[0].gain, 24, 3, 'only the steep part');
  assert.ok(hills[0].grade >= 0.05, `grade ${hills[0].grade}`);
});
