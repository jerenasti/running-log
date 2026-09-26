// Overview tab (front page): today's status, key figures with sparklines, attention list, food tip,
// countdowns, and the VO2max and marathon forecasts. It reuses the other tabs' logic files and
// ../forecast.js, so no calculation is written twice.

import { state } from '../state.js';
import { assess } from '../recovery.js';
import { loadModel, acwr, acwrSeries, MIN_RELIABLE_DAYS } from '../metrics.js';
import { classify, plannedWorkouts, activeRace, dayType, pickMeals, recoveryAdvice, TOMORROW_TIPS, DAY_TARGETS, LONG_MINUTES, FUELING } from '../nutrition.js';
import { vo2Forecast, marathonForecast, garminPredictions, chooseCalibration, timeTrials, raceResults, vdot, timeForVdot, parseTime } from '../forecast.js';
import { fmtKm, fmtInt, fmtRatio, fmtDec1, fmtSigned, fmtDay, fmtDate, fmtDuration, fmtHm, fmtGrams, fmtWeekday, esc } from '../format.js';
import { mondayOf, dayKey, startOfDay, addDays, daysBetween } from '../dates.js';
import { parseDate } from '../parse.js';
import { theme, baseOptions, drawChart } from '../charts.js';
import { weekReview } from '../plan.js';
import { runnaPaces, runnaVdot } from '../paces.js';
import { longRunOutlook, weeklyLongRuns, LONG_RUN } from '../longruns.js';

const $ = s => document.querySelector(s);
const STATUS = { hard: 'ok', easy: 'watch', rest: 'warn', unknown: 'none' };
const isRun = a => /run|juoks|treadmill|trail/i.test(a.type || '');
const daysUntil = d => daysBetween(new Date(), d);
const titleCase = s => s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '';

/* ---------- Sparkline: a tiny line chart as inline SVG ---------- */
function sparkline(values) {
  const v = values.map((y, x) => ({ x, y })).filter(p => Number.isFinite(p.y));
  if (v.length < 2) return '';
  const W = 100, H = 28, xs = values.length - 1 || 1;
  const min = Math.min(...v.map(p => p.y)), max = Math.max(...v.map(p => p.y)), span = max - min || 1;
  const pts = v.map(p => `${(p.x / xs * W).toFixed(1)},${(H - 2 - (p.y - min) / span * (H - 4)).toFixed(1)}`).join(' ');
  const last = pts.split(' ').pop().split(',');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.2" class="spark-dot"/></svg>`;
}

const kpiLink = (tab, label, value, unit, sub, spark) => `
  <a class="kpi kpi-link" href="#${tab}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
    <div class="kpi-sub">${sub}</div>${spark}</a>`;

/* ---------- Part 1: today, key figures, attention, food, countdown ---------- */
function renderToday(a) {
  const r = a.recommendation;
  const h = a.hrv, s = a.sleep;
  const basis = [
    h ? `HRV ${fmtInt(h.last_night)} ms (normal ${h.baseline_low}–${h.baseline_high})` : null,
    a.rhr ? `resting HR ${fmtInt(a.rhr.bpm)}` : null,
    s ? `sleep ${fmtHm(s.duration_s)}, score ${fmtInt(s.score)}` : null,
    a.loadChecks[0].value != null ? `load ${a.loadHigh ? 'high' : 'normal'} (ACWR ${fmtRatio(a.loadChecks[0].value)})` : null,
  ].filter(Boolean).join(' · ');
  $('#ovToday').innerHTML = `
    <div class="rec-head"><i class="dot big st-${STATUS[r.key]}"></i><h2 class="rec-label">${r.label}</h2>
      <a class="more-link" href="#recovery">Recovery details</a></div>
    <p class="sub">${esc(r.why.join(' '))}</p>
    <p class="basis num">${basis}</p>`;
}

function weeklyKm(acts, weeks) {
  const thisMon = mondayOf(new Date());
  return Array.from({ length: weeks }, (_, i) => {
    const mon = new Date(thisMon); mon.setDate(mon.getDate() - 7 * (weeks - 1 - i));
    const end = new Date(mon); end.setDate(end.getDate() + 7);
    return acts.filter(x => isRun(x) && x.date >= mon && x.date < end).reduce((s, x) => s + x.km, 0);
  });
}

