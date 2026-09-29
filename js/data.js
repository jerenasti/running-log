// Loading activities from data/activities.json (written by fetch_garmin.py).
// Errors are thrown with a user-facing message.

import { parseDate } from './parse.js';

export const DATA_URL = 'data/activities.json';

/** A load failure. missing = there is simply no data yet (an empty state, not an error). */
export class LoadError extends Error {
  constructor(message, { missing = false, detail = '' } = {}) {
    super(message);
    this.missing = missing;
    this.detail = detail;   // technical text, shown only under "Show details"
  }
}

/* ---------- Garmin JSON ---------- */
export async function fetchGarmin() {
  if (location.protocol === 'file:') {
    throw new LoadError('The page was opened directly as a file, so the browser will not let it read the Garmin data. Start the app with start.bat.');
  }
  let res;
  try {
    // cache: 'no-store' makes the browser always fetch the latest version instead of using its cache.
    res = await fetch(DATA_URL, { cache: 'no-store' });
  } catch (e) {
    throw new LoadError('Could not reach the app server. Is it still running?', { detail: String(e) });
  }
  if (res.status === 404) throw new LoadError('No Garmin data has been fetched yet.', { missing: true });
  if (!res.ok) throw new LoadError(`The app server could not send the Garmin data (HTTP ${res.status}).`, { detail: `GET ${DATA_URL} → ${res.status}` });
  let o;
  try {
    o = await res.json();
  } catch (e) {
    throw new LoadError('The Garmin data file is damaged. Fetching the data again usually fixes it.', { detail: `${DATA_URL}: ${e.message}` });
  }
  if (!o || !Array.isArray(o.activities)) throw new LoadError('The Garmin data file is damaged. Fetching the data again usually fixes it.', { detail: `${DATA_URL}: no activities list` });
  if (!o.activities.length) throw new LoadError('Your Garmin account has no activities in the fetched range yet.', { missing: true });
  return o;
}

export function garminToActivities(json) {
  // Activities without distance (e.g. strength, mobility) are kept: they still add training load.
  // The Training tab only shows activities with a distance.
  const acts = json.activities.map(a => ({
    date: parseDate(a.start_time), type: String(a.type || ''), title: String(a.name || ''),
    km: (+a.distance_m || 0) / 1000, sec: +a.duration_s || NaN, hr: a.avg_hr == null ? NaN : +a.avg_hr,
    maxHr: a.max_hr ?? null, teLabel: a.te_label ?? null, zones: a.hr_zones_s ?? null, kcal: a.calories ?? null,
    laps: a.laps ?? null,  // only for time trials
    workoutId: a.workout_id ?? null,  // links the run to a scheduled workout
    route: !!a.route,                 // data/routes/<id>.json exists (outdoor run with a saved route)
    id: a.id ?? null,

  })).filter(a => a.date).sort((a, b) => a.date - b.date);
  // Garmin extras for the Fitness and load, Recovery and Nutrition tabs
  const meta = {
    hrSettings: json.hr_settings ?? null, restingHr: json.resting_hr ?? [], recovery: json.recovery ?? null,
    schedule: json.schedule ?? [], weight: json.weight ?? null,
    vo2max: json.vo2max ?? [], racePredictions: json.race_predictions ?? [],
  };
  return { acts, meta };
}

/** data/fetch_status.json written by fetch_garmin.py: { at, ok, error, warnings }, or null if missing */
export async function fetchStatus() {
  try {
    const res = await fetch('data/fetch_status.json', { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

/** Editable content files in content/ (meal ideas, races). A missing or broken file gives an error message. */
export async function fetchContent(name) {
  try {
    const res = await fetch('content/' + name, { cache: 'no-store' });
    if (!res.ok) return { error: `content/${name} was not found.` };
    return { data: await res.json() };
  } catch (e) {
    return { error: `content/${name} is not valid JSON (${e.message}). Check the quotes and commas.` };
  }
}
