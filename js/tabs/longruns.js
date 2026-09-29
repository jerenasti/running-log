// "Long runs" card on the Training tab. The logic is in ../longruns.js.

import { state } from '../state.js';
import { weeklyLongRuns, plannedLongRuns, longRunOutlook, progressionLine, LONG_RUN } from '../longruns.js';
import { fmtKm, fmtKmWhole, fmtDec1, fmtDate, fmtDay, esc, distLabel, distIn } from '../format.js';
import { mondayOf, isoWeek, addDays } from '../dates.js';
import { parseDate } from '../parse.js';
import { describePlanned } from '../workouts.js';
import { theme, baseOptions, drawChart, legend, band, secondaryLine, xTickLimit } from '../charts.js';

const $ = s => document.querySelector(s);
const STATUS = {
  'on-track': { dot: 'ok',   text: o => `About ${fmtKm(o.perWeek)} ${distLabel()} more per week on average reaches ${fmtKmWhole(LONG_RUN.targetKm)} ${distLabel()} in time.` },
  steep:      { dot: 'watch', text: o => `That needs ${fmtKm(o.perWeek)} ${distLabel()} more per week, more than the usual ${fmtKm(LONG_RUN.maxKmPerWeek)} ${distLabel()}. Consider a lower peak or a longer build-up.` },
  reached:    { dot: 'ok',   text: () => `You have already run ${LONG_RUN.peakKm[0]} km or more in the last 4 weeks.` },
  late:       { dot: 'none', text: () => 'The peak date has passed: this is taper time.' },
};

/** The marathon: the upcoming race with a goal, or the next race of 42 km or more */
function goalRace() {
  const races = (state.content?.races?.data?.races || []).map(r => ({ ...r, day: parseDate(r.date) })).filter(r => r.day && r.day >= addDays(new Date(), -1));
  return races.filter(r => r.goal).sort((a, b) => a.day - b.day)[0] || races.filter(r => r.distance_km >= 42).sort((a, b) => a.day - b.day)[0] || null;
}

