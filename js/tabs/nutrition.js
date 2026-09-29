// Nutrition tab: race-week fuelling, tomorrow's advice, daily targets and the next 7 days.
// Numbers and rules live in ../nutrition.js, races come from the settings (settings.json).

import { state } from '../state.js';
import {
  DAY_TARGETS, FUELING, PROTEIN_PER_DAY, LONG_MINUTES, TOMORROW_TIPS, plannedWorkouts, activeRace, dayType, grams, kcalPerKm,
} from '../nutrition.js';
import { describeWorkout, describePlanned } from '../workouts.js';
import { fmtInt, fmtKm, fmtDec1, distLabel, fmtGrams, fmtHm, fmtDate, fmtWeekday, esc } from '../format.js';
import { dayKey, addDays } from '../dates.js';

const $ = s => document.querySelector(s);
const badge = type => `<span class="type-badge">${DAY_TARGETS[type]?.label || type}</span>`;
const perKg = r => r ? (r[0] === r[1] ? r[0] : r[0] + '–' + r[1]) + ' g/kg' : '';

const fuelText = () => `Practise race fuelling: take ${FUELING.training[0]}–${FUELING.training[1]} g of carbs per hour ` +
  `(e.g. a gel or sports drink every 30–40 min), starting after about ${FUELING.startAfterMin} minutes. ` +
  `Before a marathon, build up to ${FUELING.marathon[0]}–${FUELING.marathon[1]} g per hour.`;

