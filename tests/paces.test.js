// Training paces: Daniels' paces from VDOT, and Runna's paces from workout descriptions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { danielsPaces, paceAtShare, vdotForPace, speedForVo2, runnaPaces, runnaVdot } from '../js/paces.js';
import { timeForVdot, MARATHON_M } from '../js/forecast.js';
import { iso } from './helpers.js';

const perMile = secPerKm => secPerKm * 1.609344;
const mmss = s => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };

test("Daniels' threshold and interval paces match the published table (per mile, within 2 s)", () => {
  const table = { 40: { threshold: '8:12', interval: '7:31' }, 45: { threshold: '7:27', interval: '6:50' }, 50: { threshold: '6:51', interval: '6:16' } };
  for (const [v, row] of Object.entries(table)) {
    const p = danielsPaces(+v);
    for (const kind of ['threshold', 'interval']) {
      const diff = Math.abs(perMile(p[kind][0]) - mmss(row[kind]));
      assert.ok(diff <= 2, `VDOT ${v} ${kind}: ${perMile(p[kind][0]).toFixed(1)} s vs ${row[kind]}`);
    }
  }
});

test("the table's single easy pace falls inside Daniels' easy range", () => {
  for (const [v, easy] of Object.entries({ 40: '9:50', 45: '8:57', 50: '8:14' })) {
    const [fast, slow] = danielsPaces(+v).easy.map(perMile);
    assert.ok(fast <= mmss(easy) && mmss(easy) <= slow, `VDOT ${v}`);
  }
});

test('marathon pace is the marathon race time per km; paces get faster from easy to repetition', () => {
  const p = danielsPaces(44.6);
  assert.ok(Math.abs(p.marathon[0] - timeForVdot(44.6, MARATHON_M) / 42.195) < 1e-9);
  assert.ok(p.easy[1] > p.easy[0] && p.easy[0] > p.marathon[0] && p.marathon[0] > p.threshold[0] &&
            p.threshold[0] > p.interval[0] && p.interval[0] > p.repetition[0]);
  assert.equal(danielsPaces(0), null);
});

test('speed and VDOT are inverses of the pace formulas', () => {
  const v = speedForVo2(45);
  assert.ok(Math.abs(-4.60 + 0.182258 * v + 0.000104 * v * v - 45) < 1e-9);
  assert.ok(Math.abs(vdotForPace(paceAtShare(42, 0.88), 0.88) - 42) < 1e-9);
});

const workout = (title, description) => ({ date: iso(1), title, description });

test('Runna paces: kind from the sentence, "no faster than" is a limit', () => {
  const p = runnaPaces([workout('W4 Tue Easy Run - 5km',
    'Run Further Plan (Week 4/13)\n\n5km easy run at a conversational pace (no faster than 5:40/km). This is a limit, not a target.')]);
  assert.equal(p.length, 1);
  assert.deepEqual({ kind: p[0].kind, sec: p[0].sec, limit: p[0].limit }, { kind: 'easy', sec: 340, limit: true });
});

test('Runna paces: a line without clues takes its kind from the workout name', () => {
  const p = runnaPaces([workout('W4 Fri Tempo - Progressive Run (5km)',
    '500m warm up at a conversational pace (no faster than 5:40/km)\n\n1.5km at 5:10/km\n1.5km at 4:50/km\n1.5km at 4:40/km, 90s walking rest')]);
  assert.deepEqual(p.map(x => `${x.kind}:${x.sec}:${x.limit}`), ['easy:340:true', 'threshold:310:false', 'threshold:290:false', 'threshold:280:false']);
});

test('Runna paces: no paces, no description', () => {
  assert.deepEqual(runnaPaces([workout('W3 Sun Long Run', '12km at a conversational pace'), { date: iso(2), title: 'x' }]), []);
});

test('VDOT implied by Runna paces: easy limit at 74%, tempo at 88%, averaged per kind', () => {
  const paces = [{ kind: 'easy', sec: 340 }, { kind: 'threshold', sec: 300 }, { kind: 'threshold', sec: 280 }, { kind: 'other', sec: 200 }];
  const v = runnaVdot(paces);
  assert.ok(Math.abs(v.easy - vdotForPace(340, 0.74)) < 1e-9);
  assert.ok(Math.abs(v.threshold - (vdotForPace(300, 0.88) + vdotForPace(280, 0.88)) / 2) < 1e-9);
  assert.equal(v.other, undefined);
});
