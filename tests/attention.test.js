// Overview attention list: order, the 3 most important shown, data notes grouped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { organizeAttention, MAX_VISIBLE } from '../js/attention.js';

const item = (level, text, kind) => ({ level, text, ...(kind ? { kind } : {}) });

test('most important first, at most 3 visible, the rest hidden in order', () => {
  const r = organizeAttention([
    item('info', 'a'), item('watch', 'b'), item('warn', 'c'), item('info', 'd'), item('watch', 'e'),
  ]);
  assert.equal(MAX_VISIBLE, 3);
  assert.deepEqual(r.visible.map(i => i.text), ['c', 'b', 'e']);
  assert.deepEqual(r.hidden.map(i => i.text), ['a', 'd'], 'same level keeps the given order');
});

test('data notes become one "Data quality" item with the highest level', () => {
  const r = organizeAttention([
    item('info', 'Forecast is preliminary', 'data'), item('watch', 'Time trial had no laps', 'data'),
    item('info', 'Race week'),
  ]);
  const all = [...r.visible, ...r.hidden];
  assert.equal(all.length, 2);
  const dq = all.find(i => i.kind === 'data');
  assert.equal(dq.text, 'Data quality');
  assert.equal(dq.level, 'watch');
  assert.deepEqual(dq.notes, ['Forecast is preliminary', 'Time trial had no laps']);
  assert.equal(r.visible[0], dq, 'watch comes before info');
});

test('nothing to show', () => {
  assert.deepEqual(organizeAttention([]), { visible: [], hidden: [] });
});
