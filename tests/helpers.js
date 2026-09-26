// Shared test data. Every test uses the fixed date TODAY instead of the real date,
// so the results are the same whenever the tests run.

export const TODAY = new Date(2026, 8, 26, 12, 0);  // Sat 26 Sep 2026, noon

/** Date n days from TODAY (negative = in the past), at the given hour */
export function day(n, hour = 12) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** "YYYY-MM-DD" for day(n), the format Garmin data uses */
export function iso(n) {
  const d = day(n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** A run as it looks in state.acts */
export function run({ n = 0, title = 'Easy Run', km = 8, min = 48, hr = 140, teLabel = null, zones = null, laps = null, kcal = null } = {}) {
  return { date: day(n, 7), type: 'running', title, km, sec: min * 60, hr, teLabel, zones, laps, kcal };
}

/** Seconds in zones 1–5 giving an Edwards TRIMP of `load` from zone 2 only (1 min in zone 2 = 2) */
export const zonesForLoad = load => [0, load / 2 * 60, 0, 0, 0];
