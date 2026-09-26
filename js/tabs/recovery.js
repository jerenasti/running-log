// Recovery tab: today's recommendation with every rule shown, key figures, 4-week HRV and resting HR trends
// with the personal normal range, and last night's sleep stages. The rules live in ../recovery.js.

import { state } from '../state.js';
import { assess, restingHrTrend, recoveryTrends, RULES } from '../recovery.js';
import { fmtInt, fmtRatio, fmtHm, fmtHClock, fmtDay, fmtDate, esc, DASH } from '../format.js';
import { theme, baseOptions, drawChart, legend, band, mainLine, secondaryLine, xTickLimit } from '../charts.js';
import { parseDate } from '../parse.js';
import { dayKey } from '../dates.js';

const $ = s => document.querySelector(s);
const STATUS = { hard: 'ok', easy: 'watch', rest: 'warn', unknown: 'none' };
const titleCase = s => s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '';

const kpi = (label, value, unit, sub) => `
  <div class="kpi"><div class="kpi-label">${label}</div>
  <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="kpi-sub">${sub}</div></div>`;

/* ---------- Recommendation and rules ---------- */
function valueText(c) {
  if (c.value === null || c.value === undefined || (typeof c.value === 'number' && !Number.isFinite(c.value))) return DASH;
  switch (c.id) {
    case 'hrv': return fmtInt(c.value) + ' ms';
    case 'rhr': return fmtInt(c.value) + ' bpm';
    case 'sleep': return 'score ' + fmtInt(c.value.score) + ', ' + fmtHm(c.value.duration_s);
    case 'bb': return fmtInt(c.value);
    case 'acwr': return fmtRatio(c.value);
    default: return fmtInt(c.value);
  }
}
const resultCell = met => met === null ? '<span class="muted">No data</span>'
  : met ? '<span class="status"><i class="dot st-warn"></i>Yes</span>' : '<span class="status"><i class="dot st-ok"></i>No</span>';

function ruleRows(title, checks) {
  return `<tr class="group"><th colspan="4">${title}</th></tr>` + checks.map(c => `
    <tr><td>${c.label}</td><td class="num">${valueText(c)}</td><td class="rule">${esc(c.rule)}</td><td>${resultCell(c.met)}</td></tr>`).join('');
}

function renderToday(a) {
  const r = a.recommendation;
  const night = fmtDate(parseDate(a.day));
  $('#recToday').innerHTML = `
    <div class="rec-head"><i class="dot big st-${STATUS[r.key]}"></i><h2 class="rec-label">${r.label}</h2></div>
    <p class="sub">Based on the night ending ${night} and your training load today.</p>
    <ul class="rec-why">${r.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
    ${a.attention ? `<p class="notice rec-attention">Attention: ${[a.recoveryChecks[0], a.recoveryChecks[1]].filter(c => c.met).map(c => c.label.toLowerCase()).join(' and ')} while ${a.loadChecks.filter(c => c.met).map(c => c.label.toLowerCase()).join(' and ')}. Recovery is lagging behind the load.</p>` : ''}
    <div class="table-wrap"><table class="rules">
      <thead><tr><th>Check</th><th class="num">Your value</th><th>Rule</th><th>Met</th></tr></thead>
      <tbody>${ruleRows('Recovery signals', a.recoveryChecks)}${ruleRows('Training load', a.loadChecks)}</tbody>
    </table></div>`;
}

function renderStats(a) {
  const h = a.hrv, s = a.sleep, b = a.bodyBattery;
  const n = a.rhrNormal;
  $('#recStats').innerHTML =
    kpi('HRV last night', h ? fmtInt(h.last_night) : DASH, 'ms', h ? `Normal ${h.baseline_low}–${h.baseline_high} · ${titleCase(h.status)}` : 'No data') +
    kpi('Resting HR', a.rhr ? fmtInt(a.rhr.bpm) : DASH, 'bpm', n ? `Normal ${Math.round(n.low)}–${Math.round(n.high)}` : 'Normal range needs 14 days') +
    kpi('Sleep', s ? fmtHClock(s.duration_s) : DASH, 'h', s ? `Score ${fmtInt(s.score)} · ${titleCase(s.quality)}` : 'No data') +
    kpi('Body Battery', b ? fmtInt(b.high) : DASH, '', "Day's high, after waking");
}

