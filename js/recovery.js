// Recovery status and the daily recommendation. Pure calculations, no DOM code.
// All limits are in RULES, and the Recovery tab shows every rule with its value,
// so the recommendation is never a black box.

import { acwr, loadModel } from './metrics.js';
import { dayKey, startOfDay, addDays } from './dates.js';
import { parseDate } from './parse.js';

export const RULES = {
  normalDays: 28,       // personal normal range of resting HR and ATL: the previous 28 days
  minNormalDays: 14,    // …needs at least this many values, otherwise the rule is skipped
  sleepScoreMin: 60,    // poor sleep: score below this…
  sleepHoursMin: 6,     // …or less sleep than this
  bodyBatteryMin: 40,   // low Body Battery: day's highest value (after waking) below this
  acwrHigh: 1.3,        // high load: ACWR at or above this…
};                      // …or fatigue (ATL) above its own normal range

/** Mean and standard deviation; null when there are too few values */
export function meanSd(values, minCount = RULES.minNormalDays) {
  const v = values.filter(Number.isFinite);
  if (v.length < minCount) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return { mean, sd, low: mean - sd, high: mean + sd, n: v.length };
}

/** Normal range from the RULES.normalDays days before `date` (the day itself is not included) */
function normalBefore(series, date) {
  const end = startOfDay(date).getTime(), start = addDays(date, -RULES.normalDays).getTime();
  return meanSd(series.filter(p => p.t >= start && p.t < end).map(p => p.v));
}

const byDate = list => new Map((list || []).map(x => [x.date, x]));
const toSeries = (list, key) => (list || []).map(x => ({ t: parseDate(x.date).getTime(), v: x[key] })).filter(p => Number.isFinite(p.v));

/** Resting HR per day with its personal normal range (mean ± 1 SD of the previous 28 days) */
export function restingHrTrend(restingHr, days = 28) {
  const series = toSeries(restingHr, 'bpm');
  return (restingHr || []).slice(-days).map(x => {
    const date = parseDate(x.date);
    return { date, bpm: x.bpm, normal: normalBefore(series, date) };
  });
}

/**
 * Last 7 days compared with the last 28 for sleep and Body Battery. Days of today are left out
 * of Body Battery, because today's high and low are not final yet.
 * Returns { sleep: { hours, score, deepShare }, bb: { high, low } }, each as { week, month } averages.
 */
