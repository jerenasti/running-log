// Loading activities: Garmin JSON (data/activities.json, written by fetch_garmin.py) and sample data.
// Every loader returns { acts, meta } in the same shape, or throws an Error with a user-facing message.

import { parseDate } from './parse.js';
import { mondayOf } from './dates.js';

export const DATA_URL = 'data/activities.json';
export const SAMPLE_SOURCE = 'sample data';

/* ---------- Garmin JSON ---------- */
export async function fetchGarmin() {
  if (location.protocol === 'file:') {
    throw new Error('The page was opened directly as a file, so the browser will not let it read the Garmin data. Start the app with start.bat.');
  }
  // cache: 'no-store' makes the browser always fetch the latest version instead of using its cache.
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('No Garmin data yet: ' + DATA_URL + ' was not found. Fetch it with start.bat or uv run fetch_garmin.py.');
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
  // Garmin-only extras for the Fitness and load tab
  const meta = { hrSettings: json.hr_settings ?? null, restingHr: json.resting_hr ?? [] };
  return { acts, meta };
}

/* ---------- Sample data ---------- */
/** 24 weeks of made-up running for trying the app. No heart rate zones, so Fitness and load stays empty. */
export function sampleActivities() {
  const acts = [], today = new Date();
  const start = mondayOf(today); start.setDate(start.getDate() - 7 * 23);
  const at = (week, day) => { const d = new Date(start); d.setDate(start.getDate() + week * 7 + day); d.setHours(7, 15); return d; };
  const blank = { maxHr: null, teLabel: null, zones: null };
  for (let w = 0; w < 24; w++) {
    const prog = w / 23, f = (w % 4 === 3) ? 0.72 : 1;
    const plan = [
      { d: 1, t: 'Easy run',  km: 7 + prog * 3,   pace: 372, hr: 142 },
      { d: 3, t: 'Intervals', km: 8 + prog * 2,   pace: 328, hr: 158 },
      { d: 4, t: 'Easy run',  km: 6 + prog * 3,   pace: 375, hr: 140 },
      { d: 6, t: 'Long run',  km: 12 + prog * 16, pace: 385, hr: 146 },
    ];
    for (const p of plan) {
      const date = at(w, p.d);
      if (date > today) continue;
      const km = p.km * f * (0.93 + Math.random() * 0.14);
      const pace = p.pace - prog * 24 + (Math.random() * 14 - 7);
      acts.push({ ...blank, date, type: 'running', title: p.t, km, sec: Math.round(km * pace), hr: Math.round(p.hr + Math.random() * 6) });
    }
    if (w % 3 === 0 && at(w, 5) <= today) {
      acts.push({ ...blank, date: at(w, 5), type: 'cycling', title: 'Bike ride', km: 30 + Math.random() * 15, sec: 5700, hr: 128 });
    }
  }
  return { acts, meta: null };
}
