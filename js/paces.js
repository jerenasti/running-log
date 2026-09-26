// Training paces: Daniels' VDOT paces, Runna's paces from the workout descriptions, and the VDOT
// that Runna's paces correspond to. Pure calculations, no DOM code.

import { timeForVdot, MARATHON_M } from './forecast.js';
import { parseDate } from './parse.js';

/**
 * Share of VDOT (≈ VO2max) that each Daniels training pace runs at.
 * Marathon pace is not a fixed share: it is the pace of the marathon race time for the VDOT.
 */
export const PACE_SHARES = {
  easy:       { label: 'Easy',       share: [0.59, 0.74], use: 'Easy and long runs, recovery. Most of your running.' },
  marathon:   { label: 'Marathon',   share: null,         use: 'Marathon race pace, e.g. the end of long runs.' },
  threshold:  { label: 'Threshold',  share: [0.88, 0.88], use: 'Tempo runs and cruise intervals: comfortably hard.' },
  interval:   { label: 'Interval',   share: [0.98, 0.98], use: 'VO2max intervals of 3–5 minutes.' },
  repetition: { label: 'Repetition', share: [1.05, 1.05], use: 'Short fast repeats (200–400 m) with full recovery.' },
};

/** Speed (m/min) whose oxygen cost is `vo2`: the Daniels–Gilbert cost equation solved for v */
export function speedForVo2(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.60 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** Seconds per km at a share of VDOT */
export const paceAtShare = (vdot, share) => 60000 / speedForVo2(vdot * share);

/** Daniels training paces for a VDOT, seconds per km. Ranges are [fast, slow]. */
export function danielsPaces(vdot) {
  if (!(vdot > 0)) return null;
  const out = {};
  for (const [key, p] of Object.entries(PACE_SHARES)) {
    if (key === 'marathon') { const s = timeForVdot(vdot, MARATHON_M) / (MARATHON_M / 1000); out[key] = [s, s]; continue; }
    out[key] = [paceAtShare(vdot, p.share[1]), paceAtShare(vdot, p.share[0])];
  }
  return out;
}

/** VDOT whose pace at `share` equals `secPerKm` (inverse of paceAtShare) */
export function vdotForPace(secPerKm, share) {
  const v = 60000 / secPerKm;
  return (-4.60 + 0.182258 * v + 0.000104 * v * v) / share;
}

/* ---------- Runna paces from workout descriptions ---------- */

// Words in the same sentence decide what kind of pace a number is
const KINDS = [
  ['marathon',   /marathon pace|race pace|goal pace/i],
  ['threshold',  /tempo|threshold|comfortably hard/i],
  ['interval',   /interval|reps?\b|repeats?|hard\b|fast\b|5k pace|10k pace/i],
  ['easy',       /easy|conversational|recovery|warm ?up|cool ?down|long run/i],
];
const PACE = /(\d{1,2}):(\d{2})\s*(?:min)?\s*\/\s*km/gi;

/**
 * Paces written in the plan's workout descriptions, e.g. "at a conversational pace (no faster than 5:40/km)".
 * Returns [{ date, title, kind, sec, limit, text }]; limit = true for "no faster than" (a speed limit, not a target).
 */
export function runnaPaces(schedule) {
  const out = [];
  for (const w of schedule || []) {
    for (const sentence of String(w.description || '').split(/(?<=[.!?])\s+|\n+/)) {
      for (const m of sentence.matchAll(PACE)) {
        // The sentence decides; a line without clues ("1.5km at 4:50/km") takes the kind from the workout name
        const kind = (KINDS.find(([, re]) => re.test(sentence)) || KINDS.find(([, re]) => re.test(w.title || '')) || ['other'])[0];
        out.push({
          date: parseDate(w.date), title: w.title, kind,
          sec: +m[1] * 60 + +m[2],
          limit: /no faster than|not faster than|or slower/i.test(sentence),
          text: sentence.trim(),
        });
      }
    }
  }
  return out;
}

/**
 * The VDOT each Runna pace corresponds to. An easy "no faster than" limit is compared with the
 * fast end of Daniels' easy range (74%); threshold and interval paces with 88% and 98%.
 */
export function runnaVdot(paces) {
  const shareFor = { easy: PACE_SHARES.easy.share[1], threshold: 0.88, interval: 0.98 };
  const byKind = {};
  for (const p of paces) {
    if (!shareFor[p.kind]) continue;
    (byKind[p.kind] ||= []).push(vdotForPace(p.sec, shareFor[p.kind]));
  }
  const out = {};
  for (const [kind, list] of Object.entries(byKind)) out[kind] = list.reduce((s, x) => s + x, 0) / list.length;
  return out;
}
