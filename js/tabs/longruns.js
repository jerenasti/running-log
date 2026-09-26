// "Long runs" card on the Training tab. The logic is in ../longruns.js.

import { state } from '../state.js';
import { weeklyLongRuns, plannedLongRuns, longRunOutlook, progressionLine, LONG_RUN } from '../longruns.js';
import { fmtKm, fmtDate, fmtDay, esc } from '../format.js';
import { mondayOf, isoWeek, addDays } from '../dates.js';
import { parseDate } from '../parse.js';
import { theme, baseOptions, drawChart } from '../charts.js';

const $ = s => document.querySelector(s);
const STATUS = {
  'on-track': { dot: 'ok',   text: o => `About ${fmtKm(o.perWeek)} km more per week on average reaches ${LONG_RUN.targetKm} km in time.` },
  steep:      { dot: 'watch', text: o => `That needs ${fmtKm(o.perWeek)} km more per week, more than the usual ${LONG_RUN.maxKmPerWeek} km. Consider a lower peak or a longer build-up.` },
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
    <div class="kpi"><div class="kpi-label">Longest, last 4 weeks</div><div class="kpi-value">${fmtKm(outlook ? outlook.current : Math.max(...weeks.map(w => w.longest)))}<span class="unit">km</span></div><div class="kpi-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Peak target</div><div class="kpi-value">${LONG_RUN.peakKm[0]}–${LONG_RUN.peakKm[1]}<span class="unit">km</span></div>
      <div class="kpi-sub">${outlook ? 'by ' + fmtDate(outlook.peakBy) : 'Add your marathon to races.json'}</div></div>
    <div class="kpi"><div class="kpi-label">Needed build-up</div><div class="kpi-value">${outlook?.perWeek != null ? '+' + fmtKm(outlook.perWeek) : '–'}<span class="unit">km / wk</span></div>
      <div class="kpi-sub">${outlook ? `${Math.round(outlook.weeksToPeak)} weeks to the peak` : ''}</div></div>
    <div class="kpi"><div class="kpi-label">Long run share, last week</div><div class="kpi-value">${lastFull?.share != null ? Math.round(lastFull.share * 100) : '–'}<span class="unit">%</span></div>
      <div class="kpi-sub">${lastFull?.share > LONG_RUN.maxShare ? '<i class="dot st-watch"></i> over 35% of the week' : `of ${fmtKm(lastFull?.weekKm || 0)} km`}</div></div>`;
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
  drawChart('longChart', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Longest run', data: weeks.map(w => w.longest || null), backgroundColor: weeks.map(w => w.monday.getTime() === thisMon ? t.accent : t.line),
        borderRadius: 3, maxBarThickness: 22, grouped: false, order: 2 },
      { label: 'Planned (Runna)', data: weeks.map(w => planned.get(w.monday.getTime())?.km ?? null), backgroundColor: t.bar, borderColor: t.line,
        borderWidth: 1, borderDash: [3, 2], borderRadius: 3, maxBarThickness: 22, grouped: false, order: 3 },
      { type: 'line', label: 'Needed build-up', data: line, borderColor: t.text3, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, order: 1 },
      { type: 'line', label: '_lo', data: weeks.map(w => inTarget(w) ? LONG_RUN.peakKm[0] : null), borderWidth: 0, pointRadius: 0, fill: false, order: 10 },
      { type: 'line', label: `Peak target ${LONG_RUN.peakKm[0]}–${LONG_RUN.peakKm[1]} km`, data: weeks.map(w => inTarget(w) ? LONG_RUN.peakKm[1] : null),
        borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: t.bar + '80', pointStyle: 'rect', order: 10 },
    ] },
    options: { ...base,
      plugins: { ...base.plugins,
        legend: { display: true, position: 'bottom', labels: { color: t.text3, font: { family: t.sans, size: 11 }, usePointStyle: true, boxWidth: 14, boxHeight: 8, padding: 12, filter: i => !i.text.startsWith('_') } },
        tooltip: { ...base.plugins.tooltip, filter: c => !c.dataset.label.startsWith('_') && c.parsed.y != null, callbacks: {
          title: base.plugins.tooltip.callbacks.title,
          label: c => {
            const w = weeks[c.dataIndex];
            if (c.dataset.label === 'Longest run') return `Longest: ${fmtKm(c.parsed.y)} km (${Math.round((w.share || 0) * 100)}% of ${fmtKm(w.weekKm)} km)`;
            if (c.dataset.label.startsWith('Planned')) return `Planned: ${fmtKm(c.parsed.y)} km, ${esc(planned.get(w.monday.getTime()).title)}`;
            if (c.dataset.label.startsWith('Peak')) return `Peak target: ${LONG_RUN.peakKm[0]}–${LONG_RUN.peakKm[1]} km`;
            return `${c.dataset.label}: ${fmtKm(c.parsed.y)} km`;
          } } } },
      scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: window.innerWidth < 600 ? 5 : 12 } },
        y: { ...base.scales.y, beginAtZero: true, suggestedMax: LONG_RUN.peakKm[1] + 2, ticks: { ...base.scales.y.ticks, callback: v => v + ' km' } } } },
  });
}
