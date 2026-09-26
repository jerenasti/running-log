// Settings applied to the Garmin data, the easy run rule and the race list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySettings, easyRule, racesFromSettings } from '../js/settings.js';

const settings = (body = {}, plan = {}, goals = {}) => ({
  goals: { main_race: null, time_trials: [], weekly_km: 0, ...goals },
  plan: { source: 'garmin', easy_keywords: ['easy'], easy_max_hr: null, ...plan },
  body: { weight_source: 'garmin', weight_kg: null, max_hr_source: 'garmin', max_hr: null,
          resting_hr_source: 'garmin', resting_hr: null, ...body },
});
const meta = {
  hrSettings: { max_hr: 201, zone_floors: [98, 118, 137, 161, 181], method: 'HR_MAX' },
  weight: { kg: 89.4, date: '2026-09-12' },
  schedule: [{ date: '2026-09-27', title: 'Long run' }],
  restingHr: [{ date: '2026-09-26', bpm: 48 }],
};

test('Garmin values by default, each marked with its source', () => {
  const m = applySettings(meta, settings());
  assert.deepEqual(m.weight, { kg: 89.4, date: '2026-09-12', source: 'garmin' });
  assert.equal(m.hrSettings.source, 'garmin');
  assert.equal(m.hrSettings.max_hr, 201);
  assert.equal(m.schedule.length, 1);
  assert.equal(m.restingHrManual, null);
  assert.equal(meta.weight.source, undefined, 'the Garmin data itself is not changed');
});

test('manual weight, max HR and resting HR', () => {
  const m = applySettings(meta, settings({ weight_source: 'manual', weight_kg: 80, max_hr_source: 'manual', max_hr: 190,
    resting_hr_source: 'manual', resting_hr: 45 }));
  assert.deepEqual(m.weight, { kg: 80, date: null, source: 'manual' });
  assert.equal(m.hrSettings.max_hr, 190);
  assert.deepEqual(m.hrSettings.zone_floors, [93, 112, 130, 152, 171], 'Garmin zones scaled to the new max');
  assert.equal(m.restingHrManual, 45);
  assert.deepEqual(m.restingHr, meta.restingHr, 'daily resting HR stays for the Recovery checks');
});

test('manual max HR without Garmin zones uses 50–90% of max', () => {
  const m = applySettings({ ...meta, hrSettings: null }, settings({ max_hr_source: 'manual', max_hr: 200 }));
  assert.deepEqual(m.hrSettings.zone_floors, [100, 120, 140, 160, 180]);
});

test('a manual source without a value falls back to Garmin', () => {
  const m = applySettings(meta, settings({ weight_source: 'manual', weight_kg: null }));
  assert.equal(m.weight.source, 'garmin');
});

test('no training plan: scheduled workouts are ignored', () => {
  assert.deepEqual(applySettings(meta, settings({}, { source: 'none' })).schedule, []);
});

test('easy run rule: own HR limit first, else zone 4', () => {
  const m = applySettings(meta, settings());
  assert.deepEqual(easyRule(settings(), m), { words: ['easy'], hrLimit: 161, hrSource: 'zone 4' });
  assert.deepEqual(easyRule(settings({}, { easy_max_hr: 150 }), m), { words: ['easy'], hrLimit: 150, hrSource: 'settings' });
  assert.equal(easyRule(null, null).words, undefined, 'no settings: the default words');
});

test('race list: time trials and the main race in date order', () => {
  const main = { name: 'Marathon', date: '2027-05-15', distance_km: 42.195, goal: '3:30:00' };
  const tt = { name: '10 km test', date: '2026-10-10', distance_km: 10 };
  assert.deepEqual(racesFromSettings(settings({}, {}, { main_race: main, time_trials: [tt] })), [tt, main]);
  assert.deepEqual(racesFromSettings(null), []);
});
