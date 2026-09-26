// Training plan follow-up (Runna plan in the Garmin calendar) and the weekly review.
// Pure calculations, no DOM code (the Training tab draws them).
//
// Matching: a scheduled workout and the activity that followed it share the same Garmin workout id.
// Garmin's calendar only keeps the days around today, so fetch_garmin.py saves the plan history;
// before that history starts, Runna workouts are recognised from their name ("W3 Tue Easy Run").

import { mondayOf, startOfDay, dayKey, addDays, daysBetween, DAY_MS } from './dates.js';
import { parseDate } from './parse.js';
import { loadModel, acwr, edwardsTrimp } from './metrics.js';

const isRun = a => /run|juoks|treadmill|trail/i.test(a.type || '');
const WEEKDAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };  // days after Monday
const RUNNA_NAME = /\bW\d+\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i;
const MATCH_DAYS = 7;              // an activity counts for a planned workout if done within a week of it
export const VOLUME_JUMP = 0.10;   // weekly distance up more than 10% → worth a note

const sameDay = (a, b) => dayKey(a) === dayKey(b);
const avg = list => { const v = list.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

/** The planned day written in a Runna-style name ("W3 Tue Easy Run"), in the same week as `date`; null if none */
export function plannedDayFromName(name, date) {
  const m = (name || '').match(RUNNA_NAME);
  return m ? addDays(mondayOf(date), WEEKDAY_INDEX[m[1].toLowerCase()]) : null;
}

/**
 * Every planned workout with its status, plus runs that were not in the plan.
 * status: done (on the planned day) | moved (another day) | missed | today | upcoming | extra
 */
export function planItems(schedule, acts, today = new Date()) {
  const used = new Set();
  const items = (schedule || []).map(w => {
    const date = parseDate(w.date);
    const act = acts.find(a => w.workout_id && a.workoutId === w.workout_id && Math.abs(a.date - date) <= MATCH_DAYS * DAY_MS);
    if (act) used.add(act);
    let status;
    if (act) status = sameDay(act.date, date) ? 'done' : 'moved';
    else if (sameDay(date, today)) status = 'today';
    else status = date < startOfDay(today) ? 'missed' : 'upcoming';
    return { date, title: w.title, sport: w.sport, act, status, inferred: false };
  });

  for (const a of acts) {
    if (used.has(a) || !(isRun(a) && a.km > 0)) continue;
    const named = plannedDayFromName(a.title, a.date);
    if (a.workoutId || named) {
      // A plan workout done before the plan history started: planned day from the name if it has one
      const date = named || startOfDay(a.date);
      items.push({ date, title: a.title, sport: a.type, act: a, status: sameDay(a.date, date) ? 'done' : 'moved', inferred: true });
    } else {
      items.push({ date: startOfDay(a.date), title: a.title, sport: a.type, act: a, status: 'extra', inferred: false });
    }
  }
  return items.sort((x, y) => x.date - y.date || (x.act?.date || 0) - (y.act?.date || 0));
}

/* ---------- Weekly review ---------- */

// `end` is exclusive: the whole week is addDays(monday, 7); "so far" ends after today
function volume(acts, monday, end = addDays(monday, 7)) {
  const runs = acts.filter(a => isRun(a) && a.km > 0 && a.date >= monday && a.date < end);
  return {
    km: runs.reduce((s, a) => s + a.km, 0),
    runs: runs.length,
    sec: runs.reduce((s, a) => s + (a.sec || 0), 0),
    longest: runs.reduce((m, a) => Math.max(m, a.km), 0),
    trimp: acts.filter(a => a.zones && a.date >= monday && a.date < end).reduce((s, a) => s + edwardsTrimp(a), 0),
  };
}

function recovery(meta, monday, end = addDays(monday, 7)) {
  const inWeek = x => { const d = parseDate(x.date); return d && d >= monday && d < end; };
  const rec = meta?.recovery || {};
  const sleep = (rec.sleep || []).filter(inWeek);
  return {
    hrv: avg((rec.hrv || []).filter(inWeek).map(h => h.last_night)),
    rhr: avg((meta?.restingHr || []).filter(inWeek).map(r => r.bpm)),
    sleepSec: avg(sleep.map(s => s.duration_s)),
    sleepScore: avg(sleep.map(s => s.score)),
  };
}

/** Latest value on or before `date` in a list of { date, [key] } */
function valueAt(list, key, date) {
  const before = (list || []).filter(x => parseDate(x.date) <= date);
  return before.length ? before[before.length - 1][key] : null;
}

/**
 * Everything for one week (Monday to Sunday) compared with the week before.
 * highlights: [{ level: 'ok' | 'watch' | 'info', text }] built by fixed, visible rules.
 */
export function weekReview(monday, { acts, schedule, meta, today = new Date() }) {
  monday = mondayOf(monday);
  const end = addDays(monday, 7), prevMonday = addDays(monday, -7);
  const lastDay = end <= today ? addDays(end, -1) : startOfDay(today);   // the week so far
  const inProgress = end > today;

  const items = planItems(schedule, acts, today).filter(i => i.date >= monday && i.date < end);
  const planned = items.filter(i => i.status !== 'extra');
  const count = s => items.filter(i => s.includes(i.status)).length;
  const plan = {
    items, planned: planned.length, done: count(['done', 'moved']), moved: count(['moved']), missed: count(['missed']),
    remaining: count(['today', 'upcoming']), extra: count(['extra']),
    // Missed workouts can only be seen from the first saved plan day on
    tracked: (schedule || []).some(w => parseDate(w.date) <= monday),
  };

  const days = loadModel(acts, lastDay);
  const upTo = date => days.filter(d => d.date <= date);
  const ctlAt = date => { const d = upTo(date); return d.length ? d[d.length - 1].ctl : null; };
  const load = { acwr: acwr(upTo(lastDay))?.ratio ?? null, ctlStart: ctlAt(addDays(monday, -1)), ctlEnd: ctlAt(lastDay) };

  // A week in progress is compared with the same point of the week before (Monday up to the same
  // weekday), not with the whole week before, which would always make this week look behind.
  const curEnd = inProgress ? addDays(today, 1) : end;
  const prevEnd = inProgress ? addDays(prevMonday, daysBetween(monday, today) + 1) : monday;
  const cur = { ...volume(acts, monday, curEnd), ...recovery(meta, monday, curEnd) };
  const prev = { ...volume(acts, prevMonday, prevEnd), ...recovery(meta, prevMonday, prevEnd) };
  const prevWhole = volume(acts, prevMonday);
  const vs = inProgress ? 'the same point last week' : 'the week before';
  const forecast = {
    vo2Start: valueAt(meta?.vo2max, 'vo2max', addDays(monday, -1)), vo2End: valueAt(meta?.vo2max, 'vo2max', lastDay),
    garminStart: valueAt(meta?.racePredictions, 'marathon_s', addDays(monday, -1)), garminEnd: valueAt(meta?.racePredictions, 'marathon_s', lastDay),
  };

  const highlights = [];
  if (plan.planned) {
    const missedNames = items.filter(i => i.status === 'missed').map(i => i.title);
    highlights.push({
      level: plan.missed ? 'watch' : 'ok',
      text: `${plan.done} of ${plan.planned} planned sessions done` +
        (plan.moved ? `, ${plan.moved} on another day than planned` : '') +
        (plan.remaining ? `, ${plan.remaining} still to come` : '') +
        (plan.missed ? `. Missed: ${missedNames.join(', ')}` : '') + '.',
    });
  }
  if (!plan.tracked) highlights.push({ level: 'info', text: 'Missed sessions can only be seen from the day the app started saving your plan.' });
  if (prev.km > 0) {
    const change = (cur.km - prev.km) / prev.km;
    // The 10% guideline is about whole weeks, so a week in progress only gets an info note
    const jump = !inProgress && change > VOLUME_JUMP;
    highlights.push({
      level: jump ? 'watch' : 'info',
      text: `Distance ${inProgress ? 'so far ' : ''}${change >= 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}% from ${vs}` +
        (jump ? ', more than the common 10% guideline.' : '.'),
    });
  }
  if (Number.isFinite(cur.hrv) && Number.isFinite(prev.hrv)) {
    const d = cur.hrv - prev.hrv;
    highlights.push({ level: d < -5 ? 'watch' : 'info', text: `Average HRV ${d >= 0 ? 'up' : 'down'} ${Math.round(Math.abs(d))} ms from ${vs}.` });
  }
  if (Number.isFinite(cur.rhr) && Number.isFinite(prev.rhr) && Math.abs(cur.rhr - prev.rhr) >= 2) {
    const d = cur.rhr - prev.rhr;
    highlights.push({ level: d > 0 ? 'watch' : 'info', text: `Average resting HR ${d > 0 ? 'up' : 'down'} ${Math.round(Math.abs(d))} bpm from ${vs}.` });
  }
  if (forecast.vo2Start != null && forecast.vo2End != null && forecast.vo2End !== forecast.vo2Start) {
    const d = forecast.vo2End - forecast.vo2Start;
    highlights.push({ level: d > 0 ? 'ok' : 'info', text: `VO2max ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)} this week.` });
  }

  return { monday, end: addDays(end, -1), inProgress, plan, cur, prev, prevWhole, load, forecast, highlights };
}
