// Overview tab (front page): today's status, key figures with sparklines, attention list, food tip,
// countdowns, and the VO2max and marathon forecasts. It reuses the other tabs' logic files and
// ../forecast.js, so no calculation is written twice.

import { state } from '../state.js';
import { assess } from '../recovery.js';
import { loadModel, acwr, acwrSeries, MIN_RELIABLE_DAYS } from '../metrics.js';
import { classify, plannedWorkouts, activeRace, dayType, pickMeals, recoveryAdvice, recoveryNeed, hoursToNextSession, TOMORROW_TIPS, DAY_TARGETS, LONG_MINUTES, FUELING } from '../nutrition.js';
import { vo2Forecast, marathonForecast, garminPredictions, chooseCalibration, goalStatus, forecastSources, timeTrials, raceResults, vdot, timeForVdot, parseTime } from '../forecast.js';
import { fmtKm, fmtKmWhole, distLabel, fmtInt, fmtRatio, fmtDec1, fmtSigned, fmtDay, fmtDate, fmtDuration, fmtHm, fmtGrams, fmtWeekday, esc } from '../format.js';
import { mondayOf, dayKey, startOfDay, addDays, daysBetween } from '../dates.js';
import { parseDate } from '../parse.js';
import { theme, baseOptions, drawChart, legend, band, mainLine, secondaryLine, points, xTickLimit } from '../charts.js';
import { weekReview } from '../plan.js';
import { organizeAttention } from '../attention.js';
import { describeWorkout, describePlanned, planTitles } from '../workouts.js';
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
  // A week in progress is compared with last week up to the same weekday
  const samePoint = weekReview(new Date(), { acts, schedule: [], meta: {} }).prev.km;
  const ratio = acwr(days);
  const hrv = meta?.recovery?.hrv || [];
  const lastHrv = hrv[hrv.length - 1];
  const ctl = days.map(d => d.ctl);
  const ctlNow = ctl[ctl.length - 1], ctlWeekAgo = ctl[ctl.length - 8];
  $('#ovKpis').innerHTML =
    kpiLink('training', 'Running this week', fmtKm(now), distLabel(), `Same point last week ${fmtKm(samePoint)} ${distLabel()} (whole week ${fmtKm(last)})`, sparkline(weeks)) +
    kpiLink('fitness', 'Workload ratio (ACWR)', ratio ? fmtRatio(ratio.ratio) : '–', '',
      ratio ? `<i class="dot st-${ratio.zone.key}"></i> ${ratio.zone.label}` : 'Needs 28 days', sparkline(acwrSeries(days, 28).map(d => d.ratio))) +
    kpiLink('recovery', 'HRV last night', lastHrv ? fmtInt(lastHrv.last_night) : '–', 'ms',
      lastHrv ? titleCase(lastHrv.status) + ` · ${fmtDay(parseDate(lastHrv.date))}` : 'No data', sparkline(hrv.map(h => h.last_night))) +
    kpiLink('fitness', 'Fitness (CTL)', Number.isFinite(ctlNow) ? fmtInt(ctlNow) : '–', '',
      Number.isFinite(ctlWeekAgo) ? `${fmtSigned(ctlNow - ctlWeekAgo)} in 7 days` : 'Building up', sparkline(ctl.slice(-42)));
}

function attentionItem(i) {
  const dot = `<i class="dot st-${i.level === 'info' ? 'none' : i.level}" aria-hidden="true"></i>`;
  if (i.kind === 'data') {
    return `<li class="data-quality">${dot}<details><summary>Data quality <span class="muted">· ${i.notes.length} ${i.notes.length === 1 ? 'note' : 'notes'}</span></summary>
      <ul>${i.notes.map(n => `<li>${n}</li>`).join('')}</ul></details></li>`;
  }
  return `<li>${dot}<span>${i.text}</span>${i.tab ? `<a class="more-link" href="#${i.tab}">${i.tabLabel}</a>` : ''}</li>`;
}

/** The most important items (warn > watch > info), at most 3; the rest behind "Show all" */
function renderAttention(items) {
  const { visible, hidden } = organizeAttention(items);
  $('#ovAttention').innerHTML = visible.length
    ? `<ul class="attention">${visible.map(attentionItem).join('')}</ul>` + (hidden.length ? `
      <details class="attention-more"><summary>Show all (${hidden.length} more)</summary>
        <ul class="attention">${hidden.map(attentionItem).join('')}</ul></details>` : '')
    : '<p class="hint">Nothing needs your attention today.</p>';
}