function renderKpis(ctx) {
  const { acts, days, meta } = ctx;
  const weeks = weeklyKm(acts, 8);
  const [last, now] = weeks.slice(-2);
  const ratio = acwr(days);
  const hrv = meta?.recovery?.hrv || [];
  const lastHrv = hrv[hrv.length - 1];
  const ctl = days.map(d => d.ctl);
  const ctlNow = ctl[ctl.length - 1], ctlWeekAgo = ctl[ctl.length - 8];
  $('#ovKpis').innerHTML =
    kpiLink('training', 'Running this week', fmtKm(now), 'km', `Last week ${fmtKm(last)} km`, sparkline(weeks)) +
    kpiLink('fitness', 'Workload ratio (ACWR)', ratio ? fmtRatio(ratio.ratio) : '–', '',
      ratio ? `<i class="dot st-${ratio.zone.key}"></i> ${ratio.zone.label}` : 'Needs 28 days', sparkline(acwrSeries(days, 28).map(d => d.ratio))) +
    kpiLink('recovery', 'HRV last night', lastHrv ? fmtInt(lastHrv.last_night) : '–', 'ms',
      lastHrv ? titleCase(lastHrv.status) + ` · ${fmtDay(parseDate(lastHrv.date))}` : 'No data', sparkline(hrv.map(h => h.last_night))) +
    kpiLink('fitness', 'Fitness (CTL)', Number.isFinite(ctlNow) ? fmtInt(ctlNow) : '–', '',
      Number.isFinite(ctlWeekAgo) ? `${fmtSigned(ctlNow - ctlWeekAgo)} in 7 days` : 'Building up', sparkline(ctl.slice(-42)));
}

