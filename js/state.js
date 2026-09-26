// App state shared by all tabs, and saving it in the browser (localStorage).
// The saved copy lets the page show data immediately, before data/activities.json has loaded.

const STORE_KEY = 'juoksupaivakirja:v1';

export const state = {
  acts: [],        // Garmin activities sorted oldest → newest: { date, type, title, km, sec, hr, maxHr, teLabel, zones }
  garminMeta: null, // Garmin extras as fetched: { hrSettings: { max_hr, zone_floors, method }, restingHr: [{ date, bpm }], … }
  meta: null,      // the same with the settings applied (manual weight/HR, no plan): what the tabs use (see applySettings)
  period: '12',    // Training: '12' | '26' | '52' | 'all' weeks
  sport: 'run',    // Training: 'run' | 'all'
  goal: 0,         // weekly distance goal in km (0 = not set), from settings.json (goals.weekly_km)
  showAll: false,  // Training: show every activity in the table
  fetchedAt: null,  // when data/activities.json was written (ms), for the data freshness check (not saved)
  fetchStatus: null, // data/fetch_status.json: how the last Garmin fetch went (not saved)
  content: null,   // content/meals.json and the races from the settings: { meals: { data | error }, races: { data | error } } (not saved)
  settings: null,  // settings.json through the app server (serve.py), or null if it isn't available (not saved)
  firstRun: false, // settings.json doesn't exist yet: the first-run wizard is showing (not saved)
  theme: 'system', // appearance.theme, remembered so the page opens in the right theme before the settings load
};

export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      acts: state.acts.map(a => ({ ...a, date: a.date.toISOString() })),
      meta: state.garminMeta,
      period: state.period, sport: state.sport, theme: state.theme,
    }));
  } catch (e) { /* storage full or blocked: the app still works without it */ }
}

export function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!o) return;
    state.period = o.period || '12';
    state.sport = o.sport || 'run';
    // Older versions kept the weekly goal here; app.js moves it into settings.json once
    state.goal = +o.goal || 0;
    state.theme = o.theme || 'system';
    // Only Garmin data (with zones/label fields) is restored; older saved copies are ignored.
    if (!Array.isArray(o.acts) || !o.acts.length || !('zones' in o.acts[0])) return;
    state.acts = o.acts.map(a => ({ ...a, date: new Date(a.date), sec: a.sec ?? NaN, hr: a.hr ?? NaN }));
    state.garminMeta = o.meta || null;
  } catch (e) { /* unreadable saved copy: start empty */ }
}
