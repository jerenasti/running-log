// App state shared by all tabs, and saving it in the browser (localStorage).

const STORE_KEY = 'juoksupaivakirja:v1';

export const state = {
  acts: [],        // activities sorted oldest → newest: { date, type, title, km, sec, hr }
  cols: {},        // which source column/field each value came from
  source: '',      // "Garmin Connect data", a CSV file name, or "sample data"
  live: false,     // true when showing Garmin data
  period: '12',    // Training: '12' | '26' | '52' | 'all' weeks
  sport: 'run',    // Training: 'run' | 'all'
  goal: 0,         // weekly distance goal in km (0 = not set)
  showAll: false,  // Training: show every activity in the table
  meta: null,      // Garmin extras: { hrSettings: { max_hr, zone_floors, method }, restingHr: [{ date, bpm }] }
};

export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      acts: state.acts.map(a => ({ ...a, date: a.date.toISOString() })),
      cols: state.cols, source: state.source, live: state.live, meta: state.meta,
      period: state.period, sport: state.sport, goal: state.goal,
      savedAt: Date.now(),
    }));
  } catch (e) { /* storage full or blocked: the app still works without it */ }
}

/** Load saved state. Returns the time it was saved (ms), or 0 if no activities were saved. */
export function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!o) return 0;
    state.period = o.period || '12';
    state.sport = o.sport || 'run';
    state.goal = +o.goal || 0;
    if (!Array.isArray(o.acts) || !o.acts.length) return 0;
    state.acts = o.acts.map(a => ({ ...a, date: new Date(a.date), sec: a.sec ?? NaN, hr: a.hr ?? NaN }));
    state.cols = o.cols || {};
    state.source = o.source || '';
    state.live = !!o.live;
    state.meta = o.meta || null;
    return o.savedAt || 0;
  } catch (e) { return 0; }
}

/** Remove the loaded activities but keep preferences such as the weekly goal. */
export function clearData() {
  state.acts = [];
  state.cols = {};
  state.source = '';
  state.live = false;
  state.showAll = false;
  state.meta = null;
  save();
}
