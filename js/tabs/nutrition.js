// Nutrition tab: race-week fuelling, tomorrow's tip, recovery meals after recent runs and a 7-day menu.
// Numbers and rules live in ../nutrition.js, meal ideas in content/meals.json, races from the settings (settings.json).

import { state } from '../state.js';
import {
  DAY_TARGETS, FUELING, PROTEIN_PER_DAY, LONG_MINUTES, TOMORROW_TIPS, recoveryAdvice, recoveryNeed, hoursToNextSession,
  classify, plannedWorkouts, activeRace, dayType, grams, pickMeals, kcalPerKm,
} from '../nutrition.js';
import { fmtInt, fmtKm, fmtGrams, fmtHm, fmtDuration, fmtDate, fmtWeekday, esc } from '../format.js';
import { dayKey, addDays } from '../dates.js';

const $ = s => document.querySelector(s);
const isRun = a => /run|juoks|treadmill|trail/i.test(a.type || '');
const badge = type => `<span class="type-badge">${DAY_TARGETS[type]?.label || type}</span>`;
const perKg = r => r ? (r[0] === r[1] ? r[0] : r[0] + '–' + r[1]) + ' g/kg' : '';

function mealList(meals, withSlot = false) {
  if (!meals.length) return '<p class="hint">No meal ideas for this yet. Add some to content/meals.json.</p>';
  return `<ul class="meals">${meals.map(({ m, slot }) => `
    <li>${withSlot ? `<span class="slot">${slot}</span>` : ''}<div class="meal-body"><span class="meal-name">${esc(m.name)}</span>
      <span class="muted">carbs ${esc(m.carbs || '?')} · protein ${esc(m.protein || '?')}</span>
      ${m.note ? `<span class="meal-note">${esc(m.note)}</span>` : ''}</div></li>`).join('')}</ul>`;
}
const ideas = (meals, type, slot, n, seed) => pickMeals(meals, type, slot, n, seed).map(m => ({ m, slot }));

const fuelText = () => `Practise race fuelling: take ${FUELING.training[0]}–${FUELING.training[1]} g of carbs per hour ` +
  `(e.g. a gel or sports drink every 30–40 min), starting after about ${FUELING.startAfterMin} minutes. ` +
  `Before a marathon, build up to ${FUELING.marathon[0]}–${FUELING.marathon[1]} g per hour.`;

/* ---------- Race week ---------- */
function renderRace(race, ctx) {
  const el = $('#raceCard');
  el.hidden = !race;
  if (!race) return;
  const { kg, meals, acts, planned } = ctx;
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
      <p class="sub">${fmtKm(race.distance_km)} km on ${fmtDate(race.day)}. ${race.long ? 'Carb loading on the two days before.' : 'A carb-rich day before is enough for this distance.'}</p></div></div>
    <div class="table-wrap"><table class="rules">
      <thead><tr><th>Day</th><th>Plan</th><th class="num">Carbs / day</th><th>What to do</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
    ${race.long ? `<h3 class="mini">Carb-loading ideas</h3>${mealList([...ideas(meals, 'carb-load', 'dinner', 2, race.date), ...ideas(meals, 'carb-load', 'snack', 2, race.date)])}` : ''}`;
}

/* ---------- Tomorrow ---------- */
function renderTomorrow(ctx) {
  const { kg, meals, planned, race, schedule } = ctx;
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
      <p class="sub">${plan ? esc(plan.title) + (plan.km ? ` · about ${fmtHm(plan.minutes * 60)} at your usual pace` : '') : schedule.length ? 'Nothing scheduled in your Garmin calendar.' : 'No scheduled workouts found in your Garmin calendar.'}</p></div>${badge(dt.type)}</div>
    <p class="tip">${TOMORROW_TIPS[dt.type]}</p>
    ${fuel}
    ${mealList([...ideas(meals, dt.type, 'dinner', 1, 'eve' + dayKey(date)), ...ideas(meals, dt.type, 'breakfast', 1, dayKey(date))].map((x, i) => ({ ...x, slot: i ? 'Breakfast' : 'Dinner tonight' })), true)}`;
}

/* ---------- Your numbers ---------- */
function renderBasis(kg, weight) {
  const rows = ['rest', 'quality', 'long', 'carb-load'].map(k => `
    <tr><td>${DAY_TARGETS[k].label}${k === 'rest' ? ' / easy' : ''}</td><td class="num">${perKg(DAY_TARGETS[k].carbs)}</td><td class="num">${fmtGrams(grams(kg, DAY_TARGETS[k].carbs))}</td></tr>`).join('');
  $('#basisCard').innerHTML = `
    <div class="card-head"><div><h2>Your daily targets</h2>
      <p class="sub">${weight ? `Body weight ${fmtKm(weight.kg)} kg (${weight.source === 'manual' ? 'entered in Settings' : `Garmin weigh-in ${fmtDate(new Date(weight.date + 'T00:00'))}`}) × g/kg.` : 'No weight yet, so targets are shown per kg only. Add a Garmin weigh-in or <a href="#settings">enter your weight in Settings</a>.'}</p></div></div>
    <div class="table-wrap"><table class="rules targets">
      <thead><tr><th>Day</th><th class="num">Carbs</th><th class="num">Per day</th></tr></thead>
      <tbody>${rows}
        <tr><td>Protein, every day</td><td class="num">${PROTEIN_PER_DAY} g/kg</td><td class="num">${fmtGrams(grams(kg, [PROTEIN_PER_DAY, PROTEIN_PER_DAY]))}</td></tr></tbody>
    </table></div>`;
}

