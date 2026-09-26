// Settings from settings.json, through the local server's API (serve.py). Pure data code, no DOM.

/** Load { settings, firstRun }, or { error } if the server can't give them (e.g. a plain file server) */
export async function loadSettings() {
  try {
    const res = await fetch('api/settings', { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) return { error: body.error || `Settings could not be loaded (HTTP ${res.status}).` };
    return { settings: body.settings, firstRun: body.first_run };
  } catch (e) {
    return { error: 'Settings need the app server. Start the app with start.bat or serve.py.' };
  }
}

/** Save the whole settings object. Returns { settings } or { errors: { field: message } } or { error } */
export async function saveSettings(settings) {
  try {
    const res = await fetch('api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    });
    const body = await res.json();
    if (res.ok) return { settings: body.settings };
    return body.errors ? { errors: body.errors } : { error: body.error || `Saving failed (HTTP ${res.status}).` };
  } catch (e) {
    return { error: 'Could not reach the app server. Is it still running?' };
  }
}

/**
 * The goals as the race list the tabs use: time trials (with their results) and the main race
 * (with its goal time), in date order. Same shape as the old content/races.json.
 */
export function racesFromSettings(settings) {
  const g = settings?.goals;
  if (!g) return [];
  const races = [...(g.time_trials || []), ...(g.main_race ? [g.main_race] : [])];
  return races.filter(r => r && r.date).sort((a, b) => a.date.localeCompare(b.date));
}
