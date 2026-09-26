// Training load (Edwards TRIMP, CTL/ATL/TSB, ACWR) and easy-run efficiency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays } from '../js/dates.js';
import { edwardsTrimp, loadModel, acwr, acwrSeries, isEasyRun, efficiency, efficiencySeries, CTL_DAYS, ATL_DAYS, weeklyAverage } from '../js/metrics.js';
import { TODAY, run, zonesForLoad } from './helpers.js';

test('Edwards TRIMP: minutes in each zone × zone number', () => {
  assert.equal(edwardsTrimp({ zones: [600, 1200, 600, 0, 0] }), 10 * 1 + 20 * 2 + 10 * 3);
  assert.equal(edwardsTrimp({ zones: [0, 0, 0, 3600, 0] }), 240);   // an hour in zone 4
  assert.equal(edwardsTrimp({ zones: null }), null);
});

test('load model: one entry per day from the first activity to today', () => {
  const days = loadModel([run({ n: -9, zones: zonesForLoad(100) })], TODAY);
  assert.equal(days.length, 10);
  assert.equal(days[0].load, 100);
  assert.equal(days[1].load, 0);
});

test('CTL and ATL move 1/42 and 1/7 of the way toward each day\'s load', () => {
  const days = loadModel([run({ n: -1, zones: zonesForLoad(84) })], TODAY);
  assert.equal(days[0].ctl, 84 / CTL_DAYS);   // 2
  assert.equal(days[0].atl, 84 / ATL_DAYS);   // 12
});

test('form (TSB) is yesterday\'s CTL − ATL, so a hard day shows in tomorrow\'s form', () => {
  const days = loadModel([run({ n: -1, zones: zonesForLoad(84) })], TODAY);
  assert.equal(days[0].tsb, 0);                          // nothing before the first day
  assert.equal(days[1].tsb, days[0].ctl - days[0].atl);  // 2 − 12 = −10
});

test('regression: the load model has one entry per calendar day across the end of daylight saving time', () => {
  const acts = [{ ...run({ zones: zonesForLoad(60) }), date: new Date(2026, 9, 20, 7) },
                { ...run({ zones: zonesForLoad(90) }), date: new Date(2026, 9, 28, 7) }];
  const days = loadModel(acts, new Date(2026, 9, 30));
  const keys = days.map(d => dayKey(d.date));
  assert.equal(keys.length, 11);
  assert.equal(new Set(keys).size, 11, 'no day twice');
  assert.equal(keys[8], '2026-10-28');
  assert.equal(days[8].load, 90, 'the load lands on the right day after the clocks change');
});

test('steady training: CTL approaches the daily load', () => {
  const acts = Array.from({ length: 200 }, (_, i) => run({ n: -i, zones: zonesForLoad(60) }));
  const last = loadModel(acts, TODAY).at(-1);
  assert.ok(Math.abs(last.ctl - 60) < 1, `CTL ${last.ctl} should be close to 60`);
  assert.ok(Math.abs(last.atl - 60) < 0.01);
});

test('ACWR: needs 28 days, equals 1.0 for steady training, zones at 0.8 / 1.3 / 1.5', () => {
  const steady = n => Array.from({ length: n }, (_, i) => run({ n: -i, zones: zonesForLoad(60) }));
  assert.equal(acwr(loadModel(steady(20), TODAY)), null);
  const r = acwr(loadModel(steady(40), TODAY));
  assert.equal(r.ratio, 1);
  assert.equal(r.zone.key, 'ok');

  // Last 7 days at double load: acute 120, chronic (21 × 60 + 7 × 120) / 28 = 75 → 1.6
  const heavy = [...steady(40), ...Array.from({ length: 7 }, (_, i) => run({ n: -i, zones: zonesForLoad(60) }))];
  const h = acwr(loadModel(heavy, TODAY));
  assert.equal(h.ratio, 1.6);
  assert.equal(h.zone.key, 'warn');
});

test('ACWR series is null before 28 days of data', () => {
  const acts = Array.from({ length: 30 }, (_, i) => run({ n: -i, zones: zonesForLoad(60) }));
  const series = acwrSeries(loadModel(acts, TODAY), 5);
  assert.equal(series.length, 5);
  assert.equal(series[0].ratio, null);   // day 26
  assert.equal(series[4].ratio, 1);      // day 30
});

