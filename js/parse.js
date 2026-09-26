// Turn date text from data/activities.json into Date objects.

/** "2026-09-25 18:05:16" or "2026-09-25T18:05:16" → Date (local time) */
export function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
