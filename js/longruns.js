// Long run progression toward the marathon. Pure calculations, no DOM code.
// Guidelines used here (common marathon training practice, shown in the UI):
//   - the longest run peaks at 30–35 km about 3 weeks before the race, then the taper starts
//   - build the long run by at most 1–2 km a week on average, with an easier week every 3–4 weeks
//   - the long run should be at most about 35% of the week's running

import { mondayOf, startOfDay, addDays, daysBetween } from './dates.js';
import { parseDate } from './parse.js';

export const LONG_RUN = {
  peakKm: [30, 35],        // target range for the longest run before the marathon
  targetKm: 32,            // the middle of it, used for the "needed per week" line
  peakWeeksBefore: 3,      // peak long run this many weeks before race day
  maxKmPerWeek: 1.5,       // average build-up faster than this is steep
  maxShare: 0.35,          // long run over 35% of the week's distance is a lot
};

const isRun = a => /run|juoks|treadmill|trail/i.test(a.type || '');
const kmFromTitle = t => { const m = (t || '').match(/\((\d+(?:[.,]\d+)?)\s*km\)/i) || (t || '').match(/(\d+(?:[.,]\d+)?)\s*km/i); return m ? parseFloat(m[1].replace(',', '.')) : null; };

/** Longest run, total distance and the long run's share, for every week from `from` to `to` (Mondays) */
export function weeklyLongRuns(acts, from, to) {
  const weeks = [];
  for (let mon = mondayOf(from); mon <= to; mon = addDays(mon, 7)) {
    const end = addDays(mon, 7);
    const runs = acts.filter(a => isRun(a) && a.km > 0 && a.date >= mon && a.date < end);
    const longest = runs.reduce((best, a) => (!best || a.km > best.km ? a : best), null);
    const weekKm = runs.reduce((s, a) => s + a.km, 0);
    weeks.push({ monday: mon, longest: longest?.km ?? 0, act: longest, weekKm, share: weekKm ? (longest?.km ?? 0) / weekKm : null });
  }
  return weeks;
}

/** Long runs scheduled in the plan from today on: "long" in the name, distance from the name */
export function plannedLongRuns(schedule, today = new Date()) {
  return (schedule || [])
    .filter(w => /long/i.test(w.title || '') && parseDate(w.date) >= startOfDay(today))
    .map(w => ({ date: parseDate(w.date), title: w.title, km: kmFromTitle(w.title) }))
    .filter(w => w.km);
}

/**
 * Where the long run is heading: the longest run of the last 4 weeks, the date the peak should be reached,
 * and the average weekly increase needed to get from one to the other.
 */
export function longRunOutlook(acts, raceDay, today = new Date()) {
  const recent = acts.filter(a => isRun(a) && a.km > 0 && a.date >= addDays(today, -28) && a.date <= today);
  const current = recent.reduce((m, a) => Math.max(m, a.km), 0);
  const peakBy = addDays(raceDay, -7 * LONG_RUN.peakWeeksBefore);
  const weeksToPeak = daysBetween(today, peakBy) / 7;
  const perWeek = weeksToPeak > 0 ? Math.max(0, LONG_RUN.targetKm - current) / weeksToPeak : null;
  let status;
  if (current >= LONG_RUN.peakKm[0]) status = 'reached';
  else if (weeksToPeak <= 0) status = 'late';
  else status = perWeek <= LONG_RUN.maxKmPerWeek ? 'on-track' : 'steep';
  return { current, peakBy, weeksToPeak, perWeek, status };
}

/** Straight line from the current longest run (this week) to the target at the peak date; null outside that span */
export function progressionLine(weeks, outlook, today = new Date()) {
  const start = mondayOf(today);
  const span = outlook.peakBy - start;
  return weeks.map(w => {
    if (span <= 0 || w.monday < start || w.monday > outlook.peakBy) return null;
    return outlook.current + (LONG_RUN.targetKm - outlook.current) * ((w.monday - start) / span);
  });
}