/* ---------- Race week ---------- */
function renderRace(race, ctx) {
  const el = $('#raceCard');
  el.hidden = !race;
  if (!race) return;
  const { kg, acts, planned } = ctx;
  const rows = [];
  for (let i = 0; i <= race.daysLeft; i++) {
    const date = addDays(new Date(), i);
    const dt = dayType(date, { acts, planned, race });
    const target = grams(kg, DAY_TARGETS[dt.type].carbs);
    const tip = {
      'carb-load': 'Carb loading. Familiar, low-fibre food: white bread, rice, pasta, potatoes, juice. Go easy on vegetables and whole grains.',
      'race-prep': 'A carb-rich day. Familiar food, nothing new.',
      race: `Breakfast with ${fmtGrams(grams(kg, race.morning.carbs))} of carbs (${perKg(race.morning.carbs)}) ${race.morning.when}. ${race.during.text}`,
    }[dt.type] || 'Normal meals. Training gets lighter this week, so you don\'t need extra food yet.';
    rows.push(`<tr><td class="num">${fmtWeekday(date)}</td><td>${badge(dt.type)}</td>
      <td class="num">${fmtGrams(target)} <span class="muted">${perKg(DAY_TARGETS[dt.type].carbs)}</span></td><td class="rule">${tip}</td></tr>`);
  }
  const when = race.daysLeft === 0 ? 'today' : race.daysLeft === 1 ? 'tomorrow' : `in ${race.daysLeft} days`;
  el.innerHTML = `
    <div class="card-head"><div><h2>Race week: ${esc(race.name)} ${when}</h2>
      <p class="sub">${fmtKm(race.distance_km)} ${distLabel()} on ${fmtDate(race.day)}. ${race.long ? 'Carb loading on the two days before.' : 'A carb-rich day before is enough for this distance.'}</p></div></div>
    <div class="table-wrap"><table class="rules">
      <thead><tr><th>Day</th><th>Plan</th><th class="num">Carbs / day</th><th>What to do</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
}

/* ---------- Tomorrow ---------- */
function renderTomorrow(ctx) {
  const { planned, race, schedule } = ctx;
  const date = addDays(new Date(), 1);
  const dt = dayType(date, { acts: [], planned, race });
  const plan = dt.plan;
  let fuel = '';
  if (dt.type === 'long') {
    fuel = plan?.minutes >= LONG_MINUTES
      ? `<p class="notice fuel">${fuelText()}</p>`
      : `<p class="hint">At about ${fmtHm((plan?.minutes || 0) * 60)} this run is under ${LONG_MINUTES} minutes, so water is enough. You can still practise with one gel.</p>`;
  }
  $('#tomorrowCard').innerHTML = `
    <div class="card-head"><div><h2>Tomorrow, ${fmtWeekday(date)}</h2>
      <p class="sub">${plan ? esc(describePlanned(plan).name) + (plan.km ? ` · about ${fmtHm(plan.minutes * 60)} at your usual pace` : '') : schedule.length ? 'Nothing scheduled in your Garmin calendar.' : 'No scheduled workouts found in your Garmin calendar.'}</p></div>${badge(dt.type)}</div>
    <p class="tip">${TOMORROW_TIPS[dt.type]}</p>
    ${fuel}`;
}

/* ---------- Your numbers ---------- */
function renderBasis(kg, weight) {
  const rows = ['rest', 'quality', 'long', 'carb-load'].map(k => `
    <tr><td>${DAY_TARGETS[k].label}${k === 'rest' ? ' / easy' : ''}</td><td class="num">${perKg(DAY_TARGETS[k].carbs)}</td><td class="num">${fmtGrams(grams(kg, DAY_TARGETS[k].carbs))}</td></tr>`).join('');
  $('#basisCard').innerHTML = `
    <div class="card-head"><div><h2>Your daily targets</h2>
      <p class="sub">${weight ? `Body weight ${fmtDec1(weight.kg)} kg (${weight.source === 'manual' ? 'entered in Settings' : `Garmin weigh-in ${fmtDate(new Date(weight.date + 'T00:00'))}`}) × g/kg.` : 'No weight yet, so targets are shown per kg only. Add a Garmin weigh-in or <a href="#settings">enter your weight in Settings</a>.'}</p></div></div>
    <div class="table-wrap"><table class="rules targets">
      <thead><tr><th>Day</th><th class="num">Carbs</th><th class="num">Per day</th></tr></thead>
      <tbody>${rows}
        <tr><td>Protein, every day</td><td class="num">${PROTEIN_PER_DAY} g/kg</td><td class="num">${fmtGrams(grams(kg, [PROTEIN_PER_DAY, PROTEIN_PER_DAY]))}</td></tr></tbody>
    </table></div>`;
}

/* ---------- The next 7 days ---------- */
function renderWeek(ctx) {
  const { kg, acts, planned, race } = ctx;
  const kpk = kcalPerKm(acts);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(new Date(), i), key = dayKey(date);
    const dt = dayType(date, { acts, planned, race });
    const carbs = grams(kg, DAY_TARGETS[dt.type].carbs);
    const doneKcal = acts.filter(a => dayKey(a.date) === key).reduce((s, a) => s + (a.kcal || 0), 0);
    const energy = dt.source === 'done' && doneKcal ? doneKcal : dt.plan?.km && kpk ? dt.plan.km * kpk : null;
    const what = dt.source === 'race' ? esc(race.name) : dt.source === 'done' ? 'Done: ' + esc(acts.filter(a => dayKey(a.date) === key).map(a => describeWorkout(a).name).join(', '))
      : dt.plan ? esc(describePlanned(dt.plan).name) : 'No workout scheduled';
    days.push(`<div class="meal-block">
      <div class="menu-head"><span class="num">${i === 0 ? 'Today' : fmtWeekday(date)}</span>${badge(dt.type)}<span class="meal-title muted">${what}</span></div>
      <p class="targets-line num">Carbs ${fmtGrams(carbs)} · protein ${fmtGrams(grams(kg, [PROTEIN_PER_DAY, PROTEIN_PER_DAY]))}${energy ? ` · training ≈ ${fmtInt(Math.round(energy / 10) * 10)} kcal <span class="muted">(Garmin estimate)</span>` : ''}</p>
    </div>`);
  }
  $('#weekMenu').innerHTML = days.join('');
}

/* ---------- Tab ---------- */
export function renderNutrition() {
  const has = state.acts.length > 0;
  $('#nutNoData').hidden = has;
  $('#nutDash').hidden = !has;
  if (!has) return;

  const c = state.content || {};
  // Races come from the settings; a settings problem is reported here
  const errors = [c.races?.error && !/not found/.test(c.races.error) ? c.races.error : null].filter(Boolean);
  $('#nutContentError').hidden = !errors.length;
  $('#nutContentError').textContent = errors.join(' ');

  const weight = state.meta?.weight || null;
  const schedule = state.meta?.schedule || [];
  const ctx = {
    kg: weight?.kg || null,
    acts: state.acts,
    schedule,
    planned: plannedWorkouts(schedule, state.acts),
    race: activeRace(c.races?.data?.races || []),
  };
  renderRace(ctx.race, ctx);
  renderTomorrow(ctx);
  renderBasis(ctx.kg, weight);
  renderWeek(ctx);
}