function renderFood(ctx) {
  const { acts, planned, race, meals, kg } = ctx;
  const todayKey = dayKey(new Date());
  const doneToday = acts.filter(a => isRun(a) && dayKey(a.date) === todayKey).pop();
  let head, text, list;
  if (doneToday) {
    const type = classify({ type: doneToday.type, title: doneToday.title, minutes: doneToday.sec / 60, teLabel: doneToday.teLabel });
    head = `After today's run: ${esc(describeWorkout(doneToday, planTitles(state.meta?.schedule).get(doneToday.workoutId)).name)}`;
    text = recoveryAdvice(recoveryNeed({ type, minutes: doneToday.sec / 60, hoursToNext: hoursToNextSession(doneToday, acts, planned) }), kg, fmtGrams);
    list = pickMeals(meals, type, 'recovery', 2, todayKey).map(m => ({ m, slot: 'After the run' }));
  } else {
    const date = new Date(); date.setDate(date.getDate() + 1);
    const dt = dayType(date, { acts: [], planned, race });
    head = `Tomorrow: ${DAY_TARGETS[dt.type].label.toLowerCase()}${dt.plan ? ' · ' + esc(describePlanned(dt.plan).name) : ''}`;
    text = TOMORROW_TIPS[dt.type];
    list = [...pickMeals(meals, dt.type, 'dinner', 1, 'eve' + dayKey(date)).map(m => ({ m, slot: 'Dinner tonight' })),
            ...pickMeals(meals, dt.type, 'breakfast', 1, dayKey(date)).map(m => ({ m, slot: 'Breakfast' }))];
  }
  $('#ovFood').innerHTML = `
    <div class="card-head"><div><h2>Food tip</h2><p class="sub">${head}</p></div><a class="more-link" href="#nutrition">Nutrition</a></div>
    <p class="tip">${text}</p>
    <ul class="meals">${list.map(({ m, slot }) => `<li><span class="slot">${slot}</span><div class="meal-body"><span class="meal-name">${esc(m.name)}</span></div></li>`).join('')}</ul>`;
}

// What to do when a countdown has nothing to count down to
const cta = {
  'Next test run': '<button type="button" class="btn small" data-open-settings="add-trial">Add a time trial</button>',
  Marathon: '<button type="button" class="btn small" data-open-settings="add-main">Add your main race</button>',
};

function renderCountdown(goalRace, testRace) {
  const row = (label, r) => {
    if (!r) return `<div class="countdown"><div class="kpi-label">${label}</div>${cta[label]}</div>`;
    const d = daysUntil(r.day);
    return `<div class="countdown"><div class="kpi-label">${label}</div>
      <div class="kpi-value">${d}<span class="unit">days</span></div>
      <div class="kpi-sub">${esc(r.name)} · ${fmtDate(r.day)}${r.goal ? ` · goal ${esc(r.goal)}` : ''}${d > 13 ? ` · ${Math.floor(d / 7)} weeks` : ''}</div></div>`;
  };
  $('#ovCountdown').innerHTML = `<div class="card-head"><h2>Countdown</h2></div>${row('Next test run', testRace)}${row('Marathon', goalRace)}`;
}

