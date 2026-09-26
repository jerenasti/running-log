// Training tab: key figures, weekly goal, weekly distance, pace and heart rate charts, activity table.

import { state, save } from '../state.js';
import { fmtKm, fmtInt, fmtPace, fmtDuration, fmtDay, fmtDate, esc, DASH } from '../format.js';
import { mondayOf, isoWeek, DAY_MS } from '../dates.js';
import { theme, baseOptions, drawChart } from '../charts.js';
import { renderReview, initReview } from './review.js';
import { renderLongRuns } from './longruns.js';
import { weeklyAverage } from '../metrics.js';

const RECENT_N = 10;
const $ = s => document.querySelector(s);
const isRun = a => !a.type || /run|juoks|treadmill|trail|polku/i.test(a.type);
// Training shows only activities with a distance (mobility etc. count only toward training load)
const hasDistance = a => a.km > 0;
const sportFilter = a => hasDistance(a) && (state.sport === 'all' || isRun(a));

/* ---------- Calculations ---------- */
function compute() {
  const acts = state.acts.filter(sportFilter);
  const last = state.acts.filter(hasDistance).pop().date;
  const now = new Date();
  // Show up to the current week, unless the data is old (then end at the last activity)
  const endMon = (now - last) / DAY_MS < 60 ? mondayOf(now) : mondayOf(last);
  let startMon;
  if (state.period === 'all') {
    startMon = acts.length ? mondayOf(acts[0].date) : endMon;
  } else {
    startMon = new Date(endMon); startMon.setDate(startMon.getDate() - 7 * (+state.period - 1));
  }
  const endDate = new Date(endMon); endDate.setDate(endDate.getDate() + 7);
  const inRange = acts.filter(a => a.date >= startMon && a.date < endDate);

  const weeks = [];
  for (let d = new Date(startMon); d <= endMon; d.setDate(d.getDate() + 7))
    weeks.push({ mon: new Date(d), km: 0, sec: 0, kmTimed: 0, n: 0, hrSum: 0, hrSec: 0 });
  for (const a of inRange) {
    const w = weeks[Math.round((mondayOf(a.date) - startMon) / (7 * DAY_MS))];
    if (!w) continue;
    w.km += a.km; w.n++;
    if (Number.isFinite(a.sec) && a.sec > 0) { w.sec += a.sec; w.kmTimed += a.km; }
    // Average HR is weighted by duration: HR × seconds, divided by total seconds at the end
    if (Number.isFinite(a.hr) && a.hr > 0 && Number.isFinite(a.sec) && a.sec > 0) { w.hrSum += a.hr * a.sec; w.hrSec += a.sec; }
  }
  const tot = inRange.reduce((s, a) => s + a.km, 0);
  const timed = inRange.filter(a => Number.isFinite(a.sec) && a.sec > 0);
  const tSec = timed.reduce((s, a) => s + a.sec, 0), tKm = timed.reduce((s, a) => s + a.km, 0);
  const longest = inRange.reduce((b, a) => (!b || a.km > b.km) ? a : b, null);
  return { inRange, weeks, tot, pace: tKm ? tSec / tKm : NaN, longest };
}

