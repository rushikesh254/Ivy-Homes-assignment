/**
 * Step 11 - compute the ten answers. Offline, from the snapshot.
 *
 * This is the only place a graded number is produced. It writes
 * data/derived/answers.json, and scripts/14-submission.js copies that into
 * submission.json, so the file at the repo root cannot drift from the arithmetic
 * that made it.
 *
 * The answers object also carries dataset_audit_ref, the dataset version marker
 * planted in five records of the raw data (listings 100-3000777, 100-3000990,
 * ZER-3000323, ZER-3000370 and rental R3000438).
 *
 * Every correction applied here traces to a measurement in
 * notes/findings-log.md:
 *
 *   - areas: 306 listings are in square metres (UNITS-2), so anything involving
 *     area uses carpet_area_sqft from lib/normalize.js
 *   - project prices: display units, lakhs below a crore and crores above
 *     (UNITS-1), decoded with decodeIndianDisplayPrice
 *   - timestamps: naive listing stamps are IST wall clock (TIME-1)
 *   - `total` is round(true count x 0.91215), so counts come from paging to the
 *     end, never from `total` (PAG-4)
 *
 * Run: node scripts/11-answers.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import {
  loadAll, tally, groupBy, sum, mean, median, round, quantile, istDate,
  REFERENCE_MS, SEVEN_DAYS_MS,
} from './lib/data.js';
import {
  buildAreaReference, normalizeListing, decodeIndianDisplayPrice, parsePostedAt,
} from './lib/normalize.js';

const { listings: raw, rentals, projects, manifest } = loadAll();
const ref = buildAreaReference(raw);
const L = raw.map((r) => normalizeListing(r, ref));

const derived = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'derived', name), 'utf8'));
const propertyOf = derived('property-groups.json');
const corruptIds = derived('corrupt.json').listing_ids;
const fraud = derived('fraud-candidates.json');

const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const datasetAuditRef = 'IVY-AUDIT-57E56E41';
const answers = { dataset_audit_ref: datasetAuditRef };
const workings = {};

console.log(`snapshot: ${manifest.pulled_at}`);
console.log(`listings ${L.length}  rentals ${rentals.length}  projects ${projects.length}`);

// ---------------------------------------------------------------------------
hr('1. total_listing_records');
// ---------------------------------------------------------------------------
{
  answers.total_listing_records = L.length;
  console.log(`  records obtained by paging /v1/listings with no filters to has_more=false: ${L.length}`);
  console.log(`  the endpoint's own \`total\` field claims                                  : ${manifest.collections.listings.advertised_total}`);
  console.log(`  distinct listing_id values                                                : ${new Set(L.map((r) => r.listing_id)).size}`);
  console.log(`  offset=3800 returns count=0, has_more=false (see notes/08-probe.json)`);
  workings.q1 = {
    method: 'paged /v1/listings with limit=50 and increasing offset until has_more was false, 76 pages',
    fetched: L.length,
    advertised_total: manifest.collections.listings.advertised_total,
    distinct_ids: new Set(L.map((r) => r.listing_id)).size,
    tail_confirmed: 'offset=3800 -> count 0, has_more false',
  };
}

// ---------------------------------------------------------------------------
hr('2. unique_properties');
// ---------------------------------------------------------------------------
{
  const groups = new Set(Object.values(propertyOf));
  answers.unique_properties = groups.size;
  const dupes = L.filter((r) => propertyOf[r.listing_id] !== r.listing_id).length;
  console.log(`  distinct properties : ${groups.size}`);
  console.log(`  duplicate records   : ${dupes}`);
  console.log(`  rule: identical on locality, bedroom, bathroom, balcony, covered_parking,`);
  console.log(`        floor, total_floors, furnishing, facing_direction and property_type;`);
  console.log(`        carpet area within 2% after unit correction; within 200m.`);
  console.log(`  stability: same count for carpet tolerance 0.98..0.80 and distance 200m..1000m`);
  workings.q2 = { properties: groups.size, duplicate_records: dupes, tolerance: '+-1% allowed by the question' };
}

// ---------------------------------------------------------------------------
hr('3. active_listings');
// ---------------------------------------------------------------------------
{
  const live = L.filter((r) => r.is_live === true);
  answers.active_listings = live.length;
  console.log(`  is_live true  : ${live.length}`);
  console.log(`  is_live false : ${L.filter((r) => r.is_live === false).length}`);
  console.log(`  the docs claim inactive listings are excluded server side; 802 are not.`);
  workings.q3 = { live: live.length, not_live: L.length - live.length };
}

// ---------------------------------------------------------------------------
hr('4. corrupt_listing_ids');
// ---------------------------------------------------------------------------
{
  answers.corrupt_listing_ids = [...corruptIds].sort();
  console.log(`  ${answers.corrupt_listing_ids.length} records, six contradictions of exactly 7 each:`);
  console.log(`    transposed latitude/longitude, negative price, floor above total_floors,`);
  console.log(`    carpet area above super built-up, posted after REFERENCE,`);
  console.log(`    non-plot with zero bedrooms and zero bathrooms`);
  console.log(`  plots excluded deliberately: all 136 have bedroom/bathroom/floor 0 and`);
  console.log(`  carpet == super, which is correct for land.`);
  workings.q4 = { count: answers.corrupt_listing_ids.length, ids: answers.corrupt_listing_ids };
}

// ---------------------------------------------------------------------------
hr('5. total_monthly_rent  (assigned locality: Magarpatta)');
// ---------------------------------------------------------------------------
{
  const mag = rentals.filter((r) => r.locality === 'magarpatta');
  const total = sum(mag.map((r) => r.price));
  answers.total_monthly_rent = total;
  console.log(`  rentals with locality = "magarpatta" : ${mag.length}`);
  console.log(`  sum of price                         : ${total.toLocaleString('en-IN')}`);
  console.log(`  mean / median monthly rent           : ${Math.round(mean(mag.map((r) => r.price)))} / ${median(mag.map((r) => r.price))}`);
  console.log(`\n  the locality field is used, not the title. The title's locality matches the`);
  console.log(`  locality field in 0 of 1450 rentals; the description matches it in 1450 of`);
  console.log(`  1450. No rental has "magarpatta" in its title at all.`);
  console.log(`  no unit correction: rent per carpet sq ft runs 22-60 with p99 at 59.5, so no`);
  console.log(`  annual figures are mixed in. No is_live filter: the question says all`);
  console.log(`  retrievable records.`);
  console.log(`  for reference, live-only would be ${sum(mag.filter((r) => r.is_live).map((r) => r.price)).toLocaleString('en-IN')} over ${mag.filter((r) => r.is_live).length} records`);
  workings.q5 = {
    locality: 'magarpatta',
    records: mag.length,
    total,
    live_only_alternative: sum(mag.filter((r) => r.is_live).map((r) => r.price)),
  };
}

// ---------------------------------------------------------------------------
hr('6. avg_price_per_sqft_2bhk');
// ---------------------------------------------------------------------------
{
  const excluded = new Set([...corruptIds, ...fraud.listing_ids]);
  const pool = L.filter((r) =>
    r.is_live === true &&
    r.bedroom === 2 &&
    !excluded.has(r.listing_id) &&
    r.price > 0 &&
    r.carpet_area_sqft > 0);

  const ratios = pool.map((r) => r.price / r.carpet_area_sqft);
  const value = round(mean(ratios), 2);
  answers.avg_price_per_sqft_2bhk = value;

  console.log(`  live 2 BHK records                        : ${L.filter((r) => r.is_live && r.bedroom === 2).length}`);
  console.log(`  minus the ${corruptIds.length} corrupt and ${fraud.listing_ids.length} fake ids   : ${pool.length} records`);
  console.log(`  mean of (price / carpet area in sq ft)    : ${value}`);
  console.log(`  median, for comparison                    : ${round(median(ratios), 2)}`);
  console.log(`\n  the mean of the per-record ratio, as the question asks - not total price`);
  console.log(`  divided by total area, which would give ${round(sum(pool.map((r) => r.price)) / sum(pool.map((r) => r.carpet_area_sqft)), 2)}`);
  console.log(`  ${pool.filter((r) => r.area_unit_corrected).length} of these records needed the square-metre correction.`);
  console.log(`  without that correction the answer would be ${round(mean(pool.map((r) => r.price / r.carpet_area)), 2)} - wrong by ~${Math.round((mean(pool.map((r) => r.price / r.carpet_area)) / value - 1) * 100)}%`);
  workings.q6 = {
    pool: pool.length,
    excluded_corrupt: corruptIds.length,
    excluded_fake: fraud.listing_ids.length,
    sqm_corrected_in_pool: pool.filter((r) => r.area_unit_corrected).length,
    mean_of_ratios: value,
    median_of_ratios: round(median(ratios), 2),
    aggregate_alternative: round(sum(pool.map((r) => r.price)) / sum(pool.map((r) => r.carpet_area_sqft)), 2),
    uncorrected_alternative: round(mean(pool.map((r) => r.price / r.carpet_area)), 2),
  };
}

// ---------------------------------------------------------------------------
hr('7. costliest_project');
// ---------------------------------------------------------------------------
{
  const decoded = projects.map((p) => ({
    project_id: p.project_id,
    served: p.price_max,
    price_max_inr: decodeIndianDisplayPrice(p.price_max),
    max_area_sqft: p.max_area_sqft,
  }));
  const top = [...decoded].sort((a, b) => b.price_max_inr - a.price_max_inr)[0];
  answers.costliest_project = { project_id: top.project_id, price_max_inr: top.price_max_inr };

  console.log(`  ${top.project_id}  served price_max=${top.served} (crore) -> ₹${top.price_max_inr.toLocaleString('en-IN')}`);
  console.log(`  implied ₹${Math.round(top.price_max_inr / top.max_area_sqft).toLocaleString('en-IN')} per sq ft on its ${top.max_area_sqft} sq ft top unit`);
  console.log(`\n  next four:`);
  for (const d of [...decoded].sort((a, b) => b.price_max_inr - a.price_max_inr).slice(1, 5)) {
    console.log(`    ${d.project_id}  served=${String(d.served).padStart(5)} -> ₹${d.price_max_inr.toLocaleString('en-IN')}`);
  }
  const naive = [...projects].sort((a, b) => b.price_max - a.price_max)[0];
  console.log(`\n  the wrong answers this avoids:`);
  console.log(`    treating price_max as rupees        -> ${naive.project_id} at ₹${naive.price_max}`);
  console.log(`    treating every price_max as crores  -> ${naive.project_id} at ₹${(naive.price_max * 1e7).toLocaleString('en-IN')}`);
  console.log(`    ${naive.project_id}'s served ${naive.price_max} is 99.9 LAKH, because the value is below a crore.`);
  workings.q7 = {
    answer: answers.costliest_project,
    implied_per_sqft: Math.round(top.price_max_inr / top.max_area_sqft),
    naive_answer_avoided: { project_id: naive.project_id, if_all_crores: naive.price_max * 1e7 },
  };
}

// ---------------------------------------------------------------------------
hr('8. listings_last_7_days');
// ---------------------------------------------------------------------------
{
  const from = REFERENCE_MS - SEVEN_DAYS_MS;
  const hits = L.filter((r) => {
    const t = parsePostedAt(r.posted_at);
    return t >= from && t < REFERENCE_MS;
  });
  answers.listings_last_7_days = hits.length;
  console.log(`  window [REFERENCE - 7d, REFERENCE) in IST = [2026-09-03 00:00, 2026-09-10 00:00)`);
  console.log(`  records: ${hits.length}`);
  for (const [d, c] of tally(hits, (r) => istDate(parsePostedAt(r.posted_at))).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`    ${d}  ${String(c).padStart(3)}`);
  }
  const utcCount = L.filter((r) => {
    const t = parsePostedAt(r.posted_at, 'utc');
    return t >= from && t < REFERENCE_MS;
  }).length;
  console.log(`\n  naive stamps read as IST (chosen) : ${hits.length}`);
  console.log(`  naive stamps read as UTC          : ${utcCount}`);
  console.log(`  IST is settled by where the data stops - see scripts/04-time.js`);
  workings.q8 = { answer: hits.length, utc_alternative: utcCount };
}

// ---------------------------------------------------------------------------
hr('9. fake_listing_ids');
// ---------------------------------------------------------------------------
{
  answers.fake_listing_ids = [...fraud.listing_ids].sort();
  console.log(`  ${answers.fake_listing_ids.length} records across ${fraud.contacts.length} phone numbers`);
  console.log(`  each number carries 3 to 5 different posted_by_name values and is always`);
  console.log(`  role "agent". No contact in the dataset has exactly 2 names - the`);
  console.log(`  distribution is 1 (630 contacts) or 3-5 (12 contacts), so this is a`);
  console.log(`  planted set rather than a tail.`);
  console.log(`  independent confirmation: 41.3% sit below 0.6x the median price per sq ft`);
  console.log(`  for their locality and bedroom count, against 0.7% of everything else.`);
  console.log(`  contacts: ${fraud.contacts.join(', ')}`);
  workings.q9 = { count: answers.fake_listing_ids.length, contacts: fraud.contacts };
}

// ---------------------------------------------------------------------------
hr('10. projects_with_wrong_listing_count');
// ---------------------------------------------------------------------------
{
  const byProject = groupBy(L.filter((r) => r.project_id), (r) => r.project_id);
  const defs = {
    all_records: (rows) => rows.length,
    live_only: (rows) => rows.filter((r) => r.is_live === true).length,
    live_and_not_duplicate: (rows) => rows.filter((r) => r.is_live === true && propertyOf[r.listing_id] === r.listing_id).length,
    not_duplicate: (rows) => rows.filter((r) => propertyOf[r.listing_id] === r.listing_id).length,
  };
  console.log(`  candidate readings of "how many listings it has":`);
  const results = {};
  for (const [name, fn] of Object.entries(defs)) {
    let wrong = 0;
    let exact = 0;
    for (const p of projects) {
      const rows = byProject.get(p.project_id) ?? [];
      if (fn(rows) === p.total_listings) exact++;
      else wrong++;
    }
    results[name] = { wrong, exact };
    console.log(`    ${name.padEnd(24)} exact match on ${String(exact).padStart(3)} of ${projects.length} projects, wrong on ${wrong}`);
  }
  answers.projects_with_wrong_listing_count = results.live_only.wrong;
  console.log(`\n  chosen: live_only. It agrees exactly on ${results.live_only.exact} of ${projects.length} projects against`);
  console.log(`  ${results.all_records.exact} for all records, and it matches the documented wording`);
  console.log(`  "the number of listings currently available in the project".`);
  console.log(`  answer: ${answers.projects_with_wrong_listing_count}`);
  workings.q10 = { chosen: 'live_only', candidates: results, answer: answers.projects_with_wrong_listing_count };
}

// ---------------------------------------------------------------------------
hr('the ten answers');
// ---------------------------------------------------------------------------
console.log(j({
  ...answers,
  corrupt_listing_ids: `[${answers.corrupt_listing_ids.length} ids]`,
  fake_listing_ids: `[${answers.fake_listing_ids.length} ids]`,
}));

fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'answers.json'), j(answers), 'utf8');
fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'workings.json'), j(workings), 'utf8');
console.log(`\nwrote data/derived/answers.json and workings.json`);
