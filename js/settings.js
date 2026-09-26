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

/** Check settings without saving them: { errors: { field: message } } (empty when fine) */
export async function validateSettings(settings) {
  try {
    const res = await fetch('api/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    });
    return await res.json();
  } catch (e) {
    return { errors: {} };   // the save at the end still checks everything
  }
}

/** Is garmin_tokens.json in this folder? { found, folder }. The server only checks that the file exists. */
export async function checkTokens(dir) {
  try {
    const res = await fetch('api/check-tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir }),
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

// Garmin's own zone floors as shares of max HR, used when Garmin gave no zones (HR_MAX method)
const DEFAULT_ZONE_SHARES = [0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * Garmin data with the settings applied, so the tabs never have to look at the settings themselves:
 * - plan.source 'none'  → no scheduled workouts
 * - weight manual       → weight { kg, date: null, source: 'manual' }
 * - max HR manual       → hrSettings with that max; zone floors scaled from Garmin's own zones
 *                         (they keep your zone setup), else 50/60/70/80/90% of max
 * - resting HR manual   → restingHrManual (Garmin's daily resting HR stays for the Recovery checks)
 * Every value carries its source ('garmin' | 'manual') so the tabs can say where it came from.
 */
export function applySettings(meta, settings) {
  if (!meta) return meta;
  if (!settings) return { ...meta, weight: meta.weight && { ...meta.weight, source: 'garmin' } };
  const b = settings.body;
  const out = { ...meta };
  if (settings.plan.source === 'none') out.schedule = [];
  out.weight = b.weight_source === 'manual' && b.weight_kg > 0
    ? { kg: b.weight_kg, date: null, source: 'manual' }
    : meta.weight && { ...meta.weight, source: 'garmin' };
  if (b.max_hr_source === 'manual' && b.max_hr > 0) {
    const g = meta.hrSettings;
    const floors = g?.zone_floors?.length === 5 && g.max_hr > 0
      ? g.zone_floors.map(f => Math.round(f * b.max_hr / g.max_hr))
      : DEFAULT_ZONE_SHARES.map(x => Math.round(x * b.max_hr));
    out.hrSettings = { max_hr: b.max_hr, zone_floors: floors, method: 'HR_MAX', source: 'manual' };
  } else if (meta.hrSettings) {
    out.hrSettings = { ...meta.hrSettings, source: 'garmin' };
  }
  out.restingHrManual = b.resting_hr_source === 'manual' && b.resting_hr > 0 ? b.resting_hr : null;
  return out;
}

/** The easy run rule for isEasyRun(): words from the settings, HR limit from the settings or zone 4 */
export function easyRule(settings, meta) {
  const zone4 = meta?.hrSettings?.zone_floors?.[3] ?? null;
  const p = settings?.plan;
  return {
    words: p?.easy_keywords ?? undefined,
    hrLimit: p?.easy_max_hr || zone4,
    hrSource: p?.easy_max_hr ? 'settings' : zone4 ? 'zone 4' : null,
  };
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