/* ---------- Rendering ---------- */
const kpi = (label, value, unit, sub) => `
  <div class="kpi"><div class="kpi-label">${label}</div>
  <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
  ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

function setSeg(id, v) {
  document.querySelectorAll('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
}

export function renderGoal() {
  const input = $('#goalInput'), bar = $('#goalBar'), text = $('#goalText');
  if (document.activeElement !== input) input.value = state.goal || '';
  const what = state.sport === 'run' ? 'running' : 'training';
  const thisMon = mondayOf(new Date()).getTime();
  const km = state.acts.filter(a => sportFilter(a) && mondayOf(a.date).getTime() === thisMon).reduce((s, a) => s + a.km, 0);

  if (!state.goal) {
    bar.hidden = true;
    text.textContent = 'This week: ' + fmtKm(km) + ' km of ' + what + '. Set a weekly distance goal to track your progress.';
    return;
  }
  const pct = Math.round(km / state.goal * 100);
  bar.hidden = false;
  bar.setAttribute('aria-valuenow', String(Math.min(pct, 100)));
  bar.firstElementChild.style.width = Math.min(pct, 100) + '%';
  text.textContent = 'This week: ' + fmtKm(km) + ' / ' + fmtKm(state.goal) + ' km of ' + what + ' (' + pct + '%). ' +
    (km >= state.goal ? 'Goal reached.' : fmtKm(state.goal - km) + ' km to go.');
}

function drawCharts(r) {
  const t = theme();
  const thisMon = mondayOf(new Date()).getTime();
  const labels = r.weeks.map(w => 'wk ' + isoWeek(w.mon));
  const tipTitle = items => {
    const w = r.weeks[items[0].dataIndex];
    const sun = new Date(w.mon); sun.setDate(sun.getDate() + 6);
    return 'Week ' + isoWeek(w.mon) + ' (' + fmtDay(w.mon) + ' – ' + fmtDate(sun) + ')';
  };
  const base = baseOptions(t, tipTitle);
  const lineStyle = { borderColor: t.line, backgroundColor: t.line, pointRadius: 2.5, pointHoverRadius: 5,
    pointHoverBackgroundColor: t.accent, borderWidth: 2, tension: .25, spanGaps: true };

  drawChart('weekChart', {
    type: 'bar',
    data: { labels, datasets: [
      { data: r.weeks.map(w => +w.km.toFixed(1)),
        backgroundColor: r.weeks.map(w => w.mon.getTime() === thisMon ? t.accent : t.bar),
        borderRadius: 3, maxBarThickness: 36 },
      // Weekly goal as a dashed line (only if a goal is set)
      ...(state.goal ? [{ type: 'line', data: r.weeks.map(() => state.goal), borderColor: t.text3, borderDash: [5, 4],
        borderWidth: 1.25, pointRadius: 0, pointHoverRadius: 0 }] : []),
    ] },
    options: { ...base,
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, filter: c => c.datasetIndex === 0,
        callbacks: { title: tipTitle, label: c => { const w = r.weeks[c.dataIndex]; return fmtKm(w.km) + ' km · ' + w.n + (w.n === 1 ? ' activity' : ' activities'); } } } },
      scales: { ...base.scales, y: { ...base.scales.y, beginAtZero: true, ticks: { ...base.scales.y.ticks, callback: v => v + ' km' } } } },
  });

  drawChart('paceChart', {
    type: 'line',
    data: { labels, datasets: [{ ...lineStyle, data: r.weeks.map(w => w.kmTimed > 0 ? w.sec / w.kmTimed : null) }] },
    options: { ...base,
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { title: tipTitle, label: c => fmtPace(c.parsed.y) + ' /km' } } },
      scales: { ...base.scales, y: { ...base.scales.y, reverse: true, ticks: { ...base.scales.y.ticks, callback: v => fmtPace(v) } } } },
  });

  drawChart('hrChart', {
    type: 'line',
    data: { labels, datasets: [{ ...lineStyle, data: r.weeks.map(w => w.hrSec > 0 ? Math.round(w.hrSum / w.hrSec) : null) }] },
    options: { ...base,
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { title: tipTitle, label: c => fmtInt(c.parsed.y) + ' bpm' } } },
      scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
  });
}

function renderTable(r) {
  // 10 most recent by default; "Show all" shows the whole selected range
  const rows = (state.showAll ? r.inRange.slice() : r.inRange.slice(-RECENT_N)).reverse();
  const hidden = r.inRange.length - RECENT_N;
  $('#recentSub').textContent = state.showAll || hidden <= 0 ? 'All activities in the selected range, newest first.' : RECENT_N + ' most recent activities.';
  $('#showAll').hidden = hidden <= 0;
  $('#showAll').textContent = state.showAll ? 'Show only the ' + RECENT_N + ' most recent' : 'Show all ' + r.inRange.length + ' activities';
  $('#recent').innerHTML = rows.length ? rows.map(a => `
    <tr><td class="num">${fmtDate(a.date)}</td><td class="title">${esc(a.title || a.type || DASH)}</td>
    <td class="num">${fmtKm(a.km)} km</td><td class="num">${fmtDuration(a.sec)}</td>
    <td class="num">${Number.isFinite(a.sec) ? fmtPace(a.sec / a.km) + ' /km' : DASH}</td>
    <td class="num">${fmtInt(a.hr)}</td></tr>`).join('')
    : '<tr><td colspan="6">No activities in the selected range. Choose a longer range.</td></tr>';
}

export function renderTraining() {
  const count = state.acts.filter(hasDistance).length;
  $('#empty').hidden = count > 0;
  $('#dash').hidden = count === 0;
  if (!count) return;

  setSeg('period', state.period);
  setSeg('sport', state.sport);
  $('#source').textContent = 'Garmin Connect · ' + count + ' activities';

  const r = compute();
  // Average only over finished weeks since the Garmin data starts (not empty weeks before it)
  const firstData = state.acts.reduce((m, a) => (!m || a.date < m ? a.date : m), null);
  const avg = weeklyAverage(r.weeks, firstData);
  $('#stats').innerHTML =
    kpi('Total distance', fmtKm(r.tot), 'km', avg.km != null
      ? `${fmtKm(avg.km)} km per week (${avg.weeks} finished ${avg.weeks === 1 ? 'week' : 'weeks'} with data)`
      : 'No finished week with data yet') +
    kpi(state.sport === 'run' ? 'Runs' : 'Activities', fmtInt(r.inRange.length)) +
    kpi('Average pace', fmtPace(r.pace), '/km') +
    kpi('Longest activity', r.longest ? fmtKm(r.longest.km) : DASH, 'km', r.longest ? fmtDate(r.longest.date) : '');

  renderGoal();
  drawCharts(r);
  renderTable(r);
  renderReview();
  renderLongRuns();
}

/* ---------- Events ---------- */
export function initTraining() {
  const onSeg = (id, key) => $('#' + id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state[key] = b.dataset.v; save(); renderTraining();
  });
  onSeg('period', 'period');
  onSeg('sport', 'sport');
  initReview();
  $('#showAll').addEventListener('click', () => { state.showAll = !state.showAll; renderTraining(); });
  // The bar updates while typing; the chart is redrawn only when the field loses focus (change)
  $('#goalInput').addEventListener('input', e => { state.goal = Math.max(0, Math.round(+e.target.value)) || 0; save(); renderGoal(); });
  $('#goalInput').addEventListener('change', renderTraining);
}