export function recoveryTrends(rec, today = new Date()) {
  const todayKey = dayKey(today);
  const lastN = (list, n) => {
    const from = dayKey(addDays(today, -n));
    return (list || []).filter(x => x.date > from && x.date <= todayKey);
  };
  const avg = (list, f) => { const v = list.map(f).filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const both = (list, f) => ({ week: avg(lastN(list, 7), f), month: avg(lastN(list, 28), f) });
  const bbDone = (rec?.body_battery || []).filter(b => b.date < todayKey);
  const stagesTotal = s => (s.deep_s || 0) + (s.light_s || 0) + (s.rem_s || 0);
  return {
    sleep: {
      hours: both(rec?.sleep, s => s.duration_s / 3600),
      score: both(rec?.sleep, s => s.score ?? NaN),
      deepShare: both(rec?.sleep, s => stagesTotal(s) ? s.deep_s / stagesTotal(s) : NaN),
    },
    bb: { high: both(bbDone, b => b.high ?? NaN), low: both(bbDone, b => b.low ?? NaN) },
  };
}

/**
 * Everything the Recovery tab needs: the latest synced night, each check, and the recommendation.
 * A check is { id, label, value, rule, met } where met is true / false / null (no data).
 */
export function assess(acts, meta, today = new Date()) {
  const rec = meta?.recovery || {};
  const hrv = byDate(rec.hrv), sleep = byDate(rec.sleep), bb = byDate(rec.body_battery), rhr = byDate(meta?.restingHr);

  // The latest night with HRV or sleep data. Today's values may not be synced yet.
  const nights = [...(rec.hrv || []), ...(rec.sleep || [])].map(x => x.date).sort();
  const day = nights[nights.length - 1] || dayKey(today);
  const h = hrv.get(day), s = sleep.get(day), b = bb.get(day), r = rhr.get(day);

  const rhrNormal = normalBefore(toSeries(meta?.restingHr, 'bpm'), parseDate(day));
  const days = loadModel(acts, today);
  const ratio = acwr(days);
  const atlNormal = days.length ? normalBefore(days.map(d => ({ t: d.date.getTime(), v: d.atl })), today) : null;
  const atlNow = days.length ? days[days.length - 1].atl : NaN;

  const check = (id, label, value, rule, met) => ({ id, label, value, rule, met });
  const has = v => v !== undefined && v !== null && Number.isFinite(+v);

  const hrvLow = check('hrv', 'HRV below normal', h?.last_night, h ? `below ${h.baseline_low} ms (Garmin baseline ${h.baseline_low}–${h.baseline_high})` : 'Garmin baseline',
    h && has(h.last_night) && has(h.baseline_low) ? h.last_night < h.baseline_low : null);
  const rhrHigh = check('rhr', 'Resting HR above normal', r?.bpm, rhrNormal ? `above ${Math.round(rhrNormal.high)} bpm (28-day mean ${Math.round(rhrNormal.mean)} + 1 SD)` : `needs ${RULES.minNormalDays} days of resting HR`,
    r && rhrNormal ? r.bpm > rhrNormal.high : null);
  const sleepPoor = check('sleep', 'Poor sleep', s ? { score: s.score, duration_s: s.duration_s } : null, `score below ${RULES.sleepScoreMin} or under ${RULES.sleepHoursMin} h`,
    // Check each value only if it exists: in JavaScript `null < 60` is true
    s && (has(s.score) || has(s.duration_s))
      ? (has(s.score) && s.score < RULES.sleepScoreMin) || (has(s.duration_s) && s.duration_s < RULES.sleepHoursMin * 3600)
      : null);
  const bbLow = check('bb', 'Low Body Battery', b?.high, `day's high below ${RULES.bodyBatteryMin}`,
    b && has(b.high) ? b.high < RULES.bodyBatteryMin : null);
  const acwrHigh = check('acwr', 'High workload ratio', ratio?.ratio, `ACWR ${RULES.acwrHigh} or higher`, ratio ? ratio.ratio >= RULES.acwrHigh : null);
  const atlHigh = check('atl', 'Fatigue above normal', atlNow, atlNormal ? `ATL above ${Math.round(atlNormal.high)} (28-day mean ${Math.round(atlNormal.mean)} + 1 SD)` : `needs ${RULES.minNormalDays} days of load`,
    atlNormal ? atlNow > atlNormal.high : null);

  const recoveryChecks = [hrvLow, rhrHigh, sleepPoor, bbLow];
  const loadChecks = [acwrHigh, atlHigh];
  const loadHigh = loadChecks.some(c => c.met);
  const attention = (hrvLow.met || rhrHigh.met) && loadHigh;
  const flags = recoveryChecks.filter(c => c.met);

  let rec_;
  if (hrvLow.met === null && rhrHigh.met === null) {
    rec_ = { key: 'unknown', label: 'Not enough data', why: ['No HRV or resting heart rate for the latest night.'] };
  } else if ((hrvLow.met && rhrHigh.met) || attention) {
    rec_ = { key: 'rest', label: 'Rest day',
      why: [hrvLow.met && rhrHigh.met ? 'HRV is low and resting HR is high at the same time.' : 'Recovery signals are off while your training load is high.'] };
  } else if (flags.length || loadHigh) {
    rec_ = { key: 'easy', label: 'Easy day',
      why: [...flags.map(c => c.label + '.'), ...loadChecks.filter(c => c.met).map(c => c.label + '.')] };
  } else {
    rec_ = { key: 'hard', label: 'Hard training OK', why: ['No recovery warning signs and your training load is in its normal range.'] };
  }

  return { day, hrv: h, sleep: s, bodyBattery: b, rhr: r, rhrNormal, recoveryChecks, loadChecks, loadHigh, attention, recommendation: rec_ };
}
