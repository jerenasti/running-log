// Loading activities from data/activities.json (written by fetch_garmin.py).
// Errors are thrown with a user-facing message.

import { parseDate } from './parse.js';

export const DATA_URL = 'data/activities.json';

/* ---------- Garmin JSON ---------- */
export async function fetchGarmin() {
  if (location.protocol === 'file:') {
    throw new Error('The page was opened directly as a file, so the browser will not let it read the Garmin data. Start the app with start.bat.');
  }
  // cache: 'no-store' makes the browser always fetch the latest version instead of using its cache.
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('File ' + DATA_URL + ' was not found. Fetch your Garmin data with start.bat or uv run fetch_garmin.py.');
  const o = await res.json();
  if (!o || !Array.isArray(o.activities) || !o.activities.length) throw new Error('File ' + DATA_URL + ' contains no activities.');
  return o;
}

export function garminToActivities(json) {
  // Activities without distance (e.g. strength, mobility) are kept: they still add training load.
  // The Training tab only shows activities with a distance.
  const acts = json.activities.map(a => ({
    date: parseDate(a.start_time), type: String(a.type || ''), title: String(a.name || ''),
    km: (+a.distance_m || 0) / 1000, sec: +a.duration_s || NaN, hr: a.avg_hr == null ? NaN : +a.avg_hr,
    maxHr: a.max_hr ?? null, teLabel: a.te_label ?? null, zones: a.hr_zones_s ?? null,
  })).filter(a => a.date).sort((a, b) => a.date - b.date);
  // Garmin extras for the Fitness and load and Recovery tabs
  const meta = { hrSettings: json.hr_settings ?? null, restingHr: json.resting_hr ?? [], recovery: json.recovery ?? null };
  return { acts, meta };
}
