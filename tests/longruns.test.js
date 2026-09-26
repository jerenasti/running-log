// Long run progression toward the marathon.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyLongRuns, plannedLongRuns, longRunOutlook, progressionLine, LONG_RUN } from '../js/longruns.js';
import { TODAY, day, iso, run } from './helpers.js';

test('weekly longest run, week distance and the long run share', () => {
  const acts = [run({ n: -5, km: 5 }), run({ n: -3, km: 7 }), run({ n: -1, km: 12 }),   // Mon 21 – Sun 27 Sep
                run({ n: -8, km: 10 }), { ...run({ n: -2, km: 40 }), type: 'cycling' }];
  const weeks = weeklyLongRuns(acts, day(-12), TODAY);
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks.map(w => w.longest), [10, 12]);
  assert.equal(weeks[1].weekKm, 24);
  assert.equal(weeks[1].share, 0.5);
  assert.equal(weeks[1].act.km, 12, 'cycling does not count');
});

test('an empty week has no share', () => {
  const [w] = weeklyLongRuns([], TODAY, TODAY);
  assert.equal(w.longest, 0);
  assert.equal(w.share, null);
});

test('planned long runs: from today on, "long" in the name, distance from the name', () => {
  const schedule = [
    { date: iso(1), title: 'W3 Sun Long Run - 12km Hilly Long Run (12km)' },
    { date: iso(3), title: 'W4 Tue Easy Run - 5km Easy Run (5km)' },
    { date: iso(-6), title: 'W2 Sat Long Run - 11km' },
    { date: iso(8), title: 'W4 Sun Long Run - 7.5km Long Run (7.5km)' },
  ];
  assert.deepEqual(plannedLongRuns(schedule, TODAY).map(p => p.km), [12, 7.5]);
});

test('outlook: current longest of the last 4 weeks, peak 3 weeks before the race, km per week needed', () => {
  const acts = [run({ n: -40, km: 20 }), run({ n: -20, km: 12 }), run({ n: -3, km: 11 })];
  const raceDay = day(7 * 23);   // peak is 20 weeks from today
  const o = longRunOutlook(acts, raceDay, TODAY);
  assert.equal(o.current, 12, 'the 20 km run is older than 4 weeks');
  assert.equal(o.weeksToPeak, 20);
  assert.equal(o.perWeek, (LONG_RUN.targetKm - 12) / 20);   // 1.0 km per week
  assert.equal(o.status, 'on-track');
});

test('outlook status: steep, reached, late', () => {
  const acts = km => [run({ n: -1, km })];
  assert.equal(longRunOutlook(acts(10), day(7 * 10), TODAY).status, 'steep', '22 km in 7 weeks is over 1.5 km a week');
  assert.equal(longRunOutlook(acts(31), day(7 * 10), TODAY).status, 'reached');
  assert.equal(longRunOutlook(acts(20), day(14), TODAY).status, 'late');
});

test('progression line runs from the current longest this week to the target at the peak', () => {
  const acts = [run({ n: -1, km: 12 })];
  const raceDay = day(7 * 23);
  const o = longRunOutlook(acts, raceDay, TODAY);
  const weeks = weeklyLongRuns(acts, day(-7), raceDay);
  const line = progressionLine(weeks, o, TODAY);
  assert.equal(line[0], null, 'last week: no line');
  assert.equal(line[1], 12, 'this week starts at the current longest run');
  // The last point is the Monday of the peak week, just before the peak day, so close to (and below) the target
  const last = line.filter(v => v !== null).at(-1);
  assert.ok(last <= LONG_RUN.targetKm && last > LONG_RUN.targetKm - 1, `ends at ${last}, about ${LONG_RUN.targetKm} km`);
  assert.ok(line.filter(v => v !== null).every((v, i, a) => i === 0 || v > a[i - 1]), 'rises every week');
  assert.equal(line.at(-1), null, 'no line after the peak');
});
