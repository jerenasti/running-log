// Every number and date shown in the UI goes through these functions,
// so all views use exactly the same format.

const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DASH = '–';

/** Distance in km, always one decimal: 24.3 */
export const fmtKm = km => Number.isFinite(km) ? nf1.format(km) : DASH;

/** Whole number: 22, 152 */
export const fmtInt = n => Number.isFinite(n) ? nf0.format(n) : DASH;

/** Ratio with two decimals: 1.12 (ACWR, aerobic efficiency) */
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRatio = n => Number.isFinite(n) ? nf2.format(n) : DASH;

/** Signed whole number: +5, −12, 0 (training form) */
export const fmtSigned = n => !Number.isFinite(n) ? DASH : (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + nf0.format(Math.abs(n));

/** Pace in min:ss per km: 6:09 */
export function fmtPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return DASH;
  let m = Math.floor(secPerKm / 60), s = Math.round(secPerKm - m * 60);
  if (s === 60) { m++; s = 0; }
  return m + ':' + String(s).padStart(2, '0');
}

/** Duration as h:mm:ss or m:ss: 1:02:05, 26:10 */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return DASH;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

/** 25 Sep */
export const fmtDay = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
/** 25 Sep 2026 */
export const fmtDate = d => fmtDay(d) + ' ' + d.getFullYear();
/** 06:05 */
export const fmtTime = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

/** Escape text before inserting it into HTML */
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