/* ---------- Charts ---------- */
// Ranges, legends and line styles come from the shared chart theme (js/charts.js)

function drawHrv(list) {
  const t = theme();
  const base = baseOptions(t, items => fmtDate(parseDate(list[items[0].dataIndex].date)));
  const out = list.map(h => h.last_night != null && h.baseline_low != null && h.last_night < h.baseline_low);
  drawChart('hrvChart', {
    type: 'line',
    data: { labels: list.map(h => fmtDay(parseDate(h.date))), datasets: [
      ...band(t, list.map(h => h.baseline_low), list.map(h => h.baseline_high)),
      { label: 'Last night', data: list.map(h => h.last_night), ...mainLine(t, { backgroundColor: out.map(o => o ? t.warn : t.text),
        pointBorderColor: out.map(o => o ? t.warn : t.text), pointRadius: 3, pointHoverRadius: 5, pointStyle: 'circle', spanGaps: true }) },
      { label: '7-day average', data: list.map(h => h.weekly_avg), ...secondaryLine(t, { spanGaps: true }) },
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t),
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label === 'Normal range'
            ? `Normal range: ${fmtInt(list[c.dataIndex].baseline_low)}–${fmtInt(list[c.dataIndex].baseline_high)} ms`
            : `${c.dataset.label}: ${fmtInt(c.parsed.y)} ms`,
        } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(7) } },
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
  });
}

function drawRhr(trend) {
  const t = theme();
  const base = baseOptions(t, items => fmtDate(trend[items[0].dataIndex].date));
  const out = trend.map(d => d.normal && d.bpm > d.normal.high);
  drawChart('rhrChart', {
    type: 'line',
    data: { labels: trend.map(d => fmtDay(d.date)), datasets: [
      ...band(t, trend.map(d => d.normal ? d.normal.low : null), trend.map(d => d.normal ? d.normal.high : null)),
      { label: 'Resting HR', data: trend.map(d => d.bpm), ...mainLine(t, { backgroundColor: out.map(o => o ? t.warn : t.text),
        pointBorderColor: out.map(o => o ? t.warn : t.text), pointRadius: 3, pointHoverRadius: 5, pointStyle: 'circle' }) },
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t),
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => { const d = trend[c.dataIndex];
            return c.dataset.label === 'Normal range'
              ? `Normal range: ${fmtInt(d.normal.low)}–${fmtInt(d.normal.high)} bpm`
              : `Resting HR: ${fmtInt(c.parsed.y)} bpm`; },
        } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(7) } },
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
  });
}

/* ---------- Sleep stages ---------- */
function renderSleep(s, day) {
  const el = $('#sleepStages');
  if (!s || !s.duration_s) { el.innerHTML = '<p class="hint">No sleep data for the latest night.</p>'; return; }
  const stages = [
    ['deep', 'Deep', s.deep_s], ['light', 'Light', s.light_s], ['rem', 'REM', s.rem_s], ['awake', 'Awake', s.awake_s],
  ].filter(x => x[2] > 0);
  const total = stages.reduce((sum, x) => sum + x[2], 0);
  el.innerHTML = `
    <p class="sub">Night ending ${fmtDate(parseDate(day))}: ${fmtHm(s.duration_s)} asleep, score ${fmtInt(s.score)}.</p>
    <div class="stages" role="img" aria-label="Sleep stages">${stages.map(([k, , v]) => `<span class="stage-${k}" style="width:${v / total * 100}%"></span>`).join('')}</div>
    <ul class="gauge-legend">${stages.map(([k, name, v]) => `<li><i class="dot stage-${k}"></i>${name} <span class="num">${fmtHm(v)}</span> <span class="muted">(${Math.round(v / total * 100)}%)</span></li>`).join('')}</ul>`;
}

