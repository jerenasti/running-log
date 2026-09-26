// Loading activities: Garmin JSON (data/activities.json), CSV upload, and sample data.
// Every loader returns { acts, cols } in the same shape, or throws an Error with a user-facing message.

import { parseNum, parseDuration, parseDate } from './parse.js';
import { mondayOf } from './dates.js';
import { fmtDuration } from './format.js';

export const DATA_URL = 'data/activities.json';

/* ---------- CSV column detection (English and Finnish Garmin exports) ---------- */
export const FIELDS = {
  type:  { name: 'Sport',    exact: ['activity type', 'aktiviteetin tyyppi', 'aktiviteettityyppi', 'tyyppi', 'laji'], incl: ['activity type', 'tyyppi', 'laji'] },
  date:  { name: 'Date',     exact: ['date', 'päivämäärä', 'pvm'], incl: ['date', 'päivämäärä', 'pvm'] },
  title: { name: 'Title',    exact: ['title', 'otsikko', 'nimi'], incl: ['title', 'otsikko'] },
  dist:  { name: 'Distance', exact: ['distance', 'matka', 'etäisyys'], incl: ['distance', 'matka', 'etäisyys'] },
  time:  { name: 'Time',     exact: ['time', 'aika', 'kesto'], incl: ['time', 'aika', 'kesto'],
           excl: ['lap', 'kierros', 'best', 'paras', 'moving', 'liike', 'elapsed', 'kulunut', 'pace', 'vauhti', 'date', 'päivä'] },
  hr:    { name: 'Avg HR',   exact: ['avg hr', 'keskisyke', 'average heart rate'], incl: ['avg hr', 'keskisyke', 'keskim. syke', 'average heart', 'keskimääräinen syke'] },
};

function findCol(headers, spec) {
  const norm = headers.map(h => String(h || '').toLowerCase().trim());
  for (const k of spec.exact) { const i = norm.indexOf(k); if (i >= 0) return headers[i]; }
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (spec.excl && spec.excl.some(e => h.includes(e))) continue;
    if (spec.incl.some(k => h.includes(k))) return headers[i];
  }
  return null;
}

/** CSV rows (objects keyed by header) → { acts, cols } */
export function rowsToActivities(rows, headers) {
  const cols = {};
  for (const k in FIELDS) cols[k] = findCol(headers, FIELDS[k]);
  if (!cols.date || !cols.dist) {
    throw new Error('No date or distance column found in the file. Make sure you export the list from the Garmin Connect Activities page with Export CSV. Columns found: ' + headers.join(', '));
  }
  const acts = rows.map(r => ({
    date:  parseDate(r[cols.date]),
    type:  cols.type ? String(r[cols.type] || '') : '',
    title: cols.title ? String(r[cols.title] || '') : '',
    km:    parseNum(r[cols.dist]),
    sec:   cols.time ? parseDuration(r[cols.time]) : NaN,
    hr:    cols.hr ? parseNum(r[cols.hr]) : NaN,
  })).filter(a => a.date && Number.isFinite(a.km) && a.km > 0);

  if (!acts.length) throw new Error('The file contains no activities with both a date and a distance.');
  const kms = acts.map(a => a.km).sort((a, b) => a - b);
  if (kms[Math.floor(kms.length / 2)] > 300) acts.forEach(a => a.km /= 1000); // distance in metres
  acts.sort((a, b) => a.date - b.date);
  return { acts, cols };
}

/** Parse an uploaded CSV file (uses the PapaParse library loaded in index.html) */
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      reject(new Error('Choose a CSV file. The file ' + file.name + ' is not in CSV format.'));
      return;
    }
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: res => { try { resolve(rowsToActivities(res.data, res.meta.fields || [])); } catch (e) { reject(e); } },
      error: () => reject(new Error('Could not read the file. Try exporting the CSV from Garmin Connect again.')),
    });
  });
}

/* ---------- Garmin JSON ---------- */
export async function fetchGarmin() {
  if (location.protocol === 'file:') {
    throw new Error('The page was opened directly as a file, so the browser will not let it read the Garmin data. Start the app with start.bat or upload a CSV file.');
  }
  // cache: 'no-store' makes the browser always fetch the latest version instead of using its cache.
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('File ' + DATA_URL + ' not found. Fetch the data with uv run fetch_garmin.py or upload a CSV file.');
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
  const cols = { type: 'type', date: 'start_time', title: 'name', dist: 'distance_m', time: 'duration_s', hr: 'avg_hr' };
  // Garmin-only extras for the Fitness and load tab
  const meta = { hrSettings: json.hr_settings ?? null, restingHr: json.resting_hr ?? [] };
  return { acts, cols, meta };
}

/* ---------- Sample data ---------- */
export function sampleActivities() {
  const rows = [], today = new Date();
  const start = mondayOf(today); start.setDate(start.getDate() - 7 * 23);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' 07:15:00';
  for (let w = 0; w < 24; w++) {
    const prog = w / 23, f = (w % 4 === 3) ? 0.72 : 1;
    const plan = [
      { d: 1, t: 'Easy run',  km: 7 + prog * 3,   pace: 372, hr: 142 },
      { d: 3, t: 'Intervals', km: 8 + prog * 2,   pace: 328, hr: 158 },
      { d: 4, t: 'Easy run',  km: 6 + prog * 3,   pace: 375, hr: 140 },
      { d: 6, t: 'Long run',  km: 12 + prog * 16, pace: 385, hr: 146 },
    ];
    for (const p of plan) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + p.d);
      if (date > today) continue;
      const km = p.km * f * (0.93 + Math.random() * 0.14);
      const pace = p.pace - prog * 24 + (Math.random() * 14 - 7);
      rows.push({ 'Activity Type': 'Running', 'Date': iso(date), 'Title': p.t,
        'Distance': km.toFixed(2), 'Time': fmtDuration(km * pace), 'Avg HR': String(Math.round(p.hr + Math.random() * 6)) });
    }
    if (w % 3 === 0) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + 5);
      if (date <= today) rows.push({ 'Activity Type': 'Cycling', 'Date': iso(date), 'Title': 'Bike ride',
        'Distance': (30 + Math.random() * 15).toFixed(2), 'Time': '1:35:00', 'Avg HR': '128' });
    }
  }
  return rowsToActivities(rows, ['Activity Type', 'Date', 'Title', 'Distance', 'Time', 'Avg HR']);
}
