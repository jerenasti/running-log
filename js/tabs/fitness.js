// Fitness and load tab: fitness/fatigue/form (CTL/ATL/TSB), ACWR gauge and aerobic efficiency of easy runs.
// The formulas live in ../metrics.js; this file only draws them.

import { state } from '../state.js';
import { loadModel, acwr, efficiencySeries, ACWR_ZONES, MIN_RELIABLE_DAYS, CTL_DAYS, ATL_DAYS, EF_WINDOW } from '../metrics.js';
import { fmtInt, fmtRatio, fmtDec1, fmtSigned, fmtDay, fmtDate, fmtPace, fmtDuration, esc, paceLabel, fmtWorkout } from '../format.js';
import { theme, baseOptions, drawChart, legend, mainLine, secondaryLine, points, xTickLimit } from '../charts.js';
import { danielsPaces, runnaPaces, runnaVdot, PACE_SHARES } from '../paces.js';
import { calibration, timeTrials, raceResults, vdot, parseTime, timeForVdot } from '../forecast.js';
import { parseDate } from '../parse.js';
import { addDays } from '../dates.js';
import { easyRule } from '../settings.js';
import { describeWorkout, planTitles } from '../workouts.js';

const $ = s => document.querySelector(s);
const CHART_DAYS = 180;  // load chart shows at most the last ~6 months
const GAUGE_MAX = 2;     // ACWR gauge runs from 0 to 2.0