function renderAttention(items) {
  const order = { warn: 0, watch: 1, info: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  $('#ovAttention').innerHTML = items.length
    ? `<ul class="attention">${items.map(i => `<li><i class="dot st-${i.level === 'info' ? 'none' : i.level}"></i><span>${i.text}</span>
        ${i.tab ? `<a class="more-link" href="#${i.tab}">${i.tabLabel}</a>` : ''}</li>`).join('')}</ul>`
    : '<p class="hint">Nothing needs your attention today.</p>';
}

function renderFood(ctx) {
  const { acts, planned, race, meals, kg } = ctx;
  const todayKey = dayKey(new Date());
  const doneToday = acts.filter(a => isRun(a) && dayKey(a.date) === todayKey).pop();
  let head, text, list;
  if (doneToday) {
    const type = classify({ type: doneToday.type, title: doneToday.title, minutes: doneToday.sec / 60, teLabel: doneToday.teLabel });
    head = `After today's run: ${esc(doneToday.title || 'run')}`;
    text = recoveryAdvice(type, kg, fmtGrams);
    list = pickMeals(meals, type, 'recovery', 2, todayKey).map(m => ({ m, slot: 'After the run' }));
  } else {
    const date = new Date(); date.setDate(date.getDate() + 1);
    const dt = dayType(date, { acts: [], planned, race });
    head = `Tomorrow: ${DAY_TARGETS[dt.type].label.toLowerCase()}${dt.plan ? ' · ' + esc(dt.plan.title) : ''}`;
    text = TOMORROW_TIPS[dt.type];
    list = [...pickMeals(meals, dt.type, 'dinner', 1, 'eve' + dayKey(date)).map(m => ({ m, slot: 'Dinner tonight' })),
            ...pickMeals(meals, dt.type, 'breakfast', 1, dayKey(date)).map(m => ({ m, slot: 'Breakfast' }))];
  }
  $('#ovFood').innerHTML = `
    <div class="card-head"><div><h2>Food tip</h2><p class="sub">${head}</p></div><a class="more-link" href="#nutrition">Nutrition</a></div>
    <p class="tip">${text}</p>
    <ul class="meals">${list.map(({ m, slot }) => `<li><span class="slot">${slot}</span><div class="meal-body"><span class="meal-name">${esc(m.name)}</span></div></li>`).join('')}</ul>`;
}

function renderCountdown(goalRace, testRace) {
  const row = (label, r) => {
    if (!r) return `<div class="countdown"><div class="kpi-label">${label}</div><p class="hint">No ${label.toLowerCase()} in content/races.json yet.</p></div>`;
    const d = daysUntil(r.day);
    return `<div class="countdown"><div class="kpi-label">${label}</div>
      <div class="kpi-value">${d}<span class="unit">days</span></div>
      <div class="kpi-sub">${esc(r.name)} · ${fmtDate(r.day)}${r.goal ? ` · goal ${esc(r.goal)}` : ''}${d > 13 ? ` · ${Math.floor(d / 7)} weeks` : ''}</div></div>`;
  };
  $('#ovCountdown').innerHTML = `<div class="card-head"><h2>Countdown</h2></div>${row('Next test run', testRace)}${row('Marathon', goalRace)}`;
}

/* ---------- Part 2 and 3: forecasts ---------- */
// Dashed vertical line with a label, e.g. at race day
const markerPlugin = (index, color, label, font) => ({
  id: 'marker',
  afterDatasetsDraw(chart) {
    if (index < 0) return;
    const x = chart.scales.x.getPixelForValue(index), { top, bottom } = chart.chartArea, c = chart.ctx;
    c.save(); c.strokeStyle = color; c.fillStyle = color; c.setLineDash([3, 3]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
    c.font = `11px ${font}`; c.textAlign = 'right'; c.fillText(label, x - 4, top + 11); c.restore();
  },
});
// Fewer date labels on a narrow screen, so they don't run into each other
const xTicks = () => window.innerWidth < 600 ? 4 : 8;
const legend = t => ({ display: true, position: 'bottom',
  labels: { color: t.text3, font: { family: t.sans, size: 11 }, usePointStyle: true, boxWidth: 14, boxHeight: 8, padding: 12, filter: i => !i.text.startsWith('_') } });
const band = (t, lo, hi, label) => [
  { label: '_lo', data: lo, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 10 },
  { label, data: hi, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '-1', backgroundColor: t.bar + '80', pointStyle: 'rect', order: 10 },
];

function drawVo2(fc) {
  const t = theme();
  const s = fc.series, measured = new Map(fc.history.map(h => [dayKey(h.date), h.y]));
  const base = baseOptions(t, items => fmtDate(s[items[0].dataIndex].date));
  drawChart('vo2Chart', {
    type: 'line',
    data: { labels: s.map(p => fmtDay(p.date)), datasets: [
      ...band(t, s.map(p => p.lo), s.map(p => p.hi), '80% range'),
      { label: 'Forecast', data: s.map(p => p.mid), borderColor: t.line, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, pointStyle: 'line' },
      { label: 'Garmin VO2max', data: s.map(p => measured.get(dayKey(p.date)) ?? null), showLine: false, pointRadius: 3, pointHoverRadius: 5,
        borderColor: t.text, backgroundColor: t.text, pointStyle: 'circle' },
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t), tooltip: { ...base.plugins.tooltip, filter: c => c.dataset.label !== '_lo' && c.parsed.y != null,
        callbacks: { title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label === '80% range' ? `80% range: ${fmtKm(s[c.dataIndex].lo)}–${fmtKm(s[c.dataIndex].hi)}` : `${c.dataset.label}: ${fmtKm(c.parsed.y)}` } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTicks() } },
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
    plugins: [markerPlugin(s.length - 1, t.accent, 'Race day', t.sans)],
  });
}

function drawMarathon(mf, garmin, goalSec, results) {
  const t = theme();
  const g = new Map(garmin.map(p => [dayKey(p.date), p.sec]));
  const res = new Map(results.map(r => [dayKey(r.date), r.marathonSec]));
  const base = baseOptions(t, items => fmtDate(mf[items[0].dataIndex].date));
  drawChart('marathonChart', {
    type: 'line',
    data: { labels: mf.map(p => fmtDay(p.date)), datasets: [
      ...band(t, mf.map(p => p.slow), mf.map(p => p.fast), 'VDOT forecast, 80% range'),
      { label: 'VDOT forecast', data: mf.map(p => p.mid), borderColor: t.line, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, pointStyle: 'line' },
      { label: 'Garmin prediction', data: mf.map(p => g.get(dayKey(p.date)) ?? null), borderColor: t.text, backgroundColor: t.text, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line', spanGaps: false },
      { label: 'Goal', data: mf.map(() => goalSec), borderColor: t.accent, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, pointStyle: 'line' },
      ...(results.length ? [{ label: 'Time trial (as marathon)', data: mf.map(p => res.get(dayKey(p.date)) ?? null), showLine: false,
        pointRadius: 5, pointStyle: 'rectRot', borderColor: t.text, backgroundColor: t.text }] : []),
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t), tooltip: { ...base.plugins.tooltip, filter: c => c.dataset.label !== '_lo' && c.parsed.y != null,
        callbacks: { title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label.startsWith('VDOT forecast,')
            ? `80% range: ${fmtDuration(mf[c.dataIndex].fast)}–${fmtDuration(mf[c.dataIndex].slow)}`
            : `${c.dataset.label}: ${fmtDuration(c.parsed.y)}` } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTicks() } },
        // Ticks every 15 minutes, shown as h:mm
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, stepSize: 15 * 60, callback: v => fmtDuration(v).replace(/:\d\d$/, '') } } } },
    plugins: [markerPlugin(mf.length - 1, t.accent, 'Race day', t.sans)],
  });
}

