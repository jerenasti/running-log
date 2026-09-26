// Shared chart theme: every chart in every tab takes its colors, fonts, axes, tooltips, legends,
// ranges and series styles from here, and these come from the design tokens (css/tokens.css),
// so charts follow light and dark mode.
//
// Series roles (use the helpers below instead of styling datasets by hand):
//   mainLine       the main measurement: solid --text line
//   secondaryLine  an average or a forecast: dashed --chart-line
//   points         single measurements as dots
//   band           a range (normal range, forecast range): --chart-band fill under the lines
//   bars           --chart-bar; the accent only for the one highlighted item (current week, goal, race day)
//   out of range   points in --status-warn

const charts = {};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const px = rem => parseFloat(rem) * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');

/** Current theme colors and fonts from css/tokens.css */
export function theme() {
  const t = {
    text: cssVar('--text'), text3: cssVar('--text-3'), bg: cssVar('--bg'), surface: cssVar('--surface'),
    accent: cssVar('--accent'), accentText: cssVar('--accent-text'),
    bar: cssVar('--chart-bar'), bar2: cssVar('--chart-bar-2'), line: cssVar('--chart-line'), grid: cssVar('--chart-grid'), axis: cssVar('--chart-axis'),
    band: cssVar('--chart-band'),
    tooltipBg: cssVar('--chart-tooltip-bg'), tooltipText: cssVar('--chart-tooltip-text'), tooltipMuted: cssVar('--chart-tooltip-muted'),
    warn: cssVar('--status-warn'), watch: cssVar('--status-watch'),
    sans: cssVar('--font-sans'), num: cssVar('--font-num'),
    small: px(cssVar('--fs-xs')) || 12,     // axis labels, legends
    body: px(cssVar('--fs-sm')) || 13,      // tooltips
    radius: parseFloat(cssVar('--radius-sm')) || 8,
  };
  // Anything a chart doesn't set itself still matches the app
  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = t.sans;
    Chart.defaults.font.size = t.small;
    Chart.defaults.color = t.axis;
  }
  return t;
}

/** How many date labels fit on the x axis: fewer on a phone so they don't run into each other */
export const xTickLimit = (wide = 8) => window.innerWidth < 600 ? Math.min(5, wide) : wide;

/** Base options for every chart. titleFn builds the tooltip title from the hovered item. */
export function baseOptions(t, titleFn) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduceMotion ? false : { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        // Every tooltip text has a color from the tokens (Chart.js would draw the footer white)
        backgroundColor: t.tooltipBg, titleColor: t.tooltipText, bodyColor: t.tooltipText, footerColor: t.tooltipMuted,
        padding: 10, displayColors: false, cornerRadius: t.radius, caretSize: 5,
        titleFont: { family: t.sans, size: t.body, weight: '600' },
        bodyFont: { family: t.num, size: t.body },
        footerFont: { family: t.num, size: t.small, weight: '400' },
        // Helper datasets (names starting with "_") never show in tooltips
        filter: c => !c.dataset.label?.startsWith('_') && c.parsed.y != null,
        callbacks: { title: titleFn },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: t.grid },
           ticks: { color: t.axis, autoSkip: true, maxRotation: 0, maxTicksLimit: xTickLimit(), font: { family: t.sans, size: t.small } } },
      y: { grid: { color: t.grid }, border: { display: false },
           ticks: { color: t.axis, font: { family: t.num, size: t.small } } },
    },
  };
}

/** Tooltip options with these callbacks (the title callback from baseOptions is kept) */
export const tooltip = (base, callbacks, extra = {}) =>
  ({ ...base.plugins.tooltip, ...extra, callbacks: { title: base.plugins.tooltip.callbacks.title, ...callbacks } });

/** The one legend style: below the chart, small point-style keys, helper datasets ("_…") hidden */
export const legend = t => ({
  display: true, position: 'bottom',
  labels: { color: t.axis, font: { family: t.sans, size: t.small }, usePointStyle: true, boxWidth: 14, boxHeight: 8, padding: 14,
    filter: item => !item.text.startsWith('_') },
});

/* ---------- Series styles ---------- */
// Chart.js draws datasets with a higher `order` first: ranges (order 10) stay under the lines.
const BAND_ORDER = 10;

/** The main measurement: a solid line in the text color */
export const mainLine = (t, extra = {}) => ({ borderColor: t.text, backgroundColor: t.text, borderWidth: 2,
  pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line', tension: .2, ...extra });

/** An average or a forecast: a thinner dashed line */
export const secondaryLine = (t, extra = {}) => ({ borderColor: t.line, backgroundColor: t.line, borderWidth: 1.5, borderDash: [5, 4],
  pointRadius: 0, pointHoverRadius: 3, pointStyle: 'line', tension: .2, ...extra });

/** Single measurements as dots */
export const points = (t, extra = {}) => ({ showLine: false, borderColor: t.text, backgroundColor: t.text,
  pointRadius: 3, pointHoverRadius: 5, pointStyle: 'circle', ...extra });

/** A shaded range: an invisible lower line and an upper line filled down to it */
export function band(t, low, high, label = 'Normal range') {
  return [
    { type: 'line', label: '_low', data: low, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, spanGaps: true, order: BAND_ORDER },
    { type: 'line', label, data: high, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '-1',
      backgroundColor: t.band, borderColor: t.band, pointStyle: 'rect', spanGaps: true, order: BAND_ORDER },
  ];
}

/** Create (or re-create) the chart on canvas #id */
export function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
  return charts[id];
}
