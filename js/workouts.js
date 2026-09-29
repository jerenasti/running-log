// Workout names and types for display: "Helsinki - W2 Sat Long Run - 11km Progressi" → Long · "Long Run".
// Pure logic, no DOM code.
//
// Garmin names an activity "<City> - <workout name>" (a scheduled workout) or "<City> <Sport>" (anything else).
// Runna workout names look like "W3 Tue Easy Run - 5.5km Easy Run (5.5km)", and Garmin keeps only the first
// 32 characters of them in the activity name, so the end is often cut ("5km Easy Ru"). The same workout in the
// Garmin calendar (matched by workout id) still has the whole name.

export const KIND_LABELS = { easy: 'Easy', tempo: 'Tempo', intervals: 'Intervals', long: 'Long', test: 'Time trial', run: 'Run' };
export const LONG_RUN_MINUTES = 75;         // same limit as the nutrition rules
const WORKOUT_NAME_MAX = 32;                // Garmin keeps this much of a scheduled workout's name

const RUNNA = /^(W\d+\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b)\s*(.*)$/i;
const SPORT = /^((?:Treadmill |Trail |Indoor |Virtual |Track |Street )?(?:Running|Run|Cycling|Biking|Walking|Hiking|Swimming|Pool Swim|Open Water Swimming|Strength(?: Training)?|Rowing|Yoga|Cardio|Skiing|Elliptical|Stair Stepper))$/i;
// A place name before the sport or the workout: one to three words without digits
const PLACE = /^[\p{L}'’.]+(?:[ -][\p{L}'’.]+){0,2}$/u;
const isRun = type => /run|juoks|treadmill|trail/i.test(type || '');

// Kind from words, strongest first
const KIND_WORDS = [
  ['test', /time\s*trial|\btt\b|\btest\b|testi|aika-ajo/i],
  ['intervals', /interval|repeat|\breps?\b|hill|fartlek|speed|\d+\s*x\s*\d|vo2/i],
  ['tempo', /tempo|threshold|progress|rolling|kynnys/i],
  ['long', /\blong\b|pitkä/i],
  ['easy', /easy|recovery|kevyt|palauttava/i],
];
const LABEL_KINDS = { TEMPO: 'tempo', LACTATE_THRESHOLD: 'tempo', VO2MAX: 'intervals', ANAEROBIC_CAPACITY: 'intervals', SPRINT: 'intervals',
  RECOVERY: 'easy', AEROBIC_BASE: 'easy' };

const kindFromWords = text => KIND_WORDS.find(([, re]) => re.test(text || ''))?.[0] || null;

/** Remove distances ("5.5km", "(12km)"), repeat markers ("#2") and a cut-off "(…" at the end */
function tidy(text) {
  return (text || '')
    .replace(/\s*\([^)]*$/, '')                                   // "Progressive Run (" → cut off
    .replace(/\(?\b\d+(?:[.,]\d+)?\s?(?:km|mi)\b\)?/gi, '')         // distances in km or miles (400m stays)
    .replace(/#\d+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–·]+|[\s\-–·]+$/g, '')
    .trim();
}
const sentence = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/**
 * Split a raw activity or plan name into { name, runnaKind (the Runna workout type text, e.g. "Long Run"),
 * sport (for "<City> <Sport>" names) }. `planTitle` is the same workout's name in the Garmin calendar.
 */
export function cleanName(raw, planTitle = null) {
  let text = (raw || '').trim();
  // "<City> - W3 Tue …": drop the place
  const dash = text.indexOf(' - ');
  if (dash > 0 && PLACE.test(text.slice(0, dash)) && RUNNA.test(text.slice(dash + 3))) text = text.slice(dash + 3);
  // "<City> Running"
  const words = text.split(' ');
  for (let i = 1; i <= Math.min(3, words.length - 1); i++) {
    const place = words.slice(0, i).join(' '), rest = words.slice(i).join(' ');
    if (PLACE.test(place) && SPORT.test(rest)) return { name: sentence(rest.toLowerCase()), runnaKind: null, sport: rest };
  }
  if (SPORT.test(text)) return { name: sentence(text.toLowerCase()), runnaKind: null, sport: text };

  const m = text.match(RUNNA);
  if (!m) return { name: sentence(tidy(text)) || text, runnaKind: null, sport: null };

  // Runna: "W3 Tue Easy Run - 5.5km Easy Run": type before " - ", details after it
  const full = planTitle && RUNNA.test(planTitle) ? planTitle : text;
  const cut = full === text && text.length >= WORKOUT_NAME_MAX;   // the end may be missing
  const body = full.match(RUNNA)[2];
  const [typePart, ...rest] = body.split(' - ');
  const runnaKind = tidy(typePart);
  let detail = tidy(rest.join(' - '));
  // A detail that may be cut short is dropped. If the cut fell inside a bracket ("Rolling 300s (5km"),
  // the words before it are whole and stay.
  if (cut && detail && !/\)$/.test(text) && !/\([^)]*$/.test(text)) detail = '';
  if (detail.toLowerCase() === runnaKind.toLowerCase()) detail = '';
  return { name: detail || runnaKind, runnaKind, sport: null };
}

/**
 * The kind of a run: from the Runna type, then words in the name, then Garmin's training effect label,
 * then the length (75 minutes or more = long). Non-runs have no kind (null).
 */
export function workoutKind({ type, title, minutes, teLabel }, runnaKind = null) {
  if (!isRun(type)) return null;
  const fromRunna = kindFromWords(runnaKind);
  if (fromRunna) return fromRunna;
  const fromName = kindFromWords(title);
  if (fromName) return fromName;
  if (minutes >= LONG_RUN_MINUTES) return 'long';
  return LABEL_KINDS[teLabel] || 'run';
}

/** The name says nothing the kind badge doesn't ("Easy Run" next to Easy, "Running" next to any kind) */
function repeatsKind(name, label, sport) {
  if (!label) return false;
  const n = name.toLowerCase(), l = label.toLowerCase();
  return n === l || n === `${l} run` || n === 'run' || (!!sport && /running/i.test(sport));
}

function describe(c, kind, fallback) {
  const label = kind ? KIND_LABELS[kind] : null;
  const name = c.name || fallback;
  return { name, kind, label, repeatsKind: repeatsKind(name, label, c.sport) };
}

/**
 * What to show for an activity: { name, kind, label, repeatsKind } (kind/label null for other sports).
 * repeatsKind: the badge alone says it all, so lists can leave the name out.
 */
export function describeWorkout(act, planTitle = null) {
  const c = cleanName(act.title, planTitle);
  const kind = workoutKind({ type: act.type, title: act.title, minutes: act.sec / 60, teLabel: act.teLabel }, c.runnaKind);
  return describe(c, kind, act.type || 'Activity');
}

/** The same for a planned workout in the Garmin calendar ({ title, sport }) */
export function describePlanned(w) {
  const c = cleanName(w.title);
  const kind = workoutKind({ type: w.sport || 'running', title: w.title, minutes: 0, teLabel: null }, c.runnaKind);
  return describe(c, kind, 'Workout');
}

/** Garmin workout id → the whole workout name in the plan, for names that Garmin cut short */
export const planTitles = schedule => new Map((schedule || []).filter(w => w.workout_id).map(w => [w.workout_id, w.title]));
