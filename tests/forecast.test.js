// Forecasts: Daniels' VDOT formula, the VO2max model, time trials and calibration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vdot, timeForVdot, parseTime, vo2Forecast, marathonForecast, nominalDistance, trialEffort, timeTrials, raceResults, calibration, chooseCalibration, goalStatus, forecastSources, MARATHON_M, MODEL,
} from '../js/forecast.js';
import { TODAY, day, iso, run } from './helpers.js';

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

test("Daniels' formula matches the published VDOT table (marathon, within 15 s)", () => {
  const table = { 40: '3:49:45', 45: '3:28:26', 50: '3:10:49', 55: '2:56:01', 60: '2:43:25' };
  for (const [v, time] of Object.entries(table)) near(timeForVdot(+v), parseTime(time), 15, `VDOT ${v}`);
  near(vdot(10000, parseTime('50:03')), 40, 0.05, '10 km in 50:03');
});

test('VDOT and race time are inverses; 3:30 marathon needs VDOT 44.6', () => {
  near(vdot(MARATHON_M, timeForVdot(47.3)), 47.3, 1e-6, 'round trip');
  near(vdot(MARATHON_M, parseTime('3:30:00')), 44.6, 0.05, 'goal');
  assert.ok(timeForVdot(55) < timeForVdot(50), 'higher VDOT is faster');
  assert.ok(Number.isNaN(timeForVdot(0)));
});

test('parseTime', () => {
  assert.equal(parseTime('3:30:00'), 12600);
  assert.equal(parseTime('47:10'), 2830);
  assert.ok(Number.isNaN(parseTime('abc')));
});

// Synthetic VO2max history that follows the model exactly: 45 + 10·(1 − e^(−t/90))
const truth = t => 45 + 10 * (1 - Math.exp(-t / 90));
const history = days => Array.from({ length: days / 2 }, (_, i) => ({ date: iso(-days + i * 2), vo2max: truth(i * 2) }));

test('VO2max model recovers a known curve and slows down toward the plateau', () => {
  const fc = vo2Forecast(history(40), day(200));
  assert.equal(fc.tau, MODEL.tauDefault, 'under 8 weeks τ is the default');
  assert.equal(fc.preliminary, true);
  near(fc.plateau, 55, 0.01, 'plateau');
  const last = fc.series.at(-1);
  near(last.mid, truth(fc.series.length - 1), 0.01, 'race day value');
  assert.ok(last.mid < 55, 'never above the plateau');
});

test('the uncertainty band widens further ahead', () => {
  const fc = vo2Forecast(history(40), day(200));
  const width = i => fc.series[i].hi - fc.series[i].lo;
  assert.ok(width(60) < width(120));
  assert.ok(width(120) < width(fc.series.length - 1));
  for (const p of fc.series) assert.ok(p.lo <= p.mid && p.mid <= p.hi);
});

test('with 8 weeks or more, τ is chosen from the data', () => {
  const fc = vo2Forecast(history(80), day(100));
  assert.equal(fc.preliminary, false);
  assert.equal(fc.tau, 90, 'finds the τ the data was made with');
});

test('backtest hides the last 2 weeks; a perfect curve is forecast almost perfectly', () => {
  const bt = vo2Forecast(history(40), day(100)).backtest;
  assert.equal(bt.n, 7);
  assert.ok(bt.mae < 0.01, `mae ${bt.mae}`);
  assert.equal(bt.inside, 7);
});

test('too little data → no forecast', () => {
  assert.equal(vo2Forecast(history(8), day(100)), null);
});

test('marathon forecast: a faster time comes from the upper VO2max edge', () => {
  const [p] = marathonForecast({ series: [{ date: TODAY, mid: 50, lo: 48, hi: 52 }] });
  assert.ok(p.fast < p.mid && p.mid < p.slow);
  near(p.mid, timeForVdot(50), 1e-9, 'uncalibrated mid');
  const [c] = marathonForecast({ series: [{ date: TODAY, mid: 50, lo: 48, hi: 52 }] }, 0.9);
  near(c.mid, timeForVdot(45), 1e-9, 'calibrated with factor 0.9');
});

test('distance in a workout name', () => {
  assert.equal(nominalDistance('W6 Time Trial - 5km'), 5000);
  assert.equal(nominalDistance('3 k TT'), 3000);
  assert.equal(nominalDistance('Aika-ajo 10,5 km'), 10500);
  assert.equal(nominalDistance('Fitness Test - 1 mile'), 1609);
  assert.equal(nominalDistance('Time trial 20 min'), null, '"min" is not miles');
});

const lap = (m, s, intensity, step) => ({ distance_m: m, duration_s: s, intensity, step });

test('time trial: laps of one workout step are added up, warm-up and cool-down skipped', () => {
  const a = run({ title: 'W6 Sat Time Trial - 5km', km: 8.2, min: 46, laps: [
    lap(1500, 600, 'WARMUP', 0), ...[270, 268, 272, 266, 264].map(s => lap(1000, s, 'ACTIVE', 1)), lap(1700, 800, 'COOLDOWN', 2)] });
  const e = trialEffort(a);
  assert.equal(e.distance_m, 5000);
  assert.equal(e.sec, 1340);
  assert.equal(e.source, 'workout step');
});