test('easy run rules from the settings: own words and heart rate limit', () => {
  const jog = run({ title: 'Morning jog (Z2)', min: 40, hr: 150 });
  assert.equal(isEasyRun(jog), false, 'default words');
  assert.equal(isEasyRun(jog, { words: ['jog'] }), true);
  assert.equal(isEasyRun(jog, { words: ['(z2)'] }), true, 'special characters are plain text');
  assert.equal(isEasyRun(jog, { words: ['jog'], hrLimit: 145 }), false, 'above the own limit');
  assert.equal(isEasyRun(run({ title: 'Kevyt lenkki', min: 40 })), true, 'Finnish default word');
  assert.equal(isEasyRun(jog, { words: [] }), false, 'no words: only Garmin labels count');
});

test('easy run rules', () => {
  const easy = run({ title: 'W3 Tue Easy Run', min: 40, hr: 135 });
  assert.equal(isEasyRun(easy, { hrLimit: 161 }), true);
  assert.equal(isEasyRun({ ...easy, sec: 29 * 60 }, { hrLimit: 161 }), false, 'under 30 minutes');
  assert.equal(isEasyRun({ ...easy, hr: NaN }, { hrLimit: 161 }), false, 'no heart rate');
  assert.equal(isEasyRun({ ...easy, hr: 161 }, { hrLimit: 161 }), false, 'average HR in zone 4');
  assert.equal(isEasyRun({ ...easy, title: 'W3 Wed Tempo - Easy Run finish' }, { hrLimit: 161 }), false, 'hard word wins');
  assert.equal(isEasyRun({ ...easy, title: 'W6 Time Trial - 5km' }, { hrLimit: 161 }), false, 'time trial is not easy');
  assert.equal(isEasyRun({ ...easy, title: 'Helsinki Running' }, { hrLimit: 161 }), false, 'no easy word or label');
  assert.equal(isEasyRun({ ...easy, title: 'Helsinki Running', teLabel: 'AEROBIC_BASE' }, { hrLimit: 161 }), true, 'Garmin label counts');
  assert.equal(isEasyRun({ ...easy, type: 'cycling' }, { hrLimit: 161 }), false, 'runs only');
});

test('aerobic efficiency = metres per minute ÷ average HR, with a 5-run average', () => {
  // 6:00 /km = 166.7 m/min at 140 bpm
  assert.ok(Math.abs(efficiency(run({ km: 10, min: 60, hr: 140 })) - 166.67 / 140) < 0.001);
  const runs = [1, 2, 3, 4, 5, 6].map(i => run({ n: -i * 2, km: 8, min: 48, hr: 150 - i }));
  const series = efficiencySeries(runs.reverse(), { hrLimit: 161 });
  assert.equal(series.length, 6);
  assert.equal(series[0].avg, series[0].ef);   // first run: average of one
  const last5 = series.slice(-5).reduce((s, r) => s + r.ef, 0) / 5;
  assert.ok(Math.abs(series[5].avg - last5) < 1e-12);
});

test('weekly average: only finished weeks from the start of the data, rest weeks count as 0', () => {
  // TODAY is Saturday 26 Sep 2026. Weeks (Mondays): 31 Aug, 7 Sep, 14 Sep, 21 Sep (in progress)
  const mon = n => addDays(new Date(2026, 8, 21), -7 * n);
  const weeks = [
    { mon: mon(5), km: 0 }, { mon: mon(4), km: 0 },          // before the data starts
    { mon: mon(3), km: 30 }, { mon: mon(2), km: 0 }, { mon: mon(1), km: 36 },
    { mon: mon(0), km: 10 },                                 // this week, not finished
  ];
  const r = weeklyAverage(weeks, new Date(2026, 8, 2, 7, 30), TODAY);   // first activity on Wed 2 Sep
  assert.deepEqual(r, { km: 22, weeks: 3 });
  assert.deepEqual(weeklyAverage([{ mon: mon(0), km: 10 }], new Date(2026, 8, 22), TODAY), { km: null, weeks: 0 });
  assert.deepEqual(weeklyAverage(weeks, null, TODAY), { km: null, weeks: 0 });
});