function renderForecasts(ctx, attention) {
  const { meta, goalRace } = ctx;
  const has = goalRace && (meta?.vo2max || []).length >= 5;
  $('#ovForecast').hidden = !has;
  $('#ovForecastEmpty').hidden = has;
  if (!has) {
    $('#ovForecastEmpty').innerHTML = !goalRace
      ? '<p class="hint">Add your marathon with a goal time to content/races.json to see the forecast.</p>'
      : '<p class="hint">The forecast needs at least 5 VO2max values from Garmin.</p>';
    return;
  }
  const fc = vo2Forecast(meta.vo2max, goalRace.day);
  // Calibration: time trials in the Garmin data and race results first; until there are any, the VDOT
  // that the Runna plan's paces correspond to (the user chose this on 26 Sep 2026)
  const rv = Object.values(runnaVdot(runnaPaces((meta.schedule || []).filter(w => parseDate(w.date) >= addDays(new Date(), -14)))));
  const runnaV = rv.length ? rv.reduce((a, b) => a + b, 0) / rv.length : null;
  const cal = chooseCalibration([...timeTrials(ctx.acts), ...raceResults(ctx.races)], runnaV, meta.vo2max);
  const mf = marathonForecast(fc, cal.factor);
  const garmin = garminPredictions(meta.racePredictions);
  const goalSec = parseTime(goalRace.goal);
  const needVdot = vdot(goalRace.distance_km * 1000, goalSec);
  const race = fc.series[fc.series.length - 1], raceTime = mf[mf.length - 1];
  const lastVo2 = fc.history[fc.history.length - 1], lastG = garmin[garmin.length - 1];
  // A test run result shown as the marathon time with the same VDOT
  const results = cal.results.map(r => ({ ...r, marathonSec: timeForVdot(r.vdot) }));

  const prelim = fc.preliminary
    ? `<p class="notice">Preliminary: only ${fc.spanDays} days of VO2max data (${fmtDate(fc.history[0].date)}–${fmtDate(lastVo2.date)}). The forecast becomes more reliable after 8 weeks, when the model can also learn how fast your progress levels off.</p>` : '';
  $('#vo2Prelim').innerHTML = prelim;
  $('#mfPrelim').innerHTML = prelim;

  $('#vo2Stats').innerHTML = `
    <span>Today <b class="num">${fmtKm(lastVo2.y)}</b></span>
    <span>Race day <b class="num">${fmtKm(race.mid)}</b> <span class="muted num">(${fmtKm(race.lo)}–${fmtKm(race.hi)})</span></span>
    <span>Plateau ≈ <b class="num">${fmtKm(fc.plateau)}</b></span>`;
  const bt = fc.backtest;
  $('#vo2Backtest').innerHTML = bt ? `<b>Backtest:</b> fitted on data up to ${fmtDate(bt.trainUntil)} and forecast the last 2 weeks (${bt.n} values).
    Mean error <span class="num">${fmtKm(bt.mae)}</span>; the forecast was on average <span class="num">${fmtKm(Math.abs(bt.bias))}</span> ${bt.bias < 0 ? 'too low' : 'too high'},
    and ${bt.inside} of ${bt.n} values fell inside the 80% range.${bt.bias < -0.2 ? ' The model expects progress to slow down; so far it has not.' : ''}` : 'Backtest needs more data.';

  const calText = cal.source === 'efforts'
    ? `Calibrated with ${cal.results.length} effort${cal.results.length > 1 ? 's' : ''}: your time trial VDOT is ${Math.round(cal.factor * 100)}% of Garmin's VO2max. ` +
      cal.results.map(r => `${esc(r.name)} (${fmtDate(r.date)}): ${fmtKm(r.distance_m / 1000)} km in ${fmtDuration(r.sec)}, VDOT ${fmtKm(r.vdot)}${r.source === 'whole activity' ? ', whole activity incl. warm-up' : ''}.`).join(' ')
    : cal.source === 'runna'
      ? `Calibrated with your Runna plan: its paces correspond to VDOT ${fmtDec1(cal.runnaVdot)}, which is ${Math.round(cal.factor * 100)}% of Garmin's VO2max (${fmtDec1(cal.vo2max)}). Your first time trial will replace this (a run named time trial, TT, test, testi or aika-ajo).`
      : 'Not calibrated yet: your first Runna time trial calibrates the forecast automatically (name contains time trial, TT, test, testi or aika-ajo).';
  $('#mfStats').innerHTML = `
    <div class="kpi"><div class="kpi-label">VDOT needed for ${esc(goalRace.goal)}</div><div class="kpi-value">${fmtKm(needVdot)}</div><div class="kpi-sub">Daniels' formula</div></div>
    <div class="kpi"><div class="kpi-label">Forecast VDOT on race day</div><div class="kpi-value">${fmtKm(race.mid * cal.factor)}</div>
      <div class="kpi-sub num">${fmtKm(race.lo * cal.factor)}–${fmtKm(race.hi * cal.factor)} · ${{ efforts: 'calibrated with time trials', runna: 'calibrated with Runna paces' }[cal.source] || 'uncalibrated'}</div></div>
    <div class="kpi"><div class="kpi-label">VDOT forecast, race day</div><div class="kpi-value">${fmtDuration(raceTime.mid)}</div>
      <div class="kpi-sub num">${fmtDuration(raceTime.fast)}–${fmtDuration(raceTime.slow)}</div></div>
    <div class="kpi"><div class="kpi-label">Garmin prediction today</div><div class="kpi-value">${lastG ? fmtDuration(lastG.sec) : '–'}</div>
      <div class="kpi-sub">${lastG ? `= VDOT ${fmtKm(lastG.vdot)} · ${fmtDay(lastG.date)}` : 'No data'}</div></div>`;
  $('#mfCal').innerHTML = `${calText} ${!cal.source && lastG && raceTime.mid < lastG.sec - 20 * 60
    ? `The VDOT forecast is much faster than Garmin's prediction: Daniels' formula assumes marathon endurance to match your VO2max, while Garmin also looks at your current training volume. Your first time trial will show which is closer.` : ''}`;
  if (runnaV) $('#mfCal').innerHTML += ` Runna's paces mean a ${fmtDuration(timeForVdot(runnaV))} marathon today (see Training paces on the Fitness and load tab).`;

  drawVo2(fc);
  drawMarathon(mf, garmin, goalSec, results);

  // Attention items from the forecast
  if (fc.preliminary) attention.push({ level: 'info', text: `Forecasts are preliminary: ${fc.spanDays} days of VO2max data, 8 weeks recommended.`, tab: 'overview', tabLabel: 'Forecast' });
  if (lastG && lastG.sec > goalSec) attention.push({ level: 'watch', text: `Garmin predicts ${fmtDuration(lastG.sec)} for the marathon today, ${fmtDuration(lastG.sec - goalSec)} slower than your goal ${esc(goalRace.goal)}.`, tab: 'overview', tabLabel: 'Forecast' });
  if (cal.source === 'runna') attention.push({ level: 'info', text: 'Marathon forecast is calibrated with your Runna paces until your first time trial.', tab: 'overview', tabLabel: 'Forecast' });
  if (!cal.source) attention.push({ level: 'info', text: 'Marathon forecast is not calibrated yet. It calibrates itself after your first Runna time trial.', tab: null });
  cal.results.filter(r => r.source === 'whole activity').forEach(r => attention.push({ level: 'watch', text: `Time trial "${esc(r.name)}" had no workout laps, so the whole activity (incl. warm-up) was used. Its VDOT may be too low.`, tab: null }));
}

