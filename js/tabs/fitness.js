// Fitness and load tab: fitness/fatigue/form (CTL/ATL/TSB), ACWR gauge and aerobic efficiency of easy runs.
// The formulas live in ../metrics.js; this file only draws them.

import { state } from '../state.js';
import { loadModel, acwr, efficiencySeries, ACWR_ZONES, MIN_RELIABLE_DAYS, CTL_DAYS, ATL_DAYS, EF_WINDOW } from '../metrics.js';
import { fmtInt, fmtRatio, fmtSigned, fmtDay, fmtDate, fmtPace, fmtDuration, esc } from '../format.js';
import { theme, baseOptions, drawChart } from '../charts.js';

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
        { type: 'line', label: 'Fitness (CTL)', data: shown.map(d => d.ctl), borderColor: t.text, backgroundColor: t.text,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line', tension: .2, order: 1 },
        { type: 'line', label: 'Fatigue (ATL)', data: shown.map(d => d.atl), borderColor: t.line, backgroundColor: t.line,
          borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line', tension: .2, order: 2 },
        { type: 'bar', label: 'Form (TSB)', data: shown.map(d => d.tsb), backgroundColor: t.bar, borderRadius: 2, pointStyle: 'rect', order: 3 },
      ],
    },
    options: { ...base,
      plugins: { ...base.plugins,
        legend: { display: true, position: 'bottom',
          labels: { color: t.text3, font: { family: t.sans, size: 11 }, usePointStyle: true, boxWidth: 14, boxHeight: 8, padding: 14 } },
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label + ': ' + (c.datasetIndex === 2 ? fmtSigned(c.parsed.y) : fmtInt(c.parsed.y)),
          footer: items => 'Load that day: ' + fmtInt(shown[items[0].dataIndex].load),
        }, footerFont: { family: t.mono, weight: '400' } } },
      scales: { ...base.scales,
        x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 8 } },
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
        { label: 'Easy run', data: runs.map(r => r.ef), showLine: false, pointRadius: 3.5, pointHoverRadius: 5,
          borderColor: t.text3, backgroundColor: t.text3 },
        { label: `${EF_WINDOW}-run average`, data: runs.map(r => r.avg), borderColor: t.text, backgroundColor: t.text,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line', tension: .25 },
      ],
    },
    options: { ...base,
      plugins: { ...base.plugins,
        legend: { display: true, position: 'bottom',
          labels: { color: t.text3, font: { family: t.sans, size: 11 }, usePointStyle: true, boxWidth: 14, boxHeight: 8, padding: 14 } },
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label + ': ' + fmtRatio(c.parsed.y),
          footer: items => { const a = runs[items[0].dataIndex].act; return fmtPace(a.sec / a.km) + ' /km · ' + fmtInt(a.hr) + ' bpm'; },
        }, footerFont: { family: t.mono, weight: '400' } } },
      scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtRatio(v) } } } },
  });
}

function renderEasyList(runs) {
  $('#easyList').innerHTML = `<summary>Runs counted as easy (${runs.length})</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Run</th><th class="num">Time</th><th class="num">Pace</th><th class="num">Avg HR</th><th class="num">Efficiency</th></tr></thead>
      <tbody>${runs.slice().reverse().map(({ act: a, ef }) => `
        <tr><td class="num">${fmtDate(a.date)}</td><td class="title">${esc(a.title || a.type)}</td>
        <td class="num">${fmtDuration(a.sec)}</td><td class="num">${fmtPace(a.sec / a.km)} /km</td>
        <td class="num">${fmtInt(a.hr)}</td><td class="num">${fmtRatio(ef)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

/* ---------- Tab ---------- */
export function renderFitness() {
  const hasZones = state.acts.some(a => a.zones);
  $('#fitNoData').hidden = hasZones;
  $('#fitDash').hidden = !hasZones;
  if (!hasZones) return;

  const hr = state.meta?.hrSettings;
  const zone4Floor = hr?.zone_floors?.[3] ?? null;
  const days = loadModel(state.acts);
  const today = days[days.length - 1];
  const runs = efficiencySeries(state.acts, zone4Floor);

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
    kpi('Aerobic efficiency', runs.length ? fmtRatio(runs[runs.length - 1].avg) : '–',
      runs.length ? `Average of last ${Math.min(EF_WINDOW, runs.length)} easy runs` : 'No easy runs yet');

  renderAcwr(acwr(days), days.length);
  drawLoadChart(days);
  drawEfficiencyChart(runs);
  renderEasyList(runs);

  const rhr = state.meta?.restingHr || [];
  const lastRhr = rhr[rhr.length - 1];
  $('#hrInfo').textContent = [
    hr ? `Heart rate zones from Garmin: max ${hr.max_hr} bpm, zones start at ${hr.zone_floors.join(' / ')} bpm.` : 'Heart rate zone settings not available.',
    lastRhr ? `Resting heart rate ${lastRhr.bpm} bpm (${fmtDate(new Date(lastRhr.date + 'T00:00'))}).` : '',
  ].join(' ');
}
