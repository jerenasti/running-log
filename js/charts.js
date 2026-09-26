// Shared Chart.js setup, so every chart in every tab looks the same.
// Colors are read from the CSS tokens, so charts follow light and dark mode.

const charts = {};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Current theme colors and fonts from css/tokens.css */
export function theme() {
  return {
    text: cssVar('--text'), text3: cssVar('--text-3'), bg: cssVar('--bg'),
    accent: cssVar('--accent'), bar: cssVar('--chart-bar'), line: cssVar('--chart-line'), grid: cssVar('--chart-grid'),
    warn: cssVar('--status-warn'), watch: cssVar('--status-watch'),
    sans: cssVar('--font-sans'), mono: cssVar('--font-mono'),
  };
}

/** Base options for a weekly chart. titleFn builds the tooltip title from the hovered item. */
export function baseOptions(t, titleFn) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduceMotion ? false : { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.text, titleColor: t.bg, bodyColor: t.bg,
        padding: 10, displayColors: false, cornerRadius: 6,
        titleFont: { family: t.sans, weight: '500' }, bodyFont: { family: t.mono },
        callbacks: { title: titleFn },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: t.grid },
           ticks: { color: t.text3, autoSkip: true, maxRotation: 0, font: { family: t.sans, size: 11 } } },
      y: { grid: { color: t.grid }, border: { display: false },
           ticks: { color: t.text3, font: { family: t.mono, size: 11 } } },
    },
  };
}

/** Create (or re-create) the chart on canvas #id */
export function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
  return charts[id];
}
