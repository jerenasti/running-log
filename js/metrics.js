// Training metrics: pure calculations with no DOM code, so the formulas are easy to read and check.
//
// Activities come from state.acts: { date, type, title, km, sec, hr, speed, teLabel, zones }
// where zones = seconds in heart rate zones 1–5 (Garmin data only, otherwise null).

import { dayKey, startOfDay, addDays, mondayOf } from './dates.js';

export const CTL_DAYS = 42;          // fitness: long-term average
export const ATL_DAYS = 7;           // fatigue: short-term average
export const MIN_RELIABLE_DAYS = 42; // CTL needs about 6 weeks of data before it means much
export const EF_WINDOW = 5;          // aerobic efficiency: rolling average over the last 5 easy runs

/* ---------- Training load (Edwards TRIMP) ---------- */

/** Minutes in zone 1 × 1 + minutes in zone 2 × 2 + … + minutes in zone 5 × 5 */
export function edwardsTrimp(a) {
  if (!a.zones) return null;
  return a.zones.reduce((sum, sec, i) => sum + (sec || 0) / 60 * (i + 1), 0);
}

/**
 * Daily load and the fitness/fatigue model, one entry per day from the first activity to today.
 * CTL and ATL are exponentially weighted averages: each day moves 1/42 (or 1/7) of the way
 * toward that day's load. Form (TSB) is yesterday's CTL − yesterday's ATL, i.e. how fresh you
 * are going into the day (the convention used by TrainingPeaks).
 */
export function loadModel(acts, today = new Date()) {
  const withLoad = acts.filter(a => a.zones);
  if (!withLoad.length) return [];

  const loadByDay = new Map();
  for (const a of withLoad) {
    const k = dayKey(a.date);
    loadByDay.set(k, (loadByDay.get(k) || 0) + edwardsTrimp(a));
  }

  const days = [];
  let ctl = 0, atl = 0;
  const end = startOfDay(today);
  // Start from the earliest activity, whatever order the list is in
  const first = new Date(Math.min(...withLoad.map(a => startOfDay(a.date).getTime())));
  for (let date = first; date <= end; date = addDays(date, 1)) {
    const load = loadByDay.get(dayKey(date)) || 0;
    const tsb = ctl - atl;            // yesterday's values
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
    days.push({ date, load, ctl, atl, tsb });
  }
  return days;
}

/* ---------- Acute:chronic workload ratio ---------- */

export const ACWR_ZONES = [
  { max: 0.8,      key: 'under', label: 'Underload' },
  { max: 1.3,      key: 'ok',    label: 'Safe range' },
  { max: 1.5,      key: 'watch', label: 'Watch' },
  { max: Infinity, key: 'warn',  label: 'Warning' },
];

/** Average daily load of the last 7 days ÷ average daily load of the last 28 days. Needs 28 days of data. */
export function acwr(days) {
  if (days.length < 28) return null;
  const avg = n => days.slice(-n).reduce((s, d) => s + d.load, 0) / n;
  const acute = avg(7), chronic = avg(28);
  if (!chronic) return null;
  const ratio = acute / chronic;
  return { acute, chronic, ratio, zone: ACWR_ZONES.find(z => ratio < z.max) };
}

/** ACWR for each of the last n days (null where there are not yet 28 days of data) */
export function acwrSeries(days, n = 28) {
  return days.slice(-n).map((d, i, arr) => {
    const end = days.length - arr.length + i + 1;
    return { date: d.date, ratio: end >= 28 ? acwr(days.slice(0, end))?.ratio ?? null : null };
  });
}

/* ---------- Easy runs and aerobic efficiency ---------- */

export const DEFAULT_EASY_WORDS = ['easy', 'recovery', 'kevyt', 'palauttava'];
const HARD_WORDS = /interval|tempo|repeat|threshold|rolling|progress|fartlek|race|kilpa|time\s*trial|\btt\b|\btest\b|testi|aika-ajo/i;
const EASY_LABELS = ['RECOVERY', 'AEROBIC_BASE'];
const isRun = a => /run|juoks|treadmill|trail/i.test(a.type || '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = words => words.length ? new RegExp(words.map(w => escapeRe(w.trim())).join('|'), 'i') : null;

/**
 * An easy run: a run of at least 30 minutes with a heart rate, no hard-session words in the name,
 * one of the easy words in the name (settings: plan.easy_keywords) or classified by Garmin as
 * Recovery/Aerobic base, and average HR below `hrLimit` (settings: plan.easy_max_hr, else zone 4).
 */
export function isEasyRun(a, { hrLimit = null, words = DEFAULT_EASY_WORDS } = {}) {
  if (!isRun(a) || !(a.sec >= 30 * 60) || !(a.hr > 0) || !(a.km > 0)) return false;
  if (HARD_WORDS.test(a.title || '')) return false;
  const easy = wordsRe(words);
  if (!(easy && easy.test(a.title || '')) && !EASY_LABELS.includes(a.teLabel)) return false;
  if (hrLimit && a.hr >= hrLimit) return false;
  return true;
}

/** Speed in metres per minute ÷ average heart rate. Higher = faster at the same heart rate. */
export const efficiency = a => (a.km * 1000 / (a.sec / 60)) / a.hr;

/** Easy runs with their efficiency and the rolling average over the last EF_WINDOW runs */
export function efficiencySeries(acts, rule) {
  const runs = acts.filter(a => isEasyRun(a, rule)).map(a => ({ act: a, ef: efficiency(a) }));
  runs.forEach((r, i) => {
    const win = runs.slice(Math.max(0, i - EF_WINDOW + 1), i + 1);
    r.avg = win.reduce((s, x) => s + x.ef, 0) / win.length;
  });
  return runs;
}

/* ---------- Weekly average ---------- */

/**
 * Average of weeks[].km over the weeks that have data: from the week of the first Garmin activity
 * (`firstData`, any sport) on, and only finished weeks (a week in progress would pull it down).
 * A rest week inside the data counts as 0 km. Returns { km, weeks } or { km: null, weeks: 0 }.
 */
export function weeklyAverage(weeks, firstData, today = new Date()) {
  if (!firstData) return { km: null, weeks: 0 };
  const start = mondayOf(firstData);
  const counted = weeks.filter(w => w.mon >= start && addDays(w.mon, 7) <= startOfDay(today));
  return counted.length
    ? { km: counted.reduce((s, w) => s + w.km, 0) / counted.length, weeks: counted.length }
    : { km: null, weeks: 0 };
}