const kpi = (label, value, sub) => `
  <div class="kpi"><div class="kpi-label">${label}</div>
  <div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;

function formLabel(tsb) {
  if (tsb < -5) return 'Carrying fatigue';
  if (tsb > 5) return 'Fresh';
  return 'Balanced';
}

/* ---------- ACWR gauge ---------- */
function renderAcwr(r, nDays) {
  const el = $('#acwr');
  if (!r) {
    el.innerHTML = `<p class="hint">Needs 28 days of heart rate data. You have ${nDays}.</p>`;
    return;
  }
  let from = 0;
  const segments = ACWR_ZONES.map(z => {
    const to = Math.min(z.max, GAUGE_MAX), width = (to - from) / GAUGE_MAX * 100;
    from = to;
    return `<span class="st-${z.key}" style="width:${width}%"></span>`;
  }).join('');
  const pos = Math.min(r.ratio, GAUGE_MAX) / GAUGE_MAX * 100;
  const ticks = ['0', '0.8', '1.3', '1.5', '2.0'];

  el.innerHTML = `
    <div class="acwr-head">
      <span class="acwr-value">${fmtRatio(r.ratio)}</span>
      <span class="status"><i class="dot st-${r.zone.key}"></i>${r.zone.label}</span>
    </div>
    <div class="gauge" role="img" aria-label="ACWR ${fmtRatio(r.ratio)}: ${r.zone.label}">
      <div class="gauge-track">${segments}</div>
      <div class="gauge-marker" style="left:${pos}%"></div>
    </div>
    <div class="gauge-scale num">${ticks.map(t => `<span style="left:${+t / GAUGE_MAX * 100}%">${t}</span>`).join('')}</div>
    <ul class="gauge-legend">
      <li><i class="dot st-under"></i>Underload &lt; 0.8</li>
      <li><i class="dot st-ok"></i>Safe 0.8–1.3</li>
      <li><i class="dot st-watch"></i>Watch 1.3–1.5</li>
      <li><i class="dot st-warn"></i>Warning &gt; 1.5</li>
    </ul>
    <p class="acwr-detail">Average daily load: last 7 days <span class="num">${fmtInt(r.acute)}</span> · last 28 days <span class="num">${fmtInt(r.chronic)}</span></p>`;
}

/* ---------- Charts ---------- */
function drawLoadChart(days) {
  const t = theme();
  const shown = days.slice(-CHART_DAYS);
  const base = baseOptions(t, items => fmtDate(shown[items[0].dataIndex].date));
  drawChart('loadChart', {
    type: 'bar',
    data: {
      labels: shown.map(d => fmtDay(d.date)),
      datasets: [
        { type: 'line', label: 'Fitness (CTL)', data: shown.map(d => d.ctl), ...mainLine(t, { order: 1 }) },
        { type: 'line', label: 'Fatigue (ATL)', data: shown.map(d => d.atl), ...secondaryLine(t, { order: 2 }) },
        { type: 'bar', label: 'Form (TSB)', data: shown.map(d => d.tsb), backgroundColor: t.bar, borderRadius: t.radius / 4, pointStyle: 'rect', order: 3 },
      ],
    },
    options: { ...base,
      plugins: { ...base.plugins,
        legend: legend(t),
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label + ': ' + (c.datasetIndex === 2 ? fmtSigned(c.parsed.y) : fmtInt(c.parsed.y)),
          footer: items => 'Load that day: ' + fmtInt(shown[items[0].dataIndex].load),
        } } },
      scales: { ...base.scales,
        x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(8) } },
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
  });
}

function drawEfficiencyChart(runs) {
  const t = theme();
  $('#efWrap').hidden = !runs.length;
  $('#efEmpty').hidden = runs.length > 0;
  if (!runs.length) return;
  const base = baseOptions(t, items => fmtDate(runs[items[0].dataIndex].act.date));
  drawChart('efChart', {
    type: 'line',
    data: {
      labels: runs.map(r => fmtDay(r.act.date)),
      datasets: [
        { label: 'Easy run', data: runs.map(r => r.index), ...points(t, { borderColor: t.line, backgroundColor: t.line }) },
        { label: `${EF_WINDOW}-run average`, data: runs.map(r => r.avgIndex), ...mainLine(t, { tension: .25 }) },
        // 100 = the first 4 weeks: a thin reference line, not in the tooltip
        { label: '_first 4 weeks', data: runs.map(() => 100), ...secondaryLine(t, { borderColor: t.bar2, borderWidth: 1, pointHoverRadius: 0, tension: 0 }) },
      ],
    },
    options: { ...base,
      plugins: { ...base.plugins,
        legend: legend(t),
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label + ': ' + fmtInt(c.parsed.y),
          footer: items => { const a = runs[items[0].dataIndex].act; return fmtPace(a.sec / a.km) + ' ' + paceLabel() + ' · ' + fmtInt(a.hr) + ' bpm'; },
        } } },
      scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
  });
}

function renderEasyList(runs) {
  $('#easyList').innerHTML = `<summary>Runs counted as easy (${runs.length})</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Run</th><th class="num">Time</th><th class="num">Pace</th><th class="num">Avg HR</th><th class="num">Index</th></tr></thead>
      <tbody>${runs.slice().reverse().map(({ act: a, ef, index }) => `
        <tr><td class="num">${fmtDate(a.date)}</td><td class="title">${fmtWorkout(describeWorkout(a, planTitles(state.meta?.schedule).get(a.workoutId)))}</td>
        <td class="num">${fmtDuration(a.sec)}</td><td class="num">${fmtPace(a.sec / a.km)} ${paceLabel()}</td>
        <td class="num">${fmtInt(a.hr)}</td><td class="num" title="Efficiency ${fmtRatio(ef)} m/min per bpm">${fmtInt(index)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

/* ---------- Tab ---------- */
/* ---------- Training paces ---------- */
function renderPaces() {
  const meta = state.meta || {};
  const vo2 = (meta.vo2max || []).at(-1);
  const races = state.content?.races?.data?.races || [];
  const goal = races.filter(r => r.goal && parseDate(r.date) >= new Date()).sort((a, b) => a.date.localeCompare(b.date))[0];
  const cal = calibration([...timeTrials(state.acts), ...raceResults(races)], meta.vo2max);
  const runna = runnaPaces((meta.schedule || []).filter(w => parseDate(w.date) >= addDays(new Date(), -14)));
  const rv = runnaVdot(runna);
  const runnaV = Object.values(rv).length ? Object.values(rv).reduce((a, b) => a + b, 0) / Object.values(rv).length : null;

  // One column per VDOT source that is available
  const cols = [
    vo2 && { label: 'Garmin VO2max', vdot: vo2.vo2max, note: 'uncalibrated' },
    vo2 && cal.results.length && { label: 'Time trials', vdot: vo2.vo2max * cal.factor, note: 'calibrated' },
    runnaV && { label: 'Runna plan', vdot: runnaV, note: 'from its paces' },
    goal && { label: `Goal ${esc(goal.goal)}`, vdot: vdot(goal.distance_km * 1000, parseTime(goal.goal)), note: 'needed' },
  ].filter(Boolean).map(c => ({ ...c, paces: danielsPaces(c.vdot) }));

  const range = ([fast, slow]) => Math.round(fast) === Math.round(slow) ? fmtPace(fast) : `${fmtPace(fast)}–${fmtPace(slow)}`;
  // What Runna prescribes for each kind of pace: a limit ("no faster than") or the range of targets
  const prescribed = kind => {
    const list = runna.filter(p => p.kind === kind);
    if (!list.length) return '–';
    const limits = list.filter(p => p.limit), targets = list.filter(p => !p.limit).map(p => p.sec);
    return [limits.length ? `not faster than ${fmtPace(Math.min(...limits.map(p => p.sec)))}` : '',
            targets.length ? range([Math.min(...targets), Math.max(...targets)]) : ''].filter(Boolean).join(', ');
  };

  $('#pacesTable').innerHTML = cols.length ? `
    <thead><tr><th>Pace (${paceLabel()})</th>${cols.map(c => `<th class="num">${c.label}<br><span class="muted">VDOT ${fmtDec1(c.vdot)} · ${c.note}</span></th>`).join('')}<th>Runna prescribes</th></tr></thead>
    <tbody>${Object.entries(PACE_SHARES).map(([k, p]) => `
      <tr><td>${p.label}<br><span class="muted">${p.use}</span></td>${cols.map(c => `<td class="num">${range(c.paces[k])}</td>`).join('')}<td class="num">${prescribed(k)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="hint">No VO2max, Runna paces or goal yet.</td></tr></tbody>';

  $('#pacesNote').textContent = runnaV
    ? `Your Runna paces correspond to VDOT ${fmtDec1(runnaV)}, a ${fmtDuration(timeForVdot(runnaV))} marathon by Daniels' formula` +
      (goal ? `; the goal ${goal.goal} needs ${fmtDec1(vdot(goal.distance_km * 1000, parseTime(goal.goal)))}.` : '.') +
      (vo2 && !cal.results.length ? ` Garmin's VO2max (${vo2.vo2max}) gives paces that are faster than what Runna asks for.` : '')
    : 'No paces found in your Runna workout descriptions yet.';
}

export function renderFitness() {
  const hasZones = state.acts.some(a => a.zones);
  $('#fitNoData').hidden = hasZones;
  $('#fitDash').hidden = !hasZones;
  if (!hasZones) return;

  const hr = state.meta?.hrSettings;
  const rule = easyRule(state.settings, state.meta);
  const days = loadModel(state.acts);
  const today = days[days.length - 1];
  const runs = efficiencySeries(state.acts, rule);

  // Warn while there is less than 6 weeks of data: CTL starts from zero and needs time to build up
  const short = days.length < MIN_RELIABLE_DAYS;
  $('#fitShort').hidden = !short;
  if (short) {
    $('#fitShort').textContent = `Only ${days.length} days of heart rate data (since ${fmtDate(days[0].date)}). ` +
      `Fitness (CTL) is a ${CTL_DAYS}-day average that starts from zero, so it reads too low until you have at least 6 weeks of data ` +
      `(${MIN_RELIABLE_DAYS - days.length} more days). Form and the workload ratio depend on it too.`;
  }

  $('#fitStats').innerHTML =
    kpi('Fitness (CTL)', fmtInt(today.ctl), `${CTL_DAYS}-day load average`) +
    kpi('Fatigue (ATL)', fmtInt(today.atl), `${ATL_DAYS}-day load average`) +
    kpi('Form (TSB)', fmtSigned(today.tsb), formLabel(today.tsb)) +
    kpi('Aerobic efficiency', runs.length ? fmtInt(runs[runs.length - 1].avgIndex) : '–',
      runs.length ? `Index, first 4 weeks = 100 · last ${Math.min(EF_WINDOW, runs.length)} easy runs` : 'No easy runs yet');

  renderAcwr(acwr(days), days.length);
  drawLoadChart(days);
  drawEfficiencyChart(runs);
  renderEasyList(runs);
  renderPaces();

  const rhr = state.meta?.restingHr || [];
  const lastRhr = rhr[rhr.length - 1];
  $('#hrInfo').textContent = [
    hr ? `Heart rate zones ${hr.source === 'manual' ? 'from your max HR in Settings' : 'from Garmin'}: max ${hr.max_hr} bpm, zones start at ${hr.zone_floors.join(' / ')} bpm.` : 'Heart rate zone settings not available.',
    state.meta?.restingHrManual ? `Resting heart rate ${state.meta.restingHrManual} bpm (entered in Settings).`
      : lastRhr ? `Resting heart rate ${lastRhr.bpm} bpm (${fmtDate(new Date(lastRhr.date + 'T00:00'))}).` : '',
    rule.words ? `Easy run words: ${rule.words.join(', ')}.` : '',
    rule.hrLimit ? `Easy run limit: average HR below ${rule.hrLimit} bpm (${rule.hrSource === 'settings' ? 'your limit' : 'zone 4'}).` : '',
  ].join(' ');
}
