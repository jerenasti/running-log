// Recovery checks and the daily recommendation (rest / easy / hard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, meanSd, restingHrTrend, RULES } from '../js/recovery.js';
import { TODAY, run, iso, zonesForLoad } from './helpers.js';

test('mean and standard deviation, with a minimum count', () => {
  const r = meanSd([48, 50, 48, 50], 2);
  assert.equal(r.mean, 49);
  assert.equal(r.sd, 1);
  assert.equal(meanSd([48, 50], 14), null);
});

// 40 days of training alternating 60 and 120 load (so fatigue has a normal range),
// resting HR alternating 48/50 (normal 48–50), and a good night last night (day -1).
function scenario({ hrv = 75, rhr = 49, score = 80, sleepH = 8, bb = 90, extraLoad = 0 } = {}) {
  const acts = Array.from({ length: 40 }, (_, i) => run({ n: -i - 1, zones: zonesForLoad(i % 2 ? 60 : 120) }));
  for (let i = 1; i <= 7 && extraLoad; i++) acts.push(run({ n: -i, zones: zonesForLoad(extraLoad) }));
  acts.sort((a, b) => a.date - b.date);
  const restingHr = Array.from({ length: 40 }, (_, i) => ({ date: iso(-40 + i), bpm: i % 2 ? 48 : 50 }));
  restingHr.push({ date: iso(-1), bpm: rhr });
  const meta = {
    restingHr,
    recovery: {
      hrv: [{ date: iso(-1), last_night: hrv, weekly_avg: 72, status: 'BALANCED', baseline_low: 55, baseline_high: 90 }],
      sleep: [{ date: iso(-1), duration_s: sleepH * 3600, score, quality: 'GOOD' }],
      body_battery: [{ date: iso(-1), high: bb, low: 20 }],
    },
  };
  return assess(acts, meta, TODAY);
}
const flags = a => [...a.recoveryChecks, ...a.loadChecks].filter(c => c.met).map(c => c.id).sort();

test('all good → hard training OK', () => {
  const a = scenario();
  assert.equal(a.recommendation.key, 'hard');
  assert.deepEqual(flags(a), []);
  assert.equal(a.day, iso(-1), 'uses the latest night with data');
});

test('one recovery signal → easy day', () => {
  assert.equal(scenario({ hrv: 40 }).recommendation.key, 'easy');
  assert.equal(scenario({ rhr: 60 }).recommendation.key, 'easy');
  assert.equal(scenario({ score: 50 }).recommendation.key, 'easy');
  assert.equal(scenario({ sleepH: 5 }).recommendation.key, 'easy');
  assert.equal(scenario({ bb: 30 }).recommendation.key, 'easy');
});

test('low HRV and high resting HR together → rest day', () => {
  const a = scenario({ hrv: 40, rhr: 60 });
  assert.equal(a.recommendation.key, 'rest');
  assert.deepEqual(flags(a), ['hrv', 'rhr']);
});

test('high load alone → easy day; high load with low HRV → rest day and attention', () => {
  const heavy = scenario({ extraLoad: 150 });
  assert.equal(heavy.loadHigh, true);
  assert.equal(heavy.recommendation.key, 'easy');
  assert.equal(heavy.attention, false);

  const both = scenario({ extraLoad: 150, hrv: 40 });
  assert.equal(both.attention, true);
  assert.equal(both.recommendation.key, 'rest');
});

test('regression: a missing sleep score is not "poor sleep" (null < 60 is true in JavaScript)', () => {
  const a = scenario({ score: null });
  const sleep = a.recoveryChecks.find(c => c.id === 'sleep');
  assert.equal(sleep.met, false);
  assert.equal(a.recommendation.key, 'hard');
});

test('no HRV and no resting HR → not enough data', () => {
  const a = assess([], { restingHr: [], recovery: { hrv: [], sleep: [{ date: iso(-1), duration_s: 8 * 3600, score: 80 }], body_battery: [] } }, TODAY);
  assert.equal(a.recommendation.key, 'unknown');
});

test('resting HR normal range uses only the 28 days before each date', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ date: iso(-29 + i), bpm: i < 29 ? 50 : 70 }));
  const trend = restingHrTrend(list, 30);
  assert.equal(trend[0].normal, null, 'no earlier days');
  assert.equal(trend.at(-1).normal.mean, 50, 'today\'s 70 is not part of its own normal range');
  assert.equal(RULES.normalDays, 28);
});
