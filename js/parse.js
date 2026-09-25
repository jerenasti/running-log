// Turn text from CSV files and JSON into numbers and dates.
// Accepts both English (1,234.5) and Finnish (1 234,5) number formats.

export function parseNum(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/\s/g, '');
  if (!s || s === '--') return NaN;
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasC) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** "1:02:05" or "26:10" → seconds */
export function parseDuration(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(',', '.');
  if (!s || s === '--') return NaN;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) return NaN;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return NaN;
}

/** "2026-09-25 18:05", "25.9.2026 klo 18.05", "9/25/2026" → Date (local time) */
export function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(?:klo\s+)?(\d{1,2})[:.](\d{2}))?/);
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], m[1] - 1, +m[2]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