/* ---------- Part 2 and 3: forecasts ---------- */
// Dashed vertical line with a label, e.g. at race day
// The line uses the accent fill; the label the accent's text color (small text needs 4.5:1)
const markerPlugin = (index, color, label, font, textColor = color, size = 12) => ({
  id: 'marker',
  afterDatasetsDraw(chart) {
    if (index < 0) return;
    const x = chart.scales.x.getPixelForValue(index), { top, bottom } = chart.chartArea, c = chart.ctx;
    c.save(); c.strokeStyle = color; c.fillStyle = textColor; c.setLineDash([3, 3]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
    c.font = `${size}px ${font}`; c.textAlign = 'right'; c.fillText(label, x - 4, top + 11); c.restore();
  },
});

function drawVo2(fc) {
  const t = theme();
  const s = fc.series, measured = new Map(fc.history.map(h => [dayKey(h.date), h.y]));
  const base = baseOptions(t, items => fmtDate(s[items[0].dataIndex].date));
  drawChart('vo2Chart', {
    type: 'line',
    data: { labels: s.map(p => fmtDay(p.date)), datasets: [
      ...band(t, s.map(p => p.lo), s.map(p => p.hi), '80% range'),
      { label: 'Forecast', data: s.map(p => p.mid), ...secondaryLine(t, { tension: 0 }) },
      { label: 'Garmin VO2max', data: s.map(p => measured.get(dayKey(p.date)) ?? null), ...points(t) },
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t), tooltip: { ...base.plugins.tooltip,
        callbacks: { title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label === '80% range' ? `80% range: ${fmtDec1(s[c.dataIndex].lo)}–${fmtDec1(s[c.dataIndex].hi)}` : `${c.dataset.label}: ${fmtDec1(c.parsed.y)}` } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(8) } },
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => fmtInt(v) } } } },
    plugins: [markerPlugin(s.length - 1, t.accent, 'Race day', t.sans, t.accentText)],
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
      ...band(t, mf.map(p => p.slow), mf.map(p => p.fast), 'Main forecast, 80% range'),
      { label: 'Main forecast', data: mf.map(p => p.mid), ...secondaryLine(t, { tension: 0 }) },
      { label: 'Garmin prediction', data: mf.map(p => g.get(dayKey(p.date)) ?? null), ...mainLine(t, { spanGaps: false }) },
      { label: 'Goal', data: mf.map(() => goalSec), borderColor: t.accent, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, pointStyle: 'line' },
      ...(results.length ? [{ label: 'Time trial (as marathon)', data: mf.map(p => res.get(dayKey(p.date)) ?? null), showLine: false,
        ...points(t, { pointRadius: 5, pointStyle: 'rectRot' }) }] : []),
    ] },
    options: { ...base,
      plugins: { ...base.plugins, legend: legend(t), tooltip: { ...base.plugins.tooltip,
        callbacks: { title: base.plugins.tooltip.callbacks.title,
          label: c => c.dataset.label.startsWith('Main forecast,')
            ? `80% range: ${fmtDuration(mf[c.dataIndex].fast)}–${fmtDuration(mf[c.dataIndex].slow)}`
            : `${c.dataset.label}: ${fmtDuration(c.parsed.y)}` } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(8) } },
        // Ticks every 15 minutes, shown as h:mm
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, stepSize: 15 * 60, callback: v => fmtDuration(v).replace(/:\d\d$/, '') } } } },
    plugins: [markerPlugin(mf.length - 1, t.accent, 'Race day', t.sans, t.accentText)],
  });
}

