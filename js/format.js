// Every number and date shown in the UI goes through these functions,
// so all views use exactly the same format.

const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DASH = '–';

/* ---------- Units (Settings → Appearance) ----------
   Everything is calculated and stored in kilometres; only what is shown changes. */
export const KM_PER_MILE = 1.609344;
let unit = 'km';   // 'km' | 'mi'
export function setUnits(u) { unit = u === 'mi' ? 'mi' : 'km'; }
export const units = () => unit;
/** "km" or "mi" */
export const distLabel = () => unit;
/** "/km" or "/mi" */
export const paceLabel = () => '/' + unit;
/** km → the chosen unit (for charts and inputs) */
export const distIn = km => unit === 'mi' ? km / KM_PER_MILE : km;
/** The chosen unit → km (from inputs) */
export const distFromUnit = v => unit === 'mi' ? v * KM_PER_MILE : v;
/** Seconds per km → seconds per chosen unit (for charts) */
export const paceIn = secPerKm => unit === 'mi' ? secPerKm * KM_PER_MILE : secPerKm;

/** Distance (given in km) in the chosen unit, always one decimal: 24.3 */
export const fmtKm = km => Number.isFinite(km) ? nf1.format(distIn(km)) : DASH;
/** Distance (given in km) in the chosen unit as a whole number: 32 (targets, limits) */
export const fmtKmWhole = km => Number.isFinite(km) ? nf0.format(distIn(km)) : DASH;

/** Any value with one decimal: VDOT 41.9 (same format as km, but named for what it is) */
export const fmtDec1 = n => Number.isFinite(n) ? nf1.format(n) : DASH;

/** Whole number: 22, 152 */
export const fmtInt = n => Number.isFinite(n) ? nf0.format(n) : DASH;

/** Ratio with two decimals: 1.12 (ACWR, aerobic efficiency) */
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRatio = n => Number.isFinite(n) ? nf2.format(n) : DASH;

/** Signed whole number: +5, −12, 0 (training form) */
export const fmtSigned = n => !Number.isFinite(n) ? DASH : (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + nf0.format(Math.abs(n));

/** Seconds as min:ss: 6:09 (chart ticks whose data is already in the chosen unit) */
export function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return DASH;
  let m = Math.floor(sec / 60), s = Math.round(sec - m * 60);
  if (s === 60) { m++; s = 0; }
  return m + ':' + String(s).padStart(2, '0');
}

/** Pace (given in seconds per km) as min:ss per chosen unit: 6:09 */
export const fmtPace = secPerKm => fmtClock(paceIn(secPerKm));

/** Duration as h:mm:ss or m:ss: 1:02:05, 26:10 */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return DASH;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

/** Sleep-style duration: 7 h 05 min */
export function fmtHm(sec) {
  if (!Number.isFinite(sec)) return DASH;
  const m = Math.round(sec / 60);
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}

/** Hours and minutes as a clock: 8:57 (shown with the unit "h") */
export function fmtHClock(sec) {
  if (!Number.isFinite(sec)) return DASH;
  const m = Math.round(sec / 60);
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

/** 25 Sep */
export const fmtDay = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
/** Sat 26 Sep */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtWeekday = d => WEEKDAYS[d.getDay()] + ' ' + fmtDay(d);

/** Gram range: "270–450 g", or one value when both ends round to the same number */
export function fmtGrams(range) {
  if (!range) return DASH;
  const [lo, hi] = range.map(Math.round);
  return (lo === hi ? nf0.format(lo) : nf0.format(lo) + '–' + nf0.format(hi)) + ' g';
}

/** 25 Sep 2026 */
export const fmtDate = d => fmtDay(d) + ' ' + d.getFullYear();
/** 06:05 */
export const fmtTime = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

/** A workout from describeWorkout()/describePlanned(): its kind as a badge, then the tidy name */
export const fmtWorkout = d => (d.label ? `<span class="kind kind-${d.kind}">${esc(d.label)}</span> ` : '') +
  (d.repeatsKind ? '' : `<span class="workout-name">${esc(d.name)}</span>`);

/** Escape text before inserting it into HTML */
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