test('time trial: the step matching the distance in the name wins over a longer one', () => {
  const a = run({ title: 'TT 3km', km: 9, min: 50, laps: [lap(4000, 1500, 'ACTIVE', 0), lap(3000, 720, 'ACTIVE', 1), lap(2000, 900, 'COOLDOWN', 2)] });
  assert.equal(trialEffort(a).distance_m, 3000);
});

test('time trial without laps uses the whole activity and says so', () => {
  const e = trialEffort(run({ title: '5km TT', km: 5, min: 23 }));
  assert.equal(e.source, 'whole activity');
  assert.equal(e.distance_m, 5000);
});

test('only runs with a time trial word count', () => {
  const acts = [
    run({ title: 'W6 Time Trial - 5km', km: 5, min: 23 }),
    run({ title: 'Attempt at a long run', km: 20, min: 130 }),
    run({ title: 'W3 Tue Easy Run', km: 5, min: 30 }),
    { ...run({ title: 'Bike test', km: 20, min: 40 }), type: 'cycling' },
  ];
  assert.deepEqual(timeTrials(acts).map(e => e.name), ['W6 Time Trial - 5km']);
});

test('calibration: effort VDOT ÷ VO2max on that day, averaged', () => {
  const efforts = [
    { date: day(-10), distance_m: 5000, sec: 1340, vdot: 44 },
    { date: day(-3), distance_m: 10000, sec: 2900, vdot: 45 },
  ];
  const vo2 = [{ date: iso(-20), vo2max: 50 }, { date: iso(-5), vo2max: 50 }];
  const cal = calibration(efforts, vo2);
  near(cal.factor, (44 / 50 + 45 / 50) / 2, 1e-12, 'factor');
  assert.equal(calibration([], vo2).factor, 1, 'no efforts → uncalibrated');
  assert.equal(calibration([{ date: day(-30), vdot: 40 }], vo2).results.length, 0, 'no VO2max before the effort');
});

test('calibration choice: efforts first, then Runna paces, then none', () => {
  const vo2 = [{ date: iso(-20), vo2max: 48 }, { date: iso(-2), vo2max: 50 }];
  const effort = { date: day(-10), distance_m: 5000, sec: 1340, vdot: 44 };
  const withEffort = chooseCalibration([effort], 42, vo2);
  assert.equal(withEffort.source, 'efforts');
  near(withEffort.factor, 44 / 48, 1e-12, 'effort factor uses VO2max on the effort day');
  const withRunna = chooseCalibration([], 42, vo2);
  assert.equal(withRunna.source, 'runna');
  near(withRunna.factor, 42 / 50, 1e-12, 'Runna factor uses the latest VO2max');
  assert.deepEqual(chooseCalibration([], null, vo2), { factor: 1, results: [], source: null });
});

test('goal status: on track only when even the slow end reaches the goal', () => {
  const goal = parseTime('3:30:00');
  assert.equal(goalStatus(goal, { mid: parseTime('3:15:00'), fast: parseTime('3:05:00'), slow: parseTime('3:28:00') }), 'on-track');
  assert.equal(goalStatus(goal, { mid: parseTime('3:15:00'), fast: parseTime('3:05:00'), slow: parseTime('3:32:00') }), 'possible');
  assert.equal(goalStatus(goal, { mid: parseTime('3:35:00'), fast: parseTime('3:25:00'), slow: parseTime('3:45:00') }), 'behind');
  assert.equal(goalStatus(NaN, { mid: 1 }), null);
});

test('forecast sources: main first, calibrated; today and race day for each source', () => {
  const rows = forecastSources({ vo2Today: 50, race: { mid: 55, lo: 52, hi: 58 }, factor: 0.84, runnaVdot: 42, garminSec: parseTime('4:02:51') });
  assert.deepEqual(rows.map(r => r.key), ['main', 'runna', 'garmin', 'vo2max']);
  near(rows[0].vdotToday, 42, 1e-9, 'main today = VO2max × factor');
  near(rows[0].race.mid, timeForVdot(55 * 0.84), 1e-9, 'main race day uses the calibrated VDOT');
  assert.ok(rows[0].race.fast < rows[0].race.mid && rows[0].race.mid < rows[0].race.slow);
  assert.equal(rows[1].race, null, 'Runna and Garmin describe today only');
  near(rows[2].vdotToday, vdot(MARATHON_M, parseTime('4:02:51')), 1e-9, 'Garmin prediction as VDOT');
  near(rows[3].race.mid, timeForVdot(55), 1e-9, 'raw VO2max is uncalibrated');
  assert.deepEqual(forecastSources({ vo2Today: 50, race: { mid: 55, lo: 52, hi: 58 } }).map(r => r.key), ['main', 'vo2max']);
});

test('race results from races.json: only past races with a result', () => {
  const r = raceResults([
    { date: iso(-7), name: '10 km', distance_km: 10, result: '0:50:03' },
    { date: iso(-7), name: 'No result', distance_km: 10 },
    { date: iso(7), name: 'Future', distance_km: 10, result: '0:45:00' },
  ], TODAY);
  assert.deepEqual(r.map(x => x.name), ['10 km']);
  near(r[0].vdot, 40, 0.05, 'VDOT');
});