export function renderLongRuns() {
  const race = goalRace();
  const acts = state.acts;
  const first = acts.find(a => a.km > 0)?.date;
  if (!first) return;
  const end = race ? race.day : addDays(new Date(), 28);
  const weeks = weeklyLongRuns(acts, first, end);
  const thisMon = mondayOf(new Date()).getTime();
  const planned = new Map(plannedLongRuns(state.meta?.schedule, new Date()).map(p => [mondayOf(p.date).getTime(), p]));
  const outlook = race ? longRunOutlook(acts, race.day, new Date()) : null;
  const line = outlook ? progressionLine(weeks, outlook, new Date()) : weeks.map(() => null);
  const lastFull = weeks.filter(w => w.monday.getTime() < thisMon).at(-1);

  // Key figures
  const s = outlook && STATUS[outlook.status];
  $('#longStats').innerHTML = `
    <div class="kpi"><div class="kpi-label">Longest, last 4 weeks</div><div class="kpi-value">${fmtKm(outlook ? outlook.current : Math.max(...weeks.map(w => w.longest)))}<span class="unit">${distLabel()}</span></div><div class="kpi-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Peak target</div><div class="kpi-value">${LONG_RUN.peakKm[0]}–${LONG_RUN.peakKm[1]}<span class="unit">km</span></div>
      <div class="kpi-sub">${outlook ? 'by ' + fmtDate(outlook.peakBy) : '<button type="button" class="link-btn" data-open-settings="add-main">Add your main race</button>'}</div></div>
    <div class="kpi"><div class="kpi-label">Needed build-up</div><div class="kpi-value">${outlook?.perWeek != null ? '+' + fmtKm(outlook.perWeek) : '–'}<span class="unit">${distLabel()} / wk</span></div>
      <div class="kpi-sub">${outlook ? `${Math.round(outlook.weeksToPeak)} weeks to the peak` : ''}</div></div>
    <div class="kpi"><div class="kpi-label">Long run share, last week</div><div class="kpi-value">${lastFull?.share != null ? Math.round(lastFull.share * 100) : '–'}<span class="unit">%</span></div>
      <div class="kpi-sub">${lastFull?.share > LONG_RUN.maxShare ? '<i class="dot st-watch"></i> over 35% of the week' : `of ${fmtKm(lastFull?.weekKm || 0)} ${distLabel()}`}</div></div>`;
  $('#longStatus').innerHTML = s ? `<i class="dot st-${s.dot}"></i><span>${s.text(outlook)}</span>` : '';

  // Chart: done (bars), planned by Runna (light bars), needed progression (dashed), target range at the peak
  const t = theme();
  const labels = weeks.map(w => 'wk ' + isoWeek(w.monday));
  const peakWeek = outlook ? mondayOf(outlook.peakBy).getTime() : null;
  const targetFrom = peakWeek && addDays(new Date(peakWeek), -21).getTime();   // the 3 weeks before the peak week
  const inTarget = w => peakWeek && w.monday.getTime() >= targetFrom && w.monday.getTime() <= peakWeek;
  const base = baseOptions(t, items => {
    const w = weeks[items[0].dataIndex];
    return `Week ${isoWeek(w.monday)} (${fmtDay(w.monday)} – ${fmtDate(addDays(w.monday, 6))})`;
  });
  // Chart data is in the chosen unit (km or mi); the tooltips format it as it is
  const peakText = `${fmtKmWhole(LONG_RUN.peakKm[0])}–${fmtKmWhole(LONG_RUN.peakKm[1])} ${distLabel()}`;
  drawChart('longChart', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Longest run', data: weeks.map(w => w.longest ? distIn(w.longest) : null), backgroundColor: weeks.map(w => w.monday.getTime() === thisMon ? t.accent : t.line),
        borderRadius: t.radius / 2, maxBarThickness: 22, grouped: false, order: 2 },
      { label: 'Planned (Runna)', data: weeks.map(w => { const km = planned.get(w.monday.getTime())?.km; return km != null ? distIn(km) : null; }), backgroundColor: t.bar, borderColor: t.line,
        borderWidth: 1, borderDash: [3, 2], borderRadius: t.radius / 2, maxBarThickness: 22, grouped: false, order: 3 },
      { type: 'line', label: 'Needed build-up', data: line.map(v => v != null ? distIn(v) : null), ...secondaryLine(t, { tension: 0, order: 1 }) },
      ...band(t, weeks.map(w => inTarget(w) ? distIn(LONG_RUN.peakKm[0]) : null), weeks.map(w => inTarget(w) ? distIn(LONG_RUN.peakKm[1]) : null),
        `Peak target ${peakText}`),
    ] },
    options: { ...base,
      plugins: { ...base.plugins,
        legend: legend(t),
        tooltip: { ...base.plugins.tooltip, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => {
            const w = weeks[c.dataIndex];
            if (c.dataset.label === 'Longest run') return `Longest: ${fmtDec1(c.parsed.y)} ${distLabel()} (${Math.round((w.share || 0) * 100)}% of ${fmtKm(w.weekKm)} ${distLabel()})`;
            if (c.dataset.label.startsWith('Planned')) return `Planned: ${fmtDec1(c.parsed.y)} ${distLabel()}, ${esc(describePlanned(planned.get(w.monday.getTime())).name)}`;
            if (c.dataset.label.startsWith('Peak')) return `Peak target: ${peakText}`;
            return `${c.dataset.label}: ${fmtDec1(c.parsed.y)} ${distLabel()}`;
          } } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: xTickLimit(12) } },
        y: { ...base.scales.y, beginAtZero: true, suggestedMax: distIn(LONG_RUN.peakKm[1] + 2), ticks: { ...base.scales.y.ticks, callback: v => v + ' ' + distLabel() } } } },
  });
}
