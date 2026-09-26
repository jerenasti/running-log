// Number and date formatting: every number in the UI goes through these functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtKm, fmtInt, fmtPace, fmtDuration, fmtGrams, fmtSigned, fmtHClock, fmtHm, fmtRatio, fmtDay, fmtWeekday, DASH,
  setUnits, units, distLabel, paceLabel, distIn, distFromUnit, fmtKmWhole, fmtClock, KM_PER_MILE } from '../js/format.js';

test('km always has one decimal', () => {
  assert.equal(fmtKm(24.34), '24.3');
  assert.equal(fmtKm(5), '5.0');
  assert.equal(fmtKm(1234.5), '1,234.5');
  assert.equal(fmtKm(NaN), DASH);
});

test('pace is m:ss and never shows 60 seconds', () => {
  assert.equal(fmtPace(369), '6:09');
  assert.equal(fmtPace(359.6), '6:00');   // 5:59.6 rounds up to the next minute, not "5:60"
  assert.equal(fmtPace(0), DASH);
  assert.equal(fmtPace(Infinity), DASH);
});

test('durations', () => {
  assert.equal(fmtDuration(1570), '26:10');
  assert.equal(fmtDuration(14571), '4:02:51');
  assert.equal(fmtHClock(32220), '8:57');
  assert.equal(fmtHm(2220), '0 h 37 min');
});

test('grams: a range, or one value when both ends round the same', () => {
  assert.equal(fmtGrams([268.2, 447]), '268–447 g');
  assert.equal(fmtGrams([89.4, 89.4]), '89 g');
  assert.equal(fmtGrams(null), DASH);
});

test('signed numbers use a real minus sign', () => {
  assert.equal(fmtSigned(5.2), '+5');
  assert.equal(fmtSigned(-42), '−42');
  assert.equal(fmtSigned(0.3), '0');
});

test('other formats', () => {
  assert.equal(fmtInt(151.6), '152');
  assert.equal(fmtRatio(0.987), '0.99');
  assert.equal(fmtDay(new Date(2026, 8, 5)), '5 Sep');
  assert.equal(fmtWeekday(new Date(2026, 8, 26)), 'Sat 26 Sep');
});

test('miles: distances and paces are converted only for display', () => {
  try {
    setUnits('mi');
    assert.equal(units(), 'mi');
    assert.equal(distLabel(), 'mi');
    assert.equal(paceLabel(), '/mi');
    assert.equal(fmtKm(42.195), '26.2', 'a marathon is 26.2 miles');
    assert.equal(fmtKmWhole(32), '20');
    assert.equal(fmtPace(300), '8:03', '5:00 /km is 8:03 /mi');
    assert.ok(Math.abs(distFromUnit(distIn(42.195)) - 42.195) < 1e-9, 'round trip');
    assert.equal(fmtClock(483), '8:03', 'chart data already in the chosen unit');
  } finally {
    setUnits('km');
  }
  assert.equal(fmtKm(42.195), '42.2');
  assert.equal(fmtPace(300), '5:00');
  assert.equal(KM_PER_MILE, 1.609344);
  setUnits('furlongs');
  assert.equal(units(), 'km', 'anything else means km');
});
