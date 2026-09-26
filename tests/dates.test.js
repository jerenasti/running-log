// Date parsing and calendar helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate } from '../js/parse.js';
import { mondayOf, isoWeek, dayKey, startOfDay } from '../js/dates.js';

test('parseDate reads Garmin date formats as local time', () => {
  assert.deepEqual(parseDate('2026-09-25 18:05:16'), new Date(2026, 8, 25, 18, 5, 16));
  assert.deepEqual(parseDate('2026-09-25T22:34:01'), new Date(2026, 8, 25, 22, 34, 1));
  assert.deepEqual(parseDate('2026-09-25'), new Date(2026, 8, 25));
  assert.equal(parseDate('25.9.2026'), null);   // only Garmin's ISO format is supported now
  assert.equal(parseDate(''), null);
});

test('weeks start on Monday', () => {
  assert.deepEqual(mondayOf(new Date(2026, 8, 26)), new Date(2026, 8, 21));   // Saturday → Monday
  assert.deepEqual(mondayOf(new Date(2026, 8, 27)), new Date(2026, 8, 21));   // Sunday belongs to the same week
  assert.deepEqual(mondayOf(new Date(2026, 8, 21, 7)), new Date(2026, 8, 21));
});

test('ISO week numbers, including around New Year', () => {
  assert.equal(isoWeek(new Date(2026, 8, 25)), 39);
  assert.equal(isoWeek(new Date(2027, 0, 1)), 53);   // Friday 1 Jan 2027 belongs to week 53 of 2026
  assert.equal(isoWeek(new Date(2027, 0, 4)), 1);
});

test('day keys and start of day', () => {
  assert.equal(dayKey(new Date(2026, 8, 5, 23, 59)), '2026-09-05');
  assert.deepEqual(startOfDay(new Date(2026, 8, 5, 23, 59)), new Date(2026, 8, 5));
});