/* ---------- Tab ---------- */
export function renderOverview() {
  const has = state.acts.length > 0;
  $('#ovNoData').hidden = has;
  $('#ovDash').hidden = !has;
  if (!has) return;

  const meta = state.meta || {};
  const c = state.content || {};
  const races = (c.races?.data?.races || []).map(r => ({ ...r, day: parseDate(r.date) })).filter(r => r.day);
  const upcoming = races.filter(r => daysUntil(r.day) >= 0).sort((a, b) => a.day - b.day);
  const goalRace = upcoming.find(r => r.goal) || upcoming.find(r => r.distance_km >= 42) || null;
  const testRace = upcoming.find(r => r !== goalRace) || null;
  const days = loadModel(state.acts);
  const a = assess(state.acts, meta);
  const planned = plannedWorkouts(meta.schedule, state.acts);
  const ctx = {
    acts: state.acts, meta, days, races, goalRace, planned,
    race: activeRace(races), meals: c.meals?.data?.meals || [], kg: meta.weight?.kg || null,
  };

  renderToday(a);
  renderKpis(ctx);
  renderFood(ctx);
  renderCountdown(goalRace, testRace);

  // Attention list: collected from the other tabs, most important first
  const attention = [];
  const rec = a.recommendation;
  if (rec.key === 'rest') attention.push({ level: 'warn', text: `Rest day recommended. ${esc(rec.why.join(' '))}`, tab: 'recovery', tabLabel: 'Recovery' });
  if (rec.key === 'easy') attention.push({ level: 'watch', text: `Easy day recommended: ${esc(rec.why.join(' ').toLowerCase())}`, tab: 'recovery', tabLabel: 'Recovery' });
  const ratio = acwr(days);
  if (ratio?.zone.key === 'warn' || ratio?.zone.key === 'watch') attention.push({ level: ratio.zone.key, text: `Workload ratio ${fmtRatio(ratio.ratio)}: ${ratio.zone.label.toLowerCase()}. Your last 7 days are well above what you are used to.`, tab: 'fitness', tabLabel: 'Fitness and load' });
  if (ratio?.zone.key === 'under') attention.push({ level: 'info', text: `Workload ratio ${fmtRatio(ratio.ratio)}: lighter than usual this week.`, tab: 'fitness', tabLabel: 'Fitness and load' });
  if (days.length && days.length < MIN_RELIABLE_DAYS) attention.push({ level: 'info', text: `Fitness (CTL) is based on ${days.length} days of data and still reads low (6 weeks needed).`, tab: 'fitness', tabLabel: 'Fitness and load' });
  const lastNight = a.day && daysUntil(parseDate(a.day));
  if (lastNight < 0) attention.push({ level: 'info', text: `Last night isn't synced yet: recovery uses the night ending ${fmtDate(parseDate(a.day))}. Sync your watch.`, tab: 'recovery', tabLabel: 'Recovery' });
  if (ctx.race) attention.push({ level: 'info', text: `Race week: ${esc(ctx.race.name)} ${ctx.race.daysLeft ? `in ${ctx.race.daysLeft} days` : 'today'}. Follow the fuelling plan.`, tab: 'nutrition', tabLabel: 'Nutrition' });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tPlan = dayType(tomorrow, { acts: [], planned, race: ctx.race });
  if (tPlan.type === 'long' && tPlan.plan?.minutes >= LONG_MINUTES) attention.push({ level: 'info', text: `Long run tomorrow: practise race fuelling (${FUELING.training[0]}–${FUELING.training[1]} g of carbs per hour).`, tab: 'nutrition', tabLabel: 'Nutrition' });
  // How the last Garmin fetch went (data/fetch_status.json)
  const fs = state.fetchStatus;
  if (fs && !fs.ok) {
    // Plain words first; the technical text only under "Show details"
    const plain = fs.message || 'The Garmin fetch failed.';
    const last = fs.last_success ? ` The data shown is from ${fmtDate(parseDate(fs.last_success))} at ${fs.last_success.slice(11, 16)}.` : '';
    attention.push({ level: 'warn', tab: null,
      text: `Garmin fetch failed on ${fmtDate(parseDate(fs.at))} at ${fs.at.slice(11, 16)}. ${esc(plain)}${last}` +
        (fs.error ? `<details><summary>Show details</summary><code>${esc(fs.error)}</code></details>` : '') });
  }
  if (fs?.ok && fs.warnings?.length) attention.push({ level: 'info', text: `The last Garmin fetch could not get: ${fs.warnings.map(esc).join(', ')}. Those parts may be out of date.`, tab: null });
  if (state.fetchedAt && (Date.now() - state.fetchedAt) > 36 * 3600 * 1000) attention.push({ level: 'watch', text: `Garmin data is ${Math.floor((Date.now() - state.fetchedAt) / 86400000)} days old. Run start.bat or check data/fetch_data.log.`, tab: null });

  // Training plan: missed sessions this week, and last week's distance jump
  const thisWeek = weekReview(new Date(), { acts: state.acts, schedule: meta.schedule || [], meta });
  const missed = thisWeek.plan.items.filter(i => i.status === 'missed');
  if (missed.length) attention.push({ level: 'watch', text: `Missed this week: ${missed.map(i => esc(i.title)).join(', ')}.`, tab: 'training', tabLabel: 'Training' });
  const lastWeek = weekReview(addDays(new Date(), -7), { acts: state.acts, schedule: meta.schedule || [], meta });
  const jump = lastWeek.highlights.find(h => h.level === 'watch' && h.text.startsWith('Distance'));
  if (jump) attention.push({ level: 'watch', text: `Last week: ${esc(jump.text.charAt(0).toLowerCase() + jump.text.slice(1))}`, tab: 'training', tabLabel: 'Training' });

  // Long runs: build-up to the marathon peak, and last week's long run share
  if (goalRace) {
    const lr = longRunOutlook(state.acts, goalRace.day);
    if (lr.status === 'steep') attention.push({ level: 'watch', text: `Long runs: reaching ${LONG_RUN.targetKm} km by ${fmtDate(lr.peakBy)} needs ${fmtKm(lr.perWeek)} km more per week, more than the usual ${LONG_RUN.maxKmPerWeek}.`, tab: 'training', tabLabel: 'Training' });
  }
  const lastFull = weeklyLongRuns(state.acts, addDays(mondayOf(new Date()), -7), addDays(mondayOf(new Date()), -7))[0];
  if (lastFull?.share > LONG_RUN.maxShare) attention.push({ level: 'info', text: `Last week's long run was ${Math.round(lastFull.share * 100)}% of your running (${fmtKm(lastFull.longest)} of ${fmtKm(lastFull.weekKm)} km). Over 35% makes it a big single stress.`, tab: 'training', tabLabel: 'Training' });

  renderForecasts(ctx, attention);
  renderAttention(attention);
}