/* ---------- After recent runs ---------- */
function renderRecent(ctx) {
  const { kg, meals, acts, planned } = ctx;
  const since = addDays(new Date(), -6);
  const runs = acts.filter(a => isRun(a) && a.date >= since && a.km > 0).slice(-5).reverse();
  if (!runs.length) { $('#recentMeals').innerHTML = '<p class="hint">No runs in the last 7 days.</p>'; return; }
  $('#recentMeals').innerHTML = runs.map(a => {
    const type = classify({ type: a.type, title: a.title, minutes: a.sec / 60, teLabel: a.teLabel });
    const advice = recoveryAdvice(recoveryNeed({ type, minutes: a.sec / 60, hoursToNext: hoursToNextSession(a, acts, planned) }), kg, fmtGrams);
    return `<div class="meal-block">
      <div class="menu-head"><span class="num">${fmtWeekday(a.date)}</span>${badge(type)}<span class="meal-title">${esc(a.title || a.type)}</span>
        <span class="muted num">${fmtKm(a.km)} km · ${fmtDuration(a.sec)}${a.kcal ? ` · Garmin estimate ${fmtInt(a.kcal)} kcal` : ''}</span></div>
      <p class="tip">${advice}</p>
      ${a.sec >= LONG_MINUTES * 60 ? `<p class="notice fuel">This run lasted ${fmtHm(a.sec)}. ${fuelText()}</p>` : ''}
      ${mealList(ideas(meals, type, 'recovery', type === 'easy' ? 2 : 3, dayKey(a.date) + a.title))}
    </div>`;
  }).join('');
}

/* ---------- 7-day menu ---------- */
function renderWeek(ctx) {
  const { kg, meals, acts, planned, race } = ctx;
  const kpk = kcalPerKm(acts);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(new Date(), i), key = dayKey(date);
    const dt = dayType(date, { acts, planned, race });
    const carbs = grams(kg, DAY_TARGETS[dt.type].carbs);
    const doneKcal = acts.filter(a => dayKey(a.date) === key).reduce((s, a) => s + (a.kcal || 0), 0);
    const energy = dt.source === 'done' && doneKcal ? doneKcal : dt.plan?.km && kpk ? dt.plan.km * kpk : null;
    const what = dt.source === 'race' ? esc(race.name) : dt.source === 'done' ? 'Done: ' + esc(acts.filter(a => dayKey(a.date) === key).map(a => a.title).join(', '))
      : dt.plan ? esc(dt.plan.title) : 'No workout scheduled';
    const slots = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
    if (['easy', 'quality', 'long'].includes(dt.type)) slots.push(['recovery', 'After training']);
    if (['carb-load', 'race-prep'].includes(dt.type)) slots.push(['snack', 'Snack']);
    const list = slots.flatMap(([slot, name]) => pickMeals(meals, dt.type, slot, 1, key).map(m => ({ m, slot: name })));
    days.push(`<div class="meal-block">
      <div class="menu-head"><span class="num">${i === 0 ? 'Today' : fmtWeekday(date)}</span>${badge(dt.type)}<span class="meal-title muted">${what}</span></div>
      <p class="targets-line num">Carbs ${fmtGrams(carbs)} · protein ${fmtGrams(grams(kg, [PROTEIN_PER_DAY, PROTEIN_PER_DAY]))}${energy ? ` · training ≈ ${fmtInt(Math.round(energy / 10) * 10)} kcal <span class="muted">(Garmin estimate)</span>` : ''}</p>
      ${mealList(list, true)}
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
  // Races come from the settings; a settings problem is reported here too
  const errors = [c.meals?.error, c.races?.error && !/not found/.test(c.races.error) ? c.races.error : null].filter(Boolean);
  $('#nutContentError').hidden = !errors.length;
  $('#nutContentError').textContent = errors.join(' ');

  const weight = state.meta?.weight || null;
  const schedule = state.meta?.schedule || [];
  const ctx = {
    kg: weight?.kg || null,
    meals: c.meals?.data?.meals || [],
    acts: state.acts,
    schedule,
    planned: plannedWorkouts(schedule, state.acts),
    race: activeRace(c.races?.data?.races || []),
  };
  renderRace(ctx.race, ctx);
  renderTomorrow(ctx);
  renderBasis(ctx.kg, weight);
  renderRecent(ctx);
  renderWeek(ctx);
}
