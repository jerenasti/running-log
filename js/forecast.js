// Forecasts: VO2max trend to race day, and marathon time with Daniels' VDOT formula.
// Pure calculations, no DOM code (the Overview tab draws them).
//
// VO2max model: saturating curve  v(t) = a + b · (1 − e^(−t/τ))
//   Improvement slows down toward a plateau (a + b). For a fixed τ the model is linear in a and b,
//   so ordinary least squares gives the fit and a prediction interval. τ (the time constant) cannot
//   be read from a few weeks of data, so the uncertainty band covers every τ in TAU_RANGE.

import { DAY_MS, startOfDay } from './dates.js';
import { parseDate } from './parse.js';

export const MODEL = {
  tauRange: [45, 120],  // days: plausible time constants for VO2max adaptation
  tauDefault: 90,       // used until there is enough data to choose τ from the data
  minDays: 56,          // under 8 weeks of data the forecast is preliminary
  z: 1.2816,            // 80% prediction interval
  backtestDays: 14,     // backtest: hide the last 2 weeks, forecast them, compare
};

const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);

/* ---------- VO2max model ---------- */

/** Least-squares fit of y = a + b·x with x = 1 − e^(−t/τ). Returns a predictor with a standard error. */
function fitSaturating(points, tau) {
  const xs = points.map(p => 1 - Math.exp(-p.t / tau)), ys = points.map(p => p.y), n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx, a = my - b * mx;
  const sse = xs.reduce((s, x, i) => s + (ys[i] - a - b * x) ** 2, 0);
  const s2 = sse / Math.max(n - 2, 1);
  return {
    tau, a, b, sse, plateau: a + b,
    predict(t) {
      const x = 1 - Math.exp(-t / tau);
      // Prediction interval: residual noise + uncertainty of the fitted line at this x
      return { mid: a + b * x, se: Math.sqrt(s2 * (1 + 1 / n + (x - mx) ** 2 / sxx)) };
    },
  };
}

/** τ from the data (least squared error within tauRange) once there are 8 weeks, otherwise the default */
function chooseTau(points) {
  const span = points[points.length - 1].t - points[0].t;
  if (span < MODEL.minDays) return MODEL.tauDefault;
  let best = null;
  for (let tau = MODEL.tauRange[0]; tau <= MODEL.tauRange[1]; tau++) {
    const f = fitSaturating(points, tau);
    if (!best || f.sse < best.sse) best = f;
  }
  return best.tau;
}

/** Central forecast plus a band that covers the 80% prediction interval for every τ in the range */
function modelFor(points) {
  const tau = chooseTau(points);
  const central = fitSaturating(points, tau);
  const edges = [MODEL.tauRange[0], tau, MODEL.tauRange[1]].map(t => fitSaturating(points, t));
  return {
    tau, plateau: central.plateau,
    at(t) {
      const preds = edges.map(f => f.predict(t));
      return {
        mid: central.predict(t).mid,
        lo: Math.min(...preds.map(p => p.mid - MODEL.z * p.se)),
        hi: Math.max(...preds.map(p => p.mid + MODEL.z * p.se)),
      };
    },
  };
}

/**
 * history: [{ date: 'YYYY-MM-DD', vo2max }]. Returns the fitted curve and band for every day
 * from the first measurement to endDate, the backtest, and whether the forecast is preliminary.
 */
export function vo2Forecast(history, endDate) {
  const hist = (history || []).map(h => ({ date: parseDate(h.date), y: h.vo2max })).filter(h => h.date && h.y);
  if (hist.length < 5) return null;
  const t0 = hist[0].date;
  const points = hist.map(h => ({ t: daysBetween(t0, h.date), y: h.y, date: h.date }));
  const model = modelFor(points);

  const series = [];
  for (let t = 0; t <= daysBetween(t0, endDate); t++) {
    series.push({ date: new Date(startOfDay(t0).getTime() + t * DAY_MS), t, ...model.at(t) });
  }

  // Backtest: fit on everything except the last 2 weeks, forecast those days, compare with what happened
  const cut = points[points.length - 1].t - MODEL.backtestDays;
  const train = points.filter(p => p.t <= cut), test = points.filter(p => p.t > cut);
  let backtest = null;
  if (train.length >= 5 && test.length) {
    const m = modelFor(train);
    const errors = test.map(p => m.at(p.t).mid - p.y);
    backtest = {
      trainUntil: train[train.length - 1].date, n: test.length,
      mae: errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length,
      bias: errors.reduce((s, e) => s + e, 0) / errors.length,
      inside: test.filter(p => { const r = m.at(p.t); return p.y >= r.lo && p.y <= r.hi; }).length,
    };
  }

  const spanDays = points[points.length - 1].t;
  return { history: points, series, tau: model.tau, plateau: model.plateau, spanDays, preliminary: spanDays < MODEL.minDays, backtest };
}

/* ---------- Daniels' VDOT ---------- */
// Jack Daniels & Jimmy Gilbert (1979):
//   oxygen cost of running at v metres/minute:   VO2 = −4.60 + 0.182258·v + 0.000104·v²
//   fraction of VO2max sustainable for t minutes: %max = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)
//   VDOT = VO2 / %max

export const MARATHON_M = 42195;

/** VDOT from a race: distance in metres, time in seconds */
export function vdot(distM, sec) {
  const t = sec / 60, v = distM / t;
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}

