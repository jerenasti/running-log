// Nutrition: workout classification, race weeks, day types and meal picking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, plannedWorkouts, raceDetails, activeRace, raceDayType, dayType, grams, pickMeals, kcalPerKm, recoveryAdvice,
} from '../js/nutrition.js';
import { fmtGrams } from '../js/format.js';
import { TODAY, day, iso, run } from './helpers.js';

test('classification: long run > tempo/intervals > easy', () => {
  const c = (title, minutes, teLabel = null, type = 'running') => classify({ type, title, minutes, teLabel });
  assert.equal(c('W3 Sun Long Run - 12km', 60), 'long', '"long" in the name');
  assert.equal(c('Helsinki Running', 80), 'long', '75 minutes or more');
  assert.equal(c('W3 Sun Hilly Long Run', 70), 'long', 'long beats hills');
  assert.equal(c('W3 Thu Hills - Hill Repeats', 40), 'quality');
  assert.equal(c('W6 Time Trial - 5km', 40), 'quality');
  assert.equal(c('Helsinki Running', 40, 'VO2MAX'), 'quality', 'Garmin label');
  assert.equal(c('W3 Tue Easy Run', 40), 'easy');
  assert.equal(c('Evening walk', 100, null, 'walking'), 'easy', 'non-running is always easy');
});

test('planned workouts: distance from the name and estimated minutes', () => {
  const acts = [run({ km: 10, min: 60 })];   // usual pace 6:00 /km
  const [p] = plannedWorkouts([{ date: iso(1), title: 'W3 Sun Long Run - 12km Hilly Long Run (12km)', sport: 'running' }], acts);
  assert.equal(p.km, 12);
  assert.equal(p.minutes, 72);
  assert.equal(p.type, 'long');
  assert.equal(plannedWorkouts([{ date: iso(1), title: 'Strength', sport: 'strength' }], acts)[0].km, null);
});

test('race week: marathon opens 7 days before with two carb-loading days', () => {
  const r = raceDetails({ date: iso(5), name: 'Marathon', distance_km: 42.195 });
  assert.equal(r.long, true);
  assert.equal(r.windowDays, 7);
  assert.equal(raceDayType(r, day(5)), 'race');
  assert.equal(raceDayType(r, day(4)), 'carb-load');
  assert.equal(raceDayType(r, day(3)), 'carb-load');
  assert.equal(raceDayType(r, day(2)), null);
  assert.deepEqual(r.during.carbs, [60, 90]);
});

test('race week: short race opens 3 days before with one carb-rich day', () => {
  const r = raceDetails({ date: iso(2), name: '10 km', distance_km: 10 });
  assert.equal(r.windowDays, 3);
  assert.equal(raceDayType(r, day(1)), 'race-prep');
  assert.equal(raceDayType(r, day(0)), null);
  assert.equal(r.during.carbs, null);
});

test('active race: only inside its window, nearest first', () => {
  assert.equal(activeRace([{ date: iso(20), name: 'Far', distance_km: 42.2 }], TODAY), null);
  assert.equal(activeRace([{ date: iso(-1), name: 'Past', distance_km: 10 }], TODAY), null);
  const r = activeRace([{ date: iso(6), name: 'M', distance_km: 42.2 }, { date: iso(2), name: 'T', distance_km: 10 }], TODAY);
  assert.equal(r.name, 'T');
  assert.equal(r.daysLeft, 2);
});

test('day type priority: race > done > planned > rest', () => {
  const planned = [{ key: iso(1), type: 'long', title: 'Long Run' }];
  assert.equal(dayType(day(1), { acts: [], planned, race: null }).type, 'long');
  assert.equal(dayType(day(2), { acts: [], planned, race: null }).type, 'rest');
  const acts = [run({ n: 1, title: 'Intervals', min: 40 })];
  assert.equal(dayType(day(1), { acts, planned, race: null }).source, 'done', 'what was done beats the plan');
  const race = raceDetails({ date: iso(2), name: '10 km', distance_km: 10 });
  assert.equal(dayType(day(1), { acts, planned, race }).type, 'race-prep', 'race week beats everything');
});

test('grams = body weight × g/kg', () => {
  // Floating point: 3 × 89.4 is 268.20000000000005, so compare with a small tolerance
  const [lo, hi] = grams(89.4, [3, 5]);
  assert.ok(Math.abs(lo - 268.2) < 1e-9 && Math.abs(hi - 447) < 1e-9);
  assert.equal(grams(null, [3, 5]), null);
  assert.equal(recoveryAdvice('quality', 89.4, fmtGrams), 'Carbs 89 g (1 g/kg) and protein 27 g (0.3 g/kg). Within an hour after the session.');
});

test('Garmin calories per km of running (background information)', () => {
  const acts = [run({ n: -1, km: 10, kcal: 800 }), run({ n: -2, km: 5, kcal: 450 }), run({ n: -60, km: 10, kcal: 2000 })];
  assert.equal(kcalPerKm(acts, TODAY), (800 + 450) / 15, 'only the last 6 weeks');
});

test('meal picking: matching slot and day, same meals for the same day, fallback when nothing matches', () => {
  const meals = [
    { name: 'A', slot: 'dinner', days: ['long'] },
    { name: 'B', slot: 'dinner', days: ['long'] },
    { name: 'C', slot: 'dinner', days: ['rest'] },
    { name: 'D', slot: 'breakfast', days: ['easy'] },
  ];
  const long = pickMeals(meals, 'long', 'dinner', 2, '2026-09-27').map(m => m.name).sort();
  assert.deepEqual(long, ['A', 'B']);
  assert.deepEqual(pickMeals(meals, 'long', 'dinner', 1, 'x'), pickMeals(meals, 'long', 'dinner', 1, 'x'), 'deterministic');
  assert.equal(pickMeals(meals, 'rest', 'breakfast', 1, 'x')[0].name, 'D', 'rest falls back to easy');
  assert.deepEqual(pickMeals(meals, 'easy', 'snack', 1, 'x'), [], 'no snacks at all');
});
