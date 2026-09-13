/**
 * Step 13 - verification. Fails loudly rather than reporting.
 *
 * Guards the way this submission could quietly become wrong: submission.json
 * drifting from data/derived/answers.json, so the graded file no longer matches
 * the arithmetic that produced it.

 * Also re-derives every answer from the snapshot and checks it against the
 * recorded value, so a change to any analysis script that moves a number cannot
 * pass unnoticed.

 * Run: node scripts/13-verify.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/http.js';
import { loadAll, sum, mean, median, round, groupBy, REFERENCE_MS, SEVEN_DAYS_MS } from './lib/data.js';
import { buildAreaReference, normalizeListing, decodeIndianDisplayPrice, parsePostedAt } from './lib/normalize.js';

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${ok ? a : `got ${a}, expected ${e}`}`);
};

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

console.log('verifying\n');

// ---------------------------------------------------------------------------
console.log('1. the ten answers, re-derived from the snapshot');
const answers = read('data/derived/answers.json');
{
  const { listings: raw, rentals, projects } = loadAll();
  const ref = buildAreaReference(raw);
  const L = raw.map((r) => normalizeListing(r, ref));
  const propertyOf = read('data/derived/property-groups.json');
  const corrupt = read('data/derived/corrupt.json').listing_ids;
  const fraud = read('data/derived/fraud-candidates.json');

  check('q1 total_listing_records', L.length, answers.total_listing_records);
  check('q2 unique_properties', new Set(Object.values(propertyOf)).size, answers.unique_properties);
  check('q3 active_listings', L.filter((r) => r.is_live === true).length, answers.active_listings);
  check('q4 corrupt count', corrupt.length, answers.corrupt_listing_ids.length);
  check('q4 corrupt ids sorted', [...corrupt].sort(), answers.corrupt_listing_ids);
  check('q5 total_monthly_rent', sum(rentals.filter((r) => r.locality === 'magarpatta').map((r) => r.price)), answers.total_monthly_rent);

  const excluded = new Set([...corrupt, ...fraud.listing_ids]);
  const pool = L.filter((r) => r.is_live === true && r.bedroom === 2 && !excluded.has(r.listing_id) && r.price > 0 && r.carpet_area_sqft > 0);
  check('q6 avg_price_per_sqft_2bhk', round(mean(pool.map((r) => r.price / r.carpet_area_sqft)), 2), answers.avg_price_per_sqft_2bhk);

  const top = [...projects].map((p) => ({ id: p.project_id, v: decodeIndianDisplayPrice(p.price_max) })).sort((a, b) => b.v - a.v)[0];
  check('q7 costliest_project', { project_id: top.id, price_max_inr: top.v }, answers.costliest_project);

  const from = REFERENCE_MS - SEVEN_DAYS_MS;
  check('q8 listings_last_7_days', L.filter((r) => { const t = parsePostedAt(r.posted_at); return t >= from && t < REFERENCE_MS; }).length, answers.listings_last_7_days);
  check('q9 fake count', fraud.listing_ids.length, answers.fake_listing_ids.length);
  check('q9 fake ids sorted', [...fraud.listing_ids].sort(), answers.fake_listing_ids);

  const byProject = groupBy(L.filter((r) => r.project_id), (r) => r.project_id);
  const wrong = projects.filter((p) => (byProject.get(p.project_id) ?? []).filter((r) => r.is_live === true).length !== p.total_listings).length;
  check('q10 projects_with_wrong_listing_count', wrong, answers.projects_with_wrong_listing_count);

  console.log('\n   invariants');
  check('every listing_id is distinct', new Set(L.map((r) => r.listing_id)).size, L.length);
  check('sqm-corrected records', L.filter((r) => r.area_unit_corrected).length, 306);
  check('decoded project prices never invert', projects.filter((p) => decodeIndianDisplayPrice(p.price_min) > decodeIndianDisplayPrice(p.price_max)).length, 0);
  // The two planted sets turn out to be disjoint: no record is both impossible
  // and fraudulent. Worth asserting, because question 6 excludes both and an
  // overlap would change how their sizes add up.
  check('corrupt and fake sets are disjoint', [...new Set(corrupt)].filter((id) => fraud.listing_ids.includes(id)).length, 0);
  check('q6 pool size = live 2BHK minus both sets', pool.length, L.filter((r) => r.is_live === true && r.bedroom === 2 && !excluded.has(r.listing_id)).length);
}

// ---------------------------------------------------------------------------
console.log('\n2. submission.json');
{
  const p = path.join(ROOT, 'submission.json');
  if (!fs.existsSync(p)) {
    console.log('  --    submission.json not written yet, skipping');
  } else {
    const sub = read('submission.json');
    check('answers block matches answers.json', sub.answers, answers);
    check('api_key present', /^IVY26-[0-9A-F]{12}$/.test(sub.api_key ?? ''), true);
    for (const f of ['name', 'email', 'repo_url', 'demo_url']) {
      check(`candidate.${f} filled in`, Boolean(sub.candidate?.[f]), true);
    }
    const CATEGORIES = new Set(['auth', 'pagination', 'units', 'filters', 'sorting', 'timestamps', 'duplicates', 'completeness', 'data_quality', 'fraud', 'consistency', 'missing_endpoint', 'undocumented_endpoint']);
    const bad = (sub.findings ?? []).filter((f) => !CATEGORIES.has(f.category));
    check('every finding uses a valid category', bad.map((f) => f.category), []);
    const missing = (sub.findings ?? []).filter((f) => !f.endpoint || !f.documented || !f.actual || !f.how_found || !f.impact);
    check('every finding has all required fields', missing.length, 0);
    const overLong = (sub.findings ?? []).filter((f) => (f.evidence ?? []).length > 20);
    check('no finding cites more than 20 evidence ids', overLong.length, 0);
    console.log(`\n   findings: ${(sub.findings ?? []).length}`);
    const byCat = {};
    for (const f of sub.findings ?? []) byCat[f.category] = (byCat[f.category] ?? 0) + 1;
    for (const [k, v] of Object.entries(byCat).sort()) console.log(`     ${k.padEnd(24)} ${v}`);
  }
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