function renderForecasts(ctx, attention) {
  const { meta, goalRace } = ctx;
  const has = goalRace && (meta?.vo2max || []).length >= 5;
  $('#ovForecast').hidden = !has;
  $('#ovForecastEmpty').hidden = has;
  if (!has) {
    $('#ovForecastEmpty').innerHTML = !goalRace
      ? '<div class="cta"><p class="hint">Add the race you are training for, with a goal time, to see the forecast.</p><button type="button" class="btn" data-open-settings="add-main">Add your main race</button></div>'
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
    <span>Today <b class="num">${fmtDec1(lastVo2.y)}</b></span>
    <span>Race day <b class="num">${fmtDec1(race.mid)}</b> <span class="muted num">(${fmtDec1(race.lo)}–${fmtDec1(race.hi)})</span></span>
    <span>Plateau ≈ <b class="num">${fmtDec1(fc.plateau)}</b></span>`;
  const bt = fc.backtest;
  $('#vo2Backtest').innerHTML = bt ? `<b>Backtest:</b> fitted on data up to ${fmtDate(bt.trainUntil)} and forecast the last 2 weeks (${bt.n} values).
    Mean error <span class="num">${fmtDec1(bt.mae)}</span>; the forecast was on average <span class="num">${fmtDec1(Math.abs(bt.bias))}</span> ${bt.bias < 0 ? 'too low' : 'too high'},
    and ${bt.inside} of ${bt.n} values fell inside the 80% range.${bt.bias < -0.2 ? ' The model expects progress to slow down; so far it has not.' : ''}` : 'Backtest needs more data.';

  const calText = cal.source === 'efforts'
    ? `Calibrated with ${cal.results.length} effort${cal.results.length > 1 ? 's' : ''}: your time trial VDOT is ${Math.round(cal.factor * 100)}% of Garmin's VO2max. ` +
      cal.results.map(r => `${esc(r.name)} (${fmtDate(r.date)}): ${fmtKm(r.distance_m / 1000)} ${distLabel()} in ${fmtDuration(r.sec)}, VDOT ${fmtDec1(r.vdot)}${r.source === 'whole activity' ? ', whole activity incl. warm-up' : ''}.`).join(' ')
    : cal.source === 'runna'
      ? `Calibrated with your Runna plan: its paces correspond to VDOT ${fmtDec1(cal.runnaVdot)}, which is ${Math.round(cal.factor * 100)}% of Garmin's VO2max (${fmtDec1(cal.vo2max)}). Your first time trial will replace this (a run named time trial, TT, test, testi or aika-ajo).`
      : 'Not calibrated yet: your first Runna time trial calibrates the forecast automatically (name contains time trial, TT, test, testi or aika-ajo).';
  // Main forecast: the calibrated VDOT forecast for race day. It is the only estimate that looks ahead
  // to race day, and the calibration anchors it in how the user actually runs.
  const status = goalStatus(goalSec, raceTime);
  const STATUS_TEXT = {
    'on-track': ['ok', `On track: even the slow end of the range beats ${esc(goalRace.goal)}.`],
    possible:   ['watch', `Possible: the middle of the range beats ${esc(goalRace.goal)}, the slow end does not yet.`],
    behind:     ['warn', `Behind: the middle of the range is slower than ${esc(goalRace.goal)}.`],
  };
  const [dot, statusText] = STATUS_TEXT[status];
  const source = { efforts: 'your time trials', runna: 'your Runna paces' }[cal.source];
  $('#mfStats').innerHTML = `
    <div class="main-forecast">
      <div class="kpi-label">Main forecast · ${esc(goalRace.name)} on ${fmtDate(goalRace.day)}</div>
      <div class="main-time num">${fmtDuration(raceTime.mid)}</div>
      <div class="kpi-sub num">likely range ${fmtDuration(raceTime.fast)}–${fmtDuration(raceTime.slow)} (80%)</div>
      <p class="status main-status"><i class="dot st-${dot}"></i>${statusText}</p>
      <p class="hint">VDOT ${fmtDec1(race.mid * cal.factor)} on race day; ${esc(goalRace.goal)} needs ${fmtDec1(needVdot)}. ${source ? `Calibrated with ${source}.` : 'Not calibrated yet, so this is optimistic.'}</p>
    </div>`;

  // Why the estimates differ: each source measures something different
  const rows = forecastSources({ vo2Today: lastVo2.y, race, factor: cal.factor, runnaVdot: runnaV, garminSec: lastG?.sec });
  const WHAT = {
    main: `Garmin's VO2max trend carried to race day, scaled to your real running level${source ? ` (${source}: ${Math.round(cal.factor * 100)}% of VO2max)` : ''}. The main forecast: the only one that looks ahead to race day and is anchored in how you actually run.`,
    runna: "The level your Runna plan trains you at, from the paces in its workouts. Describes today; Runna raises the paces as you improve.",
    garmin: "Garmin's race predictor. It also weighs your recent training volume and long runs, which are still short for a marathon, so it is cautious. Describes today.",
    vo2max: "Garmin's VO2max used directly as VDOT. Daniels' formula then assumes marathon endurance and running economy to match, so it is the most optimistic.",
  };
  const LABEL = { main: 'Main forecast', runna: 'Runna plan', garmin: 'Garmin prediction', vo2max: 'VO2max, uncalibrated' };
  $('#mfCal').innerHTML = `
    <h3 class="mini">Why the forecasts differ</h3>
    <div class="table-wrap"><table class="rules sources-table">
      <thead><tr><th>Source</th><th class="num">Today</th><th class="num">Race day</th><th>What it is</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.key === 'main' ? 'main-row' : ''}"><td>${LABEL[r.key]}<br><span class="muted">VDOT ${fmtDec1(r.vdotToday)} today</span></td>
        <td class="num">${fmtDuration(r.today)}</td><td class="num">${r.race ? fmtDuration(r.race.mid) : '–'}</td><td class="rule">${WHAT[r.key]}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="hint">They measure different things. Raw VO2max is only your aerobic capacity. Runna and Garmin describe your race fitness today, and Garmin also counts your long runs, which are still far from marathon length. The main forecast takes today's real level and moves it forward with your VO2max trend. ${calText}</p>`;

  drawVo2(fc);
  drawMarathon(mf, garmin, goalSec, results);

  // Attention items from the forecast
  if (fc.preliminary) attention.push({ kind: 'data', level: 'info', text: `Forecasts are preliminary: ${fc.spanDays} days of VO2max data, 8 weeks recommended.`, tab: 'overview', tabLabel: 'Forecast' });
  if (lastG && lastG.sec > goalSec) attention.push({ level: 'watch', text: `Garmin predicts ${fmtDuration(lastG.sec)} for the marathon today, ${fmtDuration(lastG.sec - goalSec)} slower than your goal ${esc(goalRace.goal)}.`, tab: 'overview', tabLabel: 'Forecast' });
  if (cal.source === 'runna') attention.push({ kind: 'data', level: 'info', text: 'Marathon forecast is calibrated with your Runna paces until your first time trial.', tab: 'overview', tabLabel: 'Forecast' });
  if (!cal.source) attention.push({ kind: 'data', level: 'info', text: 'Marathon forecast is not calibrated yet. It calibrates itself after your first Runna time trial.', tab: null });
  cal.results.filter(r => r.source === 'whole activity').forEach(r => attention.push({ kind: 'data', level: 'watch', text: `Time trial "${esc(r.name)}" had no workout laps, so the whole activity (incl. warm-up) was used. Its VDOT may be too low.`, tab: null }));
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
  if (days.length && days.length < MIN_RELIABLE_DAYS) attention.push({ kind: 'data', level: 'info', text: `Fitness (CTL) is based on ${days.length} days of data and still reads low (6 weeks needed).`, tab: 'fitness', tabLabel: 'Fitness and load' });
  const lastNight = a.day && daysUntil(parseDate(a.day));
  if (lastNight < 0) attention.push({ kind: 'data', level: 'info', text: `Last night isn't synced yet: recovery uses the night ending ${fmtDate(parseDate(a.day))}. Sync your watch.`, tab: 'recovery', tabLabel: 'Recovery' });
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
  if (fs?.ok && fs.warnings?.length) attention.push({ kind: 'data', level: 'info', text: `The last Garmin fetch could not get: ${fs.warnings.map(esc).join(', ')}. Those parts may be out of date.`, tab: null });
  if (state.fetchedAt && (Date.now() - state.fetchedAt) > 36 * 3600 * 1000) attention.push({ level: 'watch', text: `Garmin data is ${Math.floor((Date.now() - state.fetchedAt) / 86400000)} days old. Fetch it again, or check data/fetch_data.log if the morning fetch keeps failing.`, tab: 'settings', tabLabel: 'Settings' });

  // Training plan: missed sessions this week, and last week's distance jump
  const thisWeek = weekReview(new Date(), { acts: state.acts, schedule: meta.schedule || [], meta });
  const missed = thisWeek.plan.items.filter(i => i.status === 'missed');
  if (missed.length) attention.push({ level: 'watch', text: `Missed this week: ${missed.map(i => esc(describePlanned(i).name)).join(', ')}.`, tab: 'training', tabLabel: 'Training' });
  const lastWeek = weekReview(addDays(new Date(), -7), { acts: state.acts, schedule: meta.schedule || [], meta });
  const jump = lastWeek.highlights.find(h => h.level === 'watch' && h.text.startsWith('Distance'));
  if (jump) attention.push({ level: 'watch', text: `Last week: ${esc(jump.text.charAt(0).toLowerCase() + jump.text.slice(1))}`, tab: 'training', tabLabel: 'Training' });

  // Long runs: build-up to the marathon peak, and last week's long run share
  if (goalRace) {
    const lr = longRunOutlook(state.acts, goalRace.day);
    if (lr.status === 'steep') attention.push({ level: 'watch', text: `Long runs: reaching ${fmtKmWhole(LONG_RUN.targetKm)} ${distLabel()} by ${fmtDate(lr.peakBy)} needs ${fmtKm(lr.perWeek)} ${distLabel()} more per week, more than the usual ${fmtKm(LONG_RUN.maxKmPerWeek)}.`, tab: 'training', tabLabel: 'Training' });
  }
  const lastFull = weeklyLongRuns(state.acts, addDays(mondayOf(new Date()), -7), addDays(mondayOf(new Date()), -7))[0];
  if (lastFull?.share > LONG_RUN.maxShare) attention.push({ level: 'info', text: `Last week's long run was ${Math.round(lastFull.share * 100)}% of your running (${fmtKm(lastFull.longest)} of ${fmtKm(lastFull.weekKm)} ${distLabel()}). Over 35% makes it a big single stress.`, tab: 'training', tabLabel: 'Training' });

  renderForecasts(ctx, attention);
  renderAttention(attention);
}
