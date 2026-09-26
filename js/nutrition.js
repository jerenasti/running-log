// Nutrition: fuel is tied to the training, not "earned" by it. Pure calculations, no DOM code.
// All numbers are general sports nutrition guidelines in grams per kg of body weight (g/kg),
// collected here so they are easy to check and adjust.

import { DAY_MS, dayKey, startOfDay } from './dates.js';
import { parseDate } from './parse.js';

export const LONG_MINUTES = 75;        // a run this long or longer counts as a long run
export const PROTEIN_PER_DAY = 1.6;    // g/kg per day

/** Daily carbohydrate target by day type, g/kg */
export const DAY_TARGETS = {
  rest:        { label: 'Rest day',          carbs: [3, 5] },
  easy:        { label: 'Easy',              carbs: [3, 5] },
  quality:     { label: 'Tempo / intervals', carbs: [5, 7] },
  long:        { label: 'Long run',          carbs: [6, 8] },
  'race-prep': { label: 'Day before race',   carbs: [7, 8] },
  'carb-load': { label: 'Carb loading',      carbs: [10, 12] },
  race:        { label: 'Race day',          carbs: [6, 8] },
};

/** Recovery meal after a workout, g/kg */
export const RECOVERY = {
  easy:    { carbs: null,       protein: 0.3, when: 'Your next normal meal is enough.' },
  quality: { carbs: [1.0, 1.0], protein: 0.3, when: 'Within an hour after the session.' },
  long:    { carbs: [1.0, 1.2], protein: 0.3, when: 'Within an hour. Drink too, and add some salt after a sweaty run.' },
};

/** Tip for the day before a workout of each type (Nutrition and Overview tabs) */
export const TOMORROW_TIPS = {
  rest: 'No workout scheduled. Eat normally. Rest days are when your body rebuilds, so keep protein up.',
  easy: 'An easy run needs no special fuelling. Eat normally.',
  quality: 'Have a carb-rich dinner tonight and a light, easily digested breakfast 2–3 hours before the session.',
  long: 'Have a carb-rich dinner tonight and breakfast 2–3 hours before the run.',
  'race-prep': 'Race tomorrow: see the race-week plan on the Nutrition tab.',
  'carb-load': 'Carb loading: see the race-week plan on the Nutrition tab.',
  race: 'Race day: see the race-week plan on the Nutrition tab.',
};

/** Recovery advice after a workout as text; kg may be null (then only g/kg is shown) */
export function recoveryAdvice(type, kg, fmtGrams) {
  const r = RECOVERY[type];
  const g = perKg => kg ? fmtGrams(perKg.map(x => x * kg)) + ' (' + (perKg[0] === perKg[1] ? perKg[0] : perKg.join('–')) + ' g/kg)' : (perKg[0] === perKg[1] ? perKg[0] : perKg.join('–')) + ' g/kg';
  const protein = g([r.protein, r.protein]);
  return r.carbs ? `Carbs ${g(r.carbs)} and protein ${protein}. ${r.when}` : `${r.when} Include about ${protein} of protein.`;
}

/** Carbs during long runs and races, g per hour */
export const FUELING = { training: [30, 60], marathon: [60, 90], startAfterMin: 45 };

/* ---------- Classifying workouts ---------- */
const HARD_WORDS = /tempo|interval|repeat|hill|threshold|progress|fartlek|vo2|speed|time\s*trial|\btt\b|\btest\b|testi|aika-ajo/i;
const HARD_LABELS = ['TEMPO', 'LACTATE_THRESHOLD', 'VO2MAX', 'ANAEROBIC_CAPACITY', 'SPRINT'];
const isRun = type => /run|juoks|treadmill|trail/i.test(type || '');

/** Long run > tempo/intervals > easy. Non-running activities count as easy. */
export function classify({ type, title, minutes, teLabel }) {
  if (!isRun(type)) return 'easy';
  if (/long/i.test(title || '') || minutes >= LONG_MINUTES) return 'long';
  if (HARD_WORDS.test(title || '') || HARD_LABELS.includes(teLabel)) return 'quality';
  return 'easy';
}

/** Typical running pace (median of the last 10 runs), seconds per km */
function typicalPace(acts) {
  const paces = acts.filter(a => isRun(a.type) && a.km > 0 && a.sec > 0).slice(-10).map(a => a.sec / a.km).sort((a, b) => a - b);
  return paces.length ? paces[Math.floor(paces.length / 2)] : 400;
}

/** Garmin's calorie estimate per km of running over the last 6 weeks (background information only) */
export function kcalPerKm(acts, today = new Date()) {
  const since = today - 42 * DAY_MS;
  const runs = acts.filter(a => isRun(a.type) && a.date >= since && a.km > 0 && a.kcal > 0);
  const km = runs.reduce((s, a) => s + a.km, 0);
  return km ? runs.reduce((s, a) => s + a.kcal, 0) / km : null;
}

