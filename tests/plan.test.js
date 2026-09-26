// Training plan follow-up and the weekly review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planItems, plannedDayFromName, weekReview } from '../js/plan.js';
import { TODAY, day, iso, run, zonesForLoad } from './helpers.js';

// TODAY is Saturday 26 Sep 2026; its week runs Mon 21 – Sun 27 Sep.
const MONDAY = day(-5, 0);
const planned = (n, id, title = 'Workout') => ({ date: iso(n), title, sport: 'running', workout_id: id });
const done = (n, id, title = 'Workout', km = 6) => ({ ...run({ n, title, km }), workoutId: id });
const status = items => items.map(i => `${i.title}:${i.status}`);

test('planned day from a Runna name, in the same week', () => {
  assert.equal(iso(-4), '2026-09-22');
  assert.deepEqual(plannedDayFromName('Helsinki - W3 Tue Easy Run', day(-5)), day(-4, 0));   // done Mon, planned Tue
  assert.deepEqual(plannedDayFromName('W4 Sun Long Run', day(-5)), day(1, 0));
  assert.equal(plannedDayFromName('Helsinki Running', day(-5)), null);
});

test('status: done on the day, moved, missed, today, upcoming', () => {
  const schedule = [planned(-4, 1, 'A'), planned(-3, 2, 'B'), planned(-2, 3, 'C'), planned(0, 4, 'D'), planned(1, 5, 'E')];
  const acts = [done(-4, 1, 'A'), done(-1, 2, 'B')];
  assert.deepEqual(status(planItems(schedule, acts, TODAY)), ['A:done', 'B:moved', 'C:missed', 'D:today', 'E:upcoming']);
});

test('a run done more than a week away from the plan does not count for it', () => {
  const items = planItems([planned(-2, 1, 'A')], [done(-12, 1, 'A')], TODAY);
  assert.equal(items.find(i => i.title === 'A' && !i.inferred).status, 'missed');
});

test('before the plan history: Runna-named runs are plan workouts, others are extra', () => {
  const acts = [
    done(-5, 99, 'Helsinki - W3 Tue Easy Run'),      // has a workout id, planned Tue, done Mon → moved
    run({ n: -2, title: 'W3 Thu Tempo' }),             // name only, done on the planned Thursday (day -2 = Thu 24 Sep)
    run({ n: -2, title: 'Helsinki Running' }),          // not in the plan
    { ...run({ n: -2, title: 'Evening walk' }), type: 'walking' },   // not a run: ignored
  ];
  const items = planItems([], acts, TODAY);
  assert.deepEqual(status(items), ['Helsinki - W3 Tue Easy Run:moved', 'W3 Thu Tempo:done', 'Helsinki Running:extra']);
  assert.ok(items[0].inferred && items[1].inferred && !items[2].inferred);
});

test('weekly review: plan counts and highlights', () => {
  const schedule = [planned(-4, 1, 'Easy'), planned(-2, 2, 'Tempo'), planned(1, 3, 'Long')];
  const acts = [done(-4, 1, 'Easy'), run({ n: -3, title: 'Extra jog', km: 4 })];
  const r = weekReview(TODAY, { acts, schedule, meta: {}, today: TODAY });
  assert.deepEqual(r.monday, MONDAY);
  assert.equal(r.inProgress, true);
  assert.deepEqual({ planned: r.plan.planned, done: r.plan.done, missed: r.plan.missed, remaining: r.plan.remaining, extra: r.plan.extra },
    { planned: 3, done: 1, missed: 1, remaining: 1, extra: 1 });
  assert.equal(r.highlights[0].level, 'watch');
  assert.match(r.highlights[0].text, /1 of 3 planned sessions done, 1 still to come\. Missed: Tempo\./);
});

test('weekly review: volume vs the week before, with the 10% guideline', () => {
  // Last complete week (14–20 Sep) 33 km vs the week before (7–13 Sep) 30 km: +10% is fine, +20% is not
  const week = (startN, kms) => kms.map((km, i) => run({ n: startN + i * 2, km }));
  const acts = [...week(-19, [10, 10, 10]), ...week(-12, [12, 12, 12])];
  const r = weekReview(day(-10), { acts, schedule: [], meta: {}, today: TODAY });
  assert.equal(r.inProgress, false);
  assert.equal(r.cur.km, 36);
  assert.equal(r.prev.km, 30);
  const distance = r.highlights.find(h => h.text.startsWith('Distance'));
  assert.equal(distance.text, 'Distance up 20% from the week before, more than the common 10% guideline.');
  assert.equal(distance.level, 'watch');
});

test('weekly review: recovery averages and load', () => {
  const meta = {
    recovery: { hrv: [{ date: iso(-4), last_night: 80 }, { date: iso(-3), last_night: 70 }, { date: iso(-10), last_night: 90 }], sleep: [] },
    restingHr: [{ date: iso(-4), bpm: 46 }, { date: iso(-3), bpm: 48 }],
    vo2max: [{ date: iso(-8), vo2max: 49.0 }, { date: iso(-2), vo2max: 49.7 }],
  };
  const acts = Array.from({ length: 35 }, (_, i) => run({ n: -i, zones: zonesForLoad(60) }));
  const r = weekReview(TODAY, { acts, schedule: [], meta, today: TODAY });
  assert.equal(r.cur.hrv, 75);
  assert.equal(r.prev.hrv, 90);
  assert.equal(r.cur.rhr, 47);
  assert.equal(r.load.acwr, 1);
  assert.ok(r.load.ctlEnd > r.load.ctlStart, 'fitness grows during steady training');
  assert.ok(Math.abs(r.forecast.vo2End - r.forecast.vo2Start - 0.7) < 1e-9);
  assert.ok(r.highlights.some(h => h.text === 'Average HRV down 15 ms from the same point last week.' && h.level === 'watch'));
});

test('weekly review: a week in progress is compared with the same point of last week', () => {
  // Today is Saturday. Last week: Mon–Sat 30 km + Sunday long run 20 km. This week so far: 27 km.
  const acts = [
    run({ n: -12, km: 10 }), run({ n: -10, km: 10 }), run({ n: -7, km: 10 }), run({ n: -6, km: 20 }),
    run({ n: -5, km: 9 }), run({ n: -3, km: 9 }), run({ n: 0, km: 9 }),
  ];
  const r = weekReview(TODAY, { acts, schedule: [], meta: {}, today: TODAY });
  assert.equal(r.cur.km, 27);
  assert.equal(r.prev.km, 30, 'Sunday of last week is not yet comparable');
  assert.equal(r.prevWhole.km, 50);
  const distance = r.highlights.find(h => h.text.startsWith('Distance'));
  assert.equal(distance.text, 'Distance so far down 10% from the same point last week.');
  assert.equal(distance.level, 'info');
});
