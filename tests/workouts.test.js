// Workout names and kinds for display. The names are real Garmin/Runna names (places changed only where noted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, workoutKind, describeWorkout, describePlanned, planTitles } from '../js/workouts.js';

const act = (title, extra = {}) => ({ title, type: 'running', sec: 40 * 60, teLabel: null, ...extra });
const show = (title, extra, plan) => { const d = describeWorkout(act(title, extra), plan); return `${d.label} · ${d.name}`; };

test('the place prefix goes, the Runna week and day too', () => {
  assert.equal(show('Helsinki - W1 Mon Intervals - 400m Repeats'), 'Intervals · 400m Repeats');
  assert.equal(show('Helsinki - W3 Wed Tempo - Tempo 2-1-1 (7km)'), 'Tempo · Tempo 2-1-1');
  assert.equal(show('Sundbyberg - W1 Wed Easy Run - 5.5km Easy Run'), 'Easy · Easy Run');
});

test('names Garmin cut short: no broken words or brackets', () => {
  assert.equal(show('Helsinki - W2 Sat Long Run - 11km Progressi'), 'Long · Long Run');
  assert.equal(show('Helsinki - W2 Sun Easy Run #2 - 5km Easy Ru'), 'Easy · Easy Run');
  assert.equal(show('Helsinki - W4 Fri Tempo - Progressive Run ('), 'Tempo · Progressive Run', 'cut inside the bracket: the words are whole');
  assert.equal(show('Helsinki - W2 Fri Tempo - Rolling 300s (5km'), 'Tempo · Rolling 300s');
  assert.equal(show('Tampere - W2 Tue Long Run - 6.5km Hilly Pr'), 'Long · Long Run');
});

test('the whole name from the plan replaces a cut one', () => {
  assert.equal(show('Helsinki - W4 Fri Tempo - Progressive Run (', {}, 'W4 Fri Tempo - Progressive Run (5km)'), 'Tempo · Progressive Run');
  assert.equal(show('Helsinki - W2 Sat Long Run - 11km Progressi', {}, 'W2 Sat Long Run - 11km Progression Run (11km)'), 'Long · Progression Run');
});

test('Garmin default names: the sport, without the place', () => {
  assert.deepEqual(describeWorkout({ title: 'Tampere Cycling', type: 'cycling', sec: 3600 }), { name: 'Cycling', kind: null, label: null, repeatsKind: false });
  assert.equal(describeWorkout({ title: 'Helsinki Walking', type: 'walking', sec: 1800 }).name, 'Walking');
  assert.equal(show('Helsinki Running'), 'Run · Running');
  assert.equal(show('Helsinki Running', { teLabel: 'AEROBIC_BASE' }), 'Easy · Running');
  assert.equal(show('Helsinki Running', { sec: 80 * 60 }), 'Long · Running', '75 minutes or more');
  assert.equal(describeWorkout({ title: 'Jumppa', type: 'mobility', sec: 1200 }).name, 'Jumppa');
});

test('own names are kept, only tidied', () => {
  assert.equal(show('5.5 km easy run'), 'Easy · Easy run');
  assert.equal(show('Aika-ajo 5 km'), 'Time trial · Aika-ajo');
  assert.equal(cleanName('Tempo - Progressive').name, 'Tempo - Progressive', 'a dash inside an own name stays');
});

test('kind: Runna type first, then words, Garmin label, length', () => {
  assert.equal(workoutKind({ type: 'running', title: 'x', minutes: 40 }, 'Hills'), 'intervals');
  assert.equal(workoutKind({ type: 'running', title: 'Evening', minutes: 40, teLabel: 'TEMPO' }), 'tempo');
  assert.equal(workoutKind({ type: 'cycling', title: 'Long ride', minutes: 200 }), null, 'only runs have a kind');
});

test('planned workouts and the plan lookup', () => {
  assert.deepEqual(describePlanned({ title: 'W3 Sun Long Run - 12km Hilly Long Run (12km)', sport: 'running' }), { name: 'Hilly Long Run', kind: 'long', label: 'Long', repeatsKind: false });
  assert.deepEqual(describePlanned({ title: 'W3 Thu Hills - Hill Repeats (5.6km)', sport: 'running' }), { name: 'Hill Repeats', kind: 'intervals', label: 'Intervals', repeatsKind: false });
  assert.equal(planTitles([{ workout_id: 7, title: 'W1' }, { title: 'no id' }]).get(7), 'W1');
});

test('a name that only repeats the kind is marked, so lists show just the badge', () => {
  const r = (title, extra) => describeWorkout(act(title, extra)).repeatsKind;
  assert.equal(r('Helsinki - W3 Tue Easy Run - 5.5km Easy Run'), true);
  assert.equal(r('Helsinki - W2 Sat Long Run - 11km Progressi'), true);
  assert.equal(r('Helsinki Running', { teLabel: 'AEROBIC_BASE' }), true);
  assert.equal(r('Helsinki - W1 Mon Intervals - 400m Repeats'), false);
  assert.equal(describeWorkout({ title: 'Jumppa', type: 'mobility', sec: 60 }).repeatsKind, false, 'no badge, the name stays');
});