/** Scheduled Garmin workouts with distance (from the title, e.g. "(12km)"), estimated minutes and type */
export function plannedWorkouts(schedule, acts) {
  const pace = typicalPace(acts);
  return (schedule || []).map(w => {
    const m = (w.title || '').match(/\((\d+(?:[.,]\d+)?)\s*km\)/i);
    const km = m ? parseFloat(m[1].replace(',', '.')) : null;
    const minutes = km ? km * pace / 60 : null;
    return { date: parseDate(w.date), key: w.date, title: w.title, km, minutes, type: classify({ type: w.sport, title: w.title, minutes }) };
  });
}

/* ---------- Races ---------- */
const daysUntil = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);

/** 21 km or longer: carb loading on the two days before, view opens 7 days before. Shorter: 3 days. */
export function raceDetails(race) {
  const long = race.distance_km >= 21;
  const marathon = race.distance_km >= 30;
  return {
    ...race, day: parseDate(race.date), long, windowDays: long ? 7 : 3,
    morning: long ? { carbs: [2, 3], when: 'about 3 hours before the start' } : { carbs: [1, 2], when: '2–3 hours before the start' },
    during: marathon ? { carbs: FUELING.marathon, text: 'Take 60–90 g of carbs per hour, starting after about 30–45 minutes. Use only gels and drinks you have practised with.' }
      : long ? { carbs: FUELING.training, text: 'Take 30–60 g of carbs per hour, e.g. a gel every 30–40 minutes.' }
      : { carbs: null, text: 'No fuel needed during a race this short. Water at the aid stations is enough.' },
  };
}

/** The race whose race-week window includes `today`, or null */
export function activeRace(races, today = new Date()) {
  return (races || []).map(raceDetails).filter(r => r.day)
    .map(r => ({ ...r, daysLeft: daysUntil(today, r.day) }))
    .filter(r => r.daysLeft >= 0 && r.daysLeft <= r.windowDays)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0] || null;
}

/** Day type set by an upcoming race, or null */
export function raceDayType(race, date) {
  if (!race) return null;
  const d = daysUntil(date, race.day);
  if (d === 0) return 'race';
  if (race.long && (d === 1 || d === 2)) return 'carb-load';
  if (!race.long && d === 1) return 'race-prep';
  return null;
}

/* ---------- Daily plan ---------- */
const RANK = { rest: 0, easy: 1, quality: 2, long: 3 };

/**
 * Day type for a date: a race-week day first, then what was actually done that day,
 * then what is scheduled, otherwise a rest day.
 */
export function dayType(date, { acts, planned, race }) {
  const byRace = raceDayType(race, date);
  if (byRace) return { type: byRace, source: 'race' };
  const key = dayKey(date);
  const done = acts.filter(a => dayKey(a.date) === key && (a.km > 0 || a.sec >= 20 * 60))
    .map(a => classify({ type: a.type, title: a.title, minutes: a.sec / 60, teLabel: a.teLabel }));
  if (done.length) return { type: done.sort((a, b) => RANK[b] - RANK[a])[0], source: 'done' };
  const plan = planned.filter(p => p.key === key).sort((a, b) => RANK[b.type] - RANK[a.type])[0];
  if (plan) return { type: plan.type, source: 'planned', plan };
  return { type: 'rest', source: 'none' };
}

/** grams = body weight × g/kg; returns [low, high] or null without a weight */
export const grams = (kg, perKg) => kg && perKg ? perKg.map(x => x * kg) : null;

/* ---------- Meal ideas ---------- */
const MEAL_TAG = { rest: 'rest', easy: 'easy', quality: 'quality', long: 'long', 'race-prep': 'carb-load', 'carb-load': 'carb-load', race: 'race-morning' };
const FALLBACK = { rest: 'easy', easy: 'rest', 'race-morning': 'carb-load', 'carb-load': 'long' };

// Small string hash, so the same day always gets the same meals but different days vary
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

/** Up to n meals for a slot that suit the day type, picked the same way every time for the same seed */
export function pickMeals(meals, dayTypeKey, slot, n, seed) {
  const tag = MEAL_TAG[dayTypeKey] || dayTypeKey;
  let pool = (meals || []).filter(m => m.slot === slot && (m.days || []).includes(tag));
  if (!pool.length && FALLBACK[tag]) pool = (meals || []).filter(m => m.slot === slot && (m.days || []).includes(FALLBACK[tag]));
  if (!pool.length) pool = (meals || []).filter(m => m.slot === slot);
  const start = hash(seed + slot) % Math.max(pool.length, 1);
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, n);
}