/** Race time (seconds) that matches a VDOT, found by bisection (VDOT falls as the time grows) */
export function timeForVdot(target, distM = MARATHON_M) {
  if (!(target > 0)) return NaN;
  let lo = distM / 1000 * 120, hi = distM / 1000 * 1200;  // 2:00–20:00 per km
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distM, mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** "3:30:00" or "47:10" → seconds */
export function parseTime(s) {
  const p = String(s || '').trim().split(':').map(Number);
  if (!p.length || p.some(isNaN)) return NaN;
  return p.reduce((acc, x) => acc * 60 + x, 0);
}

/* ---------- Time trials and race results ---------- */

// Keep in sync with TIME_TRIAL in fetch_garmin.py
export const TIME_TRIAL_WORDS = /time\s*trial|\btt\b|\btest\b|testi|aika-ajo/i;
const MIN_EFFORT_M = 1000;  // shorter efforts say little about marathon fitness

/** Distance written in a workout name in metres: "5km", "3 k", "10 km", "1 mile" → 5000, 3000, 10000, 1609 */
export function nominalDistance(name) {
  const km = (name || '').match(/(\d+(?:[.,]\d+)?)\s*k(?:m)?\b/i);
  if (km) return parseFloat(km[1].replace(',', '.')) * 1000;
  const mi = (name || '').match(/(\d+(?:[.,]\d+)?)\s*mi(?:le)?s?\b/i);
  return mi ? Math.round(parseFloat(mi[1].replace(',', '.')) * 1609.34) : null;
}

/**
 * The time trial effort inside an activity. Garmin splits each workout step into 1 km laps,
 * so laps of the same step are added together; warm-up, cool-down and rest are skipped.
 * The step closest to the distance in the name wins (fastest if several match within 10%).
 * Without laps the whole activity is used, which is less accurate (it includes the warm-up).
 */
export function trialEffort(a) {
  const nominal = nominalDistance(a.title);
  const segments = [];
  for (const lap of a.laps || []) {
    if (['WARMUP', 'COOLDOWN', 'REST', 'RECOVERY'].includes(lap.intensity)) { segments.push(null); continue; }
    const last = segments[segments.length - 1];
    if (last && last.step === lap.step) { last.m += lap.distance_m; last.s += lap.duration_s; }
    else segments.push({ step: lap.step, m: lap.distance_m, s: lap.duration_s });
  }
  const efforts = segments.filter(x => x && x.m >= MIN_EFFORT_M && x.s > 0);
  const near = x => nominal && Math.abs(x.m - nominal) / nominal <= 0.1;
  const fastest = list => list.sort((p, q) => p.s / p.m - q.s / q.m)[0];
  let pick = null, source = 'workout step';
  if (efforts.length) pick = nominal ? fastest(efforts.filter(near)) : efforts.sort((p, q) => q.m - p.m)[0];
  if (!pick && a.km * 1000 >= MIN_EFFORT_M && a.sec > 0) { pick = { m: a.km * 1000, s: a.sec }; source = 'whole activity'; }
  if (!pick) return null;
  return { date: a.date, name: a.title, distance_m: pick.m, sec: pick.s, source, vdot: vdot(pick.m, pick.s) };
}

/** Time trial efforts found among the runs (name contains time trial, TT, test, testi or aika-ajo) */
export function timeTrials(acts) {
  return (acts || []).filter(a => /run|juoks|treadmill|trail/i.test(a.type || '') && TIME_TRIAL_WORDS.test(a.title || ''))
    .map(trialEffort).filter(Boolean);
}

/** Race results written in content/races.json, in the same shape as time trial efforts */
export function raceResults(races, today = new Date()) {
  return (races || []).filter(r => r.result && parseDate(r.date) && parseDate(r.date) <= today).map(r => {
    const sec = parseTime(r.result), m = r.distance_km * 1000;
    return { date: parseDate(r.date), name: r.name, distance_m: m, sec, source: 'race result', vdot: vdot(m, sec) };
  }).filter(r => Number.isFinite(r.vdot));
}

/**
 * Personal calibration: VDOT of each effort ÷ Garmin VO2max on that day, averaged.
 * Daniels' formula assumes VO2max = VDOT; real efforts are usually slower, and they tell by how much.
 */
export function calibration(efforts, vo2History) {
  const hist = (vo2History || []).map(h => ({ date: parseDate(h.date), y: h.vo2max }));
  const results = (efforts || []).map(e => {
    const before = hist.filter(h => h.date <= e.date).pop();
    return before ? { ...e, vo2max: before.y, ratio: e.vdot / before.y } : null;
  }).filter(Boolean);
  if (!results.length) return { factor: 1, results: [] };
  return { factor: results.reduce((s, r) => s + r.ratio, 0) / results.length, results };
}

/** Marathon time forecast from the VO2max forecast (a higher VDOT gives a faster time) */
export function marathonForecast(vo2fc, factor = 1, distM = MARATHON_M) {
  return vo2fc.series.map(p => ({
    date: p.date,
    mid: timeForVdot(p.mid * factor, distM),
    fast: timeForVdot(p.hi * factor, distM),
    slow: timeForVdot(p.lo * factor, distM),
    vdot: { mid: p.mid * factor, lo: p.lo * factor, hi: p.hi * factor },
  }));
}

/** Garmin's own marathon predictions, with the VDOT each one corresponds to */
export function garminPredictions(preds) {
  return (preds || []).map(p => ({ date: parseDate(p.date), sec: p.marathon_s, vdot: vdot(MARATHON_M, p.marathon_s) }));
}
