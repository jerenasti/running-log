// "Plan and weekly review" card on the Training tab. The logic is in ../plan.js.

import { state } from '../state.js';
import { weekReview } from '../plan.js';
import { describePlanned } from '../workouts.js';
import { fmtWorkout, fmtKm, fmtDec1, distLabel, fmtInt, fmtRatio, fmtSigned, fmtDuration, fmtHClock, fmtWeekday, fmtDay, fmtDate, esc, DASH } from '../format.js';
import { mondayOf, isoWeek, addDays } from '../dates.js';

const $ = s => document.querySelector(s);
let offset = 0;   // 0 = this week, 1 = last week, …

const STATUS = {
  done:     { label: 'Done',    dot: 'ok' },
  moved:    { label: 'Moved',   dot: 'ok' },
  missed:   { label: 'Missed',  dot: 'warn' },
  today:    { label: 'Today',   dot: 'none' },
  upcoming: { label: 'Planned', dot: 'none' },
  extra:    { label: 'Extra',   dot: 'none' },
};

function planRow(i) {
  const s = STATUS[i.status];
  const a = i.act;
  const actual = a
    ? `${i.status === 'moved' ? 'done ' + fmtWeekday(a.date) + ' · ' : ''}${fmtKm(a.km)} ${distLabel()} · ${fmtDuration(a.sec)}`
    : '';
  return `<li class="plan-row status-${i.status}">
    <span class="num plan-day">${fmtWeekday(i.date)}</span>
    <span class="plan-title">${fmtWorkout(describePlanned({ title: i.title || i.sport || 'Workout', sport: i.sport || i.act?.type }))}</span>
    <span class="status plan-status"><i class="dot st-${s.dot}"></i>${s.label}</span>
    <span class="muted num plan-actual">${actual}</span></li>`;
}

// One comparison row: this week, last week, change
function row(label, cur, prev, fmt, diffFmt = null) {
  const ok = v => v !== null && v !== undefined && Number.isFinite(v);
  const diff = ok(cur) && ok(prev) && diffFmt ? diffFmt(cur - prev) : '';
  return `<tr><td>${label}</td><td class="num">${ok(cur) ? fmt(cur) : DASH}</td><td class="num">${ok(prev) ? fmt(prev) : DASH}</td><td class="num muted">${diff}</td></tr>`;
}
const pct = (cur, prev) => prev > 0 ? fmtSigned((cur - prev) / prev * 100) + '%' : '';

export function renderReview() {
  const monday = addDays(mondayOf(new Date()), -7 * offset);
  const r = weekReview(monday, { acts: state.acts, schedule: state.meta?.schedule || [], meta: state.meta || {} });
  const { cur, prev, load, forecast: f } = r;

  $('#reviewTitle').textContent = `Week ${isoWeek(r.monday)}: ${fmtDay(r.monday)} – ${fmtDate(r.end)}`;
  $('#reviewSub').textContent = r.inProgress ? 'This week so far, compared with last week.' : 'Compared with the week before.';
  $('#revNext').disabled = offset === 0;
  $('#revThis').setAttribute('aria-pressed', String(offset === 0));

  $('#planList').innerHTML = r.plan.items.length
    ? r.plan.items.map(planRow).join('')
    : '<li class="hint">No planned workouts or runs this week.</li>';

  $('#reviewTable').innerHTML = `
    <thead><tr><th></th><th class="num">${r.inProgress ? 'So far' : 'This week'}</th><th class="num">${r.inProgress ? 'Same point last week' : 'Week before'}</th><th class="num">Change</th></tr></thead>
    <tbody>
      ${row('Distance', cur.km, prev.km, v => fmtKm(v) + ' ' + distLabel(), () => pct(cur.km, prev.km))}
      ${row('Runs', cur.runs, prev.runs, fmtInt, d => fmtSigned(d))}
      ${row('Running time', cur.sec, prev.sec, v => fmtHClock(v) + ' h')}
      ${row('Longest run', cur.longest, prev.longest, v => fmtKm(v) + ' ' + distLabel())}
      ${row('Training load', cur.trimp, prev.trimp, fmtInt, () => pct(cur.trimp, prev.trimp))}
      ${row('Average HRV', cur.hrv, prev.hrv, v => fmtInt(v) + ' ms', d => fmtSigned(d))}
      ${row('Average resting HR', cur.rhr, prev.rhr, v => fmtInt(v) + ' bpm', d => fmtSigned(d))}
      ${row('Average sleep', cur.sleepSec, prev.sleepSec, v => fmtHClock(v) + ' h')}
      ${row('Average sleep score', cur.sleepScore, prev.sleepScore, fmtInt, d => fmtSigned(d))}
    </tbody>
    <tbody class="review-end">
      <tr><td>Workload ratio (ACWR) at week end</td><td class="num">${load.acwr != null ? fmtRatio(load.acwr) : DASH}</td><td colspan="2"></td></tr>
      <tr><td>Fitness (CTL)</td><td class="num" colspan="3">${load.ctlStart != null ? fmtInt(load.ctlStart) + ' → ' + fmtInt(load.ctlEnd) : DASH}</td></tr>
      <tr><td>VO2max</td><td class="num" colspan="3">${f.vo2Start != null ? fmtDec1(f.vo2Start) + ' → ' + fmtDec1(f.vo2End) : f.vo2End != null ? fmtDec1(f.vo2End) : DASH}</td></tr>
      <tr><td>Garmin marathon prediction</td><td class="num" colspan="3">${f.garminStart ? fmtDuration(f.garminStart) + ' → ' + fmtDuration(f.garminEnd) : f.garminEnd ? fmtDuration(f.garminEnd) : DASH}</td></tr>
    </tbody>`;

  $('#reviewHighlights').innerHTML = r.highlights.length
    ? r.highlights.map(h => `<li><i class="dot st-${h.level === 'info' ? 'none' : h.level}"></i><span>${esc(h.text)}</span></li>`).join('')
    : '<li class="hint">Nothing to note for this week.</li>';
}

export function initReview() {
  $('#revPrev').addEventListener('click', () => { offset++; renderReview(); });
  $('#revNext').addEventListener('click', () => { offset = Math.max(0, offset - 1); renderReview(); });
  $('#revThis').addEventListener('click', () => { offset = 0; renderReview(); });
}
