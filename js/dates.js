// Calendar helpers. Weeks start on Monday (ISO 8601).

export const DAY_MS = 864e5;

/** Local calendar day as "YYYY-MM-DD" (used as a key for daily values) */
export const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** Midnight of d */
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Midnight n calendar days after d. Uses the calendar, not n × 24 hours: on the day clocks change
 * (daylight saving time) a day is 23 or 25 hours, and millisecond arithmetic would land on the wrong day.
 */
export function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Whole calendar days from a to b (rounded, so a 23- or 25-hour day still counts as one) */
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);

/** Monday 00:00 of the week that contains d */
export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** ISO week number (1–53) */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / DAY_MS + 1) / 7);
}