/* ---------- Sleep and Body Battery trends ---------- */
function renderTrends(t) {
  const h = v => v == null ? DASH : fmtHClock(v * 3600) + ' h';
  const pct = v => v == null ? DASH : Math.round(v * 100) + '%';
  const s = t.sleep, b = t.bb;
  $('#sleepTrend').innerHTML = `
    <span>Last 7 nights <b class="num">${h(s.hours.week)}</b> · score <b class="num">${fmtInt(s.score.week)}</b> · deep <b class="num">${pct(s.deepShare.week)}</b></span>
    <span class="muted">4 weeks ${h(s.hours.month)} · score ${fmtInt(s.score.month)} · deep ${pct(s.deepShare.month)}</span>`;
  $('#bbTrend').innerHTML = `
    <span>Daily high, last 7 days <b class="num">${fmtInt(b.high.week)}</b> <span class="muted">(4 weeks ${fmtInt(b.high.month)})</span></span>
    <span>Daily low, last 7 days <b class="num">${fmtInt(b.low.week)}</b> <span class="muted">(4 weeks ${fmtInt(b.low.month)})</span></span>`;
}

function drawSleep(list) {
  const t = theme();
  const hours = key => list.map(s => (s[key] || 0) / 3600);
  const base = baseOptions(t, items => fmtDate(parseDate(list[items[0].dataIndex].date)));
  const stage = (label, key, color) => ({ type: 'bar', label, data: hours(key), backgroundColor: color, stack: 'sleep', maxBarThickness: 22, order: 2 });
  drawChart('sleepChart', {
    type: 'bar',
    data: { labels: list.map(s => fmtDay(parseDate(s.date))), datasets: [
      // Neutral ramp, same as .stage-* in components.css: deep darkest, awake lightest
      stage('Deep', 'deep_s', t.text), stage('Light', 'light_s', t.bar2), stage('REM', 'rem_s', t.line), stage('Awake', 'awake_s', t.bar),
      { type: 'line', label: 'Sleep score', data: list.map(s => s.score ?? null), yAxisID: 'y1', ...secondaryLine(t, { pointRadius: 2, spanGaps: true, order: 1 }) },
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t), tooltip: { ...base.plugins.tooltip, callbacks: {
        title: base.plugins.tooltip.callbacks.title,
        label: c => c.dataset.yAxisID === 'y1' ? `Score: ${fmtInt(c.parsed.y)}` : `${c.dataset.label}: ${fmtHm(c.parsed.y * 3600)}`,
        footer: items => 'Asleep: ' + fmtHm(list[items[0].dataIndex].duration_s),
      } } },
      scales: {
        x: { ...base.scales.x, stacked: true, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(10) } },
        y: { ...base.scales.y, stacked: true, beginAtZero: true, ticks: { ...base.scales.y.ticks, callback: v => v + ' h' } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, border: { display: false },
              ticks: { ...base.scales.y.ticks, stepSize: 25 } },
      } },
  });
}

function drawBodyBattery(list) {
  const t = theme();
  const todayKey = dayKey(new Date());
  const base = baseOptions(t, items => fmtDate(parseDate(list[items[0].dataIndex].date)) + (list[items[0].dataIndex].date === todayKey ? ' (so far)' : ''));
  drawChart('bbChart', {
    type: 'bar',
    data: { labels: list.map(b => fmtDay(parseDate(b.date))), datasets: [{
      label: 'Body Battery', data: list.map(b => b.low != null && b.high != null ? [b.low, b.high] : null),
      backgroundColor: list.map(b => b.date === todayKey ? t.bar : t.line), borderRadius: t.radius / 2, maxBarThickness: 18,
    }] },
    options: { ...base,
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: {
        title: base.plugins.tooltip.callbacks.title,
        label: c => { const b = list[c.dataIndex]; return [`High ${fmtInt(b.high)} · low ${fmtInt(b.low)}`, `Charged +${fmtInt(b.charged)} · drained −${fmtInt(b.drained)}`]; },
      } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(10) } },
        y: { ...base.scales.y, min: 0, max: 100, ticks: { ...base.scales.y.ticks, stepSize: 25 } } } },
  });
}

/* ---------- Tab ---------- */
export function renderRecovery() {
  const rec = state.meta?.recovery;
  const has = rec && (rec.hrv?.length || rec.sleep?.length);
  $('#recNoData').hidden = !!has;
  $('#recDash').hidden = !has;
  if (!has) return;

  const a = assess(state.acts, state.meta);
  renderToday(a);
  renderStats(a);
  drawHrv(rec.hrv || []);
  drawRhr(restingHrTrend(state.meta.restingHr, RULES.normalDays));
  renderSleep(a.sleep, a.day);
  renderTrends(recoveryTrends(rec));
  drawSleep(rec.sleep || []);
  drawBodyBattery(rec.body_battery || []);
}
