// App state shared by all tabs, and saving it in the browser (localStorage).
// The saved copy lets the page show data immediately, before data/activities.json has loaded.

const STORE_KEY = 'juoksupaivakirja:v1';

export const state = {
  acts: [],        // Garmin activities sorted oldest → newest: { date, type, title, km, sec, hr, maxHr, teLabel, zones }
  meta: null,      // Garmin extras: { hrSettings: { max_hr, zone_floors, method }, restingHr: [{ date, bpm }] }
  period: '12',    // Training: '12' | '26' | '52' | 'all' weeks
  sport: 'run',    // Training: 'run' | 'all'
  goal: 0,         // weekly distance goal in km (0 = not set)
  showAll: false,  // Training: show every activity in the table
  content: null,   // content/meals.json and content/races.json: { meals: { data | error }, races: { data | error } } (not saved)
};

export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      acts: state.acts.map(a => ({ ...a, date: a.date.toISOString() })),
      meta: state.meta,
      period: state.period, sport: state.sport, goal: state.goal,
    }));
  } catch (e) { /* storage full or blocked: the app still works without it */ }
}

export function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!o) return;
    state.period = o.period || '12';
    state.sport = o.sport || 'run';
    state.goal = +o.goal || 0;
    // Only Garmin data (with zones/label fields) is restored; older saved copies are ignored.
    if (!Array.isArray(o.acts) || !o.acts.length || !('zones' in o.acts[0])) return;
    state.acts = o.acts.map(a => ({ ...a, date: new Date(a.date), sec: a.sec ?? NaN, hr: a.hr ?? NaN }));
    state.meta = o.meta || null;
  } catch (e) { /* unreadable saved copy: start empty */ }
}
