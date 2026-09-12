/**
 * Offline data layer. Loads the snapshot written by scripts/01-pull.js.
 *
 * Everything after the pull reads from here, so every number in submission.json
 * is reproducible from a fixed snapshot rather than from a moving API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './http.js';

const RAW = path.join(ROOT, 'data', 'raw');

const read = (name) => JSON.parse(fs.readFileSync(path.join(RAW, `${name}.json`), 'utf8'));

export const loadListings = () => read('listings');
export const loadRentals = () => read('rentals');
export const loadProjects = () => read('projects');
export const loadManifest = () => read('_manifest');

export function loadAll() {
  return {
    listings: loadListings(),
    rentals: loadRentals(),
    projects: loadProjects(),
    manifest: loadManifest(),
  };
}

// ---------------------------------------------------------------------------
// Time
//
// API_REFERENCE.md: "Timestamps - ISO 8601, UTC, `Z` suffix, everywhere in the
// API." Neither half of that is true (see TIME-1 in notes/findings-log.md):
// listing posted_at carries no offset at all, rental posted_at carries a Z.
// ---------------------------------------------------------------------------

export const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const REFERENCE_ISO = '2026-09-10T00:00:00+05:30';
export const REFERENCE_MS = Date.parse(REFERENCE_ISO);
export const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

/** Classify a timestamp string by what offset information it carries. */
export function stampShape(s) {
  if (typeof s !== 'string') return `not-a-string(${typeof s})`;
  if (/Z$/.test(s)) return 'Z';
  if (/[+-]\d{2}:\d{2}$/.test(s)) return 'explicit-offset';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return 'naive';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date-only';
  return 'other';
}

/** The literal calendar fields in the string, with no timezone reasoning. */
export function wallFields(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s));
  if (!m) return null;
  return {
    year: +m[1], month: +m[2], day: +m[3],
    hour: +m[4], minute: +m[5], second: +(m[6] ?? 0),
  };
}

/**
 * Turn a timestamp into epoch ms.
 *
 * @param {string} s
 * @param {'ist'|'utc'} assumeNaive  what a stamp with no offset is taken to mean.
 *        This is a parameter and not a constant because it is the open question
 *        in TIME-1, and question 8 turns on it. Both readings get computed and
 *        compared rather than one being assumed.
 */
export function toEpochMs(s, assumeNaive = 'ist') {
  const shape = stampShape(s);
  if (shape === 'Z' || shape === 'explicit-offset') return Date.parse(s);
  const f = wallFields(s);
  if (!f) return NaN;
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return assumeNaive === 'ist' ? asUtc - IST_OFFSET_MS : asUtc;
}

/** Wall-clock fields of an instant, in IST. */
export function istFields(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(),
  };
}

export const istHour = (ms) => istFields(ms).hour;
export const istDate = (ms) => {
  const f = istFields(ms);
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Small statistics helpers. No dependencies on purpose - the arithmetic behind
// every graded number should be visible in this repo.
// ---------------------------------------------------------------------------

export function tally(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);

export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs) => quantile(xs, 0.5);

/** Round half-up to n decimals, which is what "to 2 decimals" means here. */
export function round(x, n = 2) {
  const f = 10 ** n;
  return Math.round((x + Number.EPSILON) * f) / f;
}

/** Compact ASCII histogram, for eyeballing distributions in a terminal. */
export function histogram(values, { bins = 20, min, max, width = 46 } = {}) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return '(no data)';
  const lo = min ?? Math.min(...xs);
  const hi = max ?? Math.max(...xs);
  const step = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of xs) {
    let i = Math.floor((v - lo) / step);
    if (i < 0) i = 0;
    if (i >= bins) i = bins - 1;
    counts[i]++;
  }
  const peak = Math.max(...counts);
  return counts
    .map((c, i) => {
      const from = (lo + i * step).toFixed(2).padStart(10);
      const bar = '#'.repeat(peak ? Math.round((c / peak) * width) : 0);
      return `  ${from} | ${String(c).padStart(5)} ${bar}`;
    })
    .join('\n');
}

/** Counts per integer key, printed as a single line. */
export function inlineTally(rows, keyFn, limit = 30) {
  return tally(rows, keyFn)
    .slice(0, limit)
    .map(([k, v]) => `${k}:${v}`)
    .join('  ');
}
