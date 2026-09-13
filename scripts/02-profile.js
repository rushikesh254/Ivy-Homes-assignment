/**
 * Step 2 - profile the snapshot. No network access at all.
 *
 * This is the "stop reading it one record at a time" step. Each section below is
 * a hypothesis about how the data could be wrong in a way that no single
 * response would reveal, expressed as a measurement over all 3800 + 1450 + 440
 * records.
 *
 * Run: node scripts/02-profile.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import {
  loadAll, tally, groupBy, inlineTally, histogram, median, quantile, mean, sum, round,
  stampShape, wallFields, toEpochMs, istHour, istDate, REFERENCE_MS, SEVEN_DAYS_MS, IST_OFFSET_MS,
} from './lib/data.js';

const { listings, rentals, projects, manifest } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

console.log(`snapshot pulled at ${manifest.pulled_at}`);
console.log(`listings ${listings.length}  rentals ${rentals.length}  projects ${projects.length}`);

// ===========================================================================
hr('A. `total` vs what actually comes back');
// ===========================================================================
// The docs: "`total` is the exact number of records matching your filters. To
// fetch every record, read `total`, divide by your `limit`, and request that many
// pages." The crawl says otherwise. Note which fields statement.md vouches for:
// "which limit and offset it used, how many records it returned, and whether
// more remain" - `total` is conspicuously not in that list.
{
  const rows = Object.entries(manifest.collections).map(([name, m]) => ({
    name,
    advertised: m.advertised_total,
    fetched: m.fetched_records,
    gap: m.fetched_records - m.advertised_total,
    ratio: round(m.advertised_total / m.fetched_records, 6),
  }));
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(9)} advertised=${String(r.advertised).padStart(5)}  fetched=${String(r.fetched).padStart(5)}  gap=${String(r.gap).padStart(4)}  advertised/fetched=${r.ratio}`);
  }
  console.log(`\n  is_live=true counts (does 'total' mean live records only?)`);
  console.log(`    listings live=${listings.filter((r) => r.is_live === true).length} vs advertised 3466`);
  console.log(`    rentals  live=${rentals.filter((r) => r.is_live === true).length} vs advertised 1323`);
  console.log(`    projects have no is_live field, yet still show a gap -> not an is_live artefact`);
  out.total_vs_fetched = rows;
}

// ===========================================================================
hr('B. Field census');
// ===========================================================================
function census(rows, label) {
  sub(label);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const report = {};
  for (const k of keys) {
    const vals = rows.map((r) => r[k]);
    const nulls = vals.filter((v) => v === null || v === undefined).length;
    const present = vals.filter((v) => v !== null && v !== undefined);
    const types = [...new Set(present.map((v) => (Array.isArray(v) ? 'array' : typeof v)))];
    const distinct = new Set(present.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))).size;
    const nums = present.filter((v) => typeof v === 'number');
    const info = { types, nulls, distinct };
    if (nums.length) {
      info.min = Math.min(...nums);
      info.max = Math.max(...nums);
      info.median = round(median(nums), 3);
    }
    if (distinct <= 12 && !nums.length) {
      info.values = [...new Set(present.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)))];
    }
    report[k] = info;
    const numPart = nums.length ? ` min=${info.min} max=${info.max} med=${info.median}` : '';
    const valPart = info.values ? ` values=${JSON.stringify(info.values)}` : '';
    console.log(`  ${k.padEnd(21)} ${types.join('|').padEnd(8)} nulls=${String(nulls).padStart(4)} distinct=${String(distinct).padStart(5)}${numPart}${valPart}`);
  }
  return report;
}
out.census = {
  listings: census(listings, 'listings'),
  rentals: census(rentals, 'rentals'),
  projects: census(projects, 'projects'),
};

// ===========================================================================
hr('C. Timestamps: what do the naive listing stamps actually mean?');
// ===========================================================================
// Docs claim UTC-with-Z everywhere. Listings carry no offset, rentals carry Z.
// The open question is what the naive ones mean, and question 8 depends on it.
//
// The discriminating test: if the generator produced IST wall-clock times and
// then serialised some with a Z and some without, the raw hour-of-day histograms
// of the two collections will be IDENTICAL. If the rentals were genuinely
// converted to UTC, the rental histogram will be the listing histogram shifted
// by -5h30m. Comparing the two shapes answers it without needing to assume.
{
  sub('stamp shapes');
  console.log(`  listings posted_at : ${JSON.stringify(tally(listings, (r) => stampShape(r.posted_at)))}`);
  console.log(`  rentals  posted_at : ${JSON.stringify(tally(rentals, (r) => stampShape(r.posted_at)))}`);
  console.log(`  projects launch_date    : ${JSON.stringify(tally(projects, (r) => stampShape(r.launch_date)))}`);
  console.log(`  projects possession_date: ${JSON.stringify(tally(projects, (r) => stampShape(r.possession_date)))}`);

  sub('raw wall-clock hour histogram (the literal hour in the string)');
  const lHours = listings.map((r) => wallFields(r.posted_at)?.hour).filter((h) => h !== undefined);
  const rHours = rentals.map((r) => wallFields(r.posted_at)?.hour).filter((h) => h !== undefined);
  const bucket = (hs) => {
    const c = new Array(24).fill(0);
    for (const h of hs) c[h]++;
    return c;
  };
  const lc = bucket(lHours);
  const rc = bucket(rHours);
  console.log('  hour :  ' + Array.from({ length: 24 }, (_, i) => String(i).padStart(4)).join(''));
  console.log('  list :  ' + lc.map((v) => String(v).padStart(4)).join(''));
  console.log('  rent :  ' + rc.map((v) => String(v).padStart(4)).join(''));

  // If both are ~uniform over 24h, hour-of-day carries no signal either way.
  const spread = (c) => {
    const m = mean(c);
    return round(Math.sqrt(mean(c.map((v) => (v - m) ** 2))) / m, 3);
  };
  console.log(`  coefficient of variation - listings ${spread(lc)}, rentals ${spread(rc)}`);
  console.log('  (near 0 => uniform across the clock => hour-of-day cannot discriminate)');

  sub('the decisive test: does either reading put records in the future?');
  const serverNowMs = Date.now();
  for (const [name, rows] of [['listings', listings], ['rentals', rentals]]) {
    for (const assume of ['ist', 'utc']) {
      const ms = rows.map((r) => toEpochMs(r.posted_at, assume)).filter(Number.isFinite);
      const maxMs = Math.max(...ms);
      const afterRef = ms.filter((v) => v >= REFERENCE_MS).length;
      const afterNow = ms.filter((v) => v > serverNowMs).length;
      console.log(
        `  ${name.padEnd(8)} naive-as-${assume.toUpperCase()}: max=${new Date(maxMs).toISOString()}  ` +
        `>=REFERENCE: ${String(afterRef).padStart(4)}  >now: ${afterNow}`,
      );
    }
  }
  console.log(`  REFERENCE = ${new Date(REFERENCE_MS).toISOString()}   now = ${new Date(serverNowMs).toISOString()}`);

  sub('question 8 both ways: records in [REFERENCE-7d, REFERENCE)');
  const q8 = {};
  for (const assume of ['ist', 'utc']) {
    const n = listings.filter((r) => {
      const t = toEpochMs(r.posted_at, assume);
      return t >= REFERENCE_MS - SEVEN_DAYS_MS && t < REFERENCE_MS;
    }).length;
    q8[assume] = n;
    console.log(`  naive-as-${assume.toUpperCase()} -> ${n}`);
  }
  console.log(`  the two readings differ by ${Math.abs(q8.ist - q8.utc)} records`);

  sub('per-IST-day counts near the window, naive-as-IST');
  const near = listings
    .map((r) => toEpochMs(r.posted_at, 'ist'))
    .filter((t) => Number.isFinite(t) && t >= REFERENCE_MS - 10 * 24 * 3600e3 && t < REFERENCE_MS + 3 * 24 * 3600e3);
  for (const [d, c] of tally(near.map((t) => ({ d: istDate(t) })), (r) => r.d).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`    ${d}  ${c}`);
  }

  out.timestamps = {
    listing_shapes: tally(listings, (r) => stampShape(r.posted_at)),
    rental_shapes: tally(rentals, (r) => stampShape(r.posted_at)),
    listing_hour_hist: lc,
    rental_hour_hist: rc,
    q8_both_ways: q8,
  };
}

// ===========================================================================
hr('D. Units: are areas and prices in the documented units?');
// ===========================================================================
// The test is deliberately unit-INVARIANT. carpet_area / super_built_up_area
// sits around 0.6-0.8 for a real flat whatever unit both are expressed in, so
// the ratio separates "this record is in the wrong unit" from "this is a
// genuinely small flat". An absolute threshold like `area < 200 => sq m` cannot.
{
  sub('listings: carpet_area / super_built_up_area');
  const ratios = listings
    .filter((r) => r.carpet_area > 0 && r.super_built_up_area > 0)
    .map((r) => r.carpet_area / r.super_built_up_area);
  console.log(`  n=${ratios.length}  min=${round(Math.min(...ratios), 4)}  p1=${round(quantile(ratios, 0.01), 4)}  p50=${round(median(ratios), 4)}  p99=${round(quantile(ratios, 0.99), 4)}  max=${round(Math.max(...ratios), 4)}`);
  console.log(histogram(ratios, { bins: 24 }));
  const weird = listings.filter((r) => {
    if (!(r.carpet_area > 0 && r.super_built_up_area > 0)) return true;
    const x = r.carpet_area / r.super_built_up_area;
    return x < 0.45 || x >= 1;
  });
  console.log(`  records with ratio outside [0.45, 1): ${weird.length}`);
  for (const r of weird.slice(0, 25)) {
    console.log(`    ${r.listing_id.padEnd(13)} ${String(r.website).padEnd(11)} carpet=${String(r.carpet_area).padStart(7)} super=${String(r.super_built_up_area).padStart(7)} ratio=${round((r.carpet_area / r.super_built_up_area) || 0, 4)} bhk=${r.bedroom} price=${r.price}`);
  }

  sub('rentals: carpet_area / super_builtup_area');
  const rRatios = rentals
    .filter((r) => r.carpet_area > 0 && r.super_builtup_area > 0)
    .map((r) => r.carpet_area / r.super_builtup_area);
  console.log(`  n=${rRatios.length}  min=${round(Math.min(...rRatios), 4)}  p50=${round(median(rRatios), 4)}  max=${round(Math.max(...rRatios), 4)}`);
  const rWeird = rentals.filter((r) => {
    if (!(r.carpet_area > 0 && r.super_builtup_area > 0)) return true;
    const x = r.carpet_area / r.super_builtup_area;
    return x < 0.45 || x >= 1;
  });
  console.log(`  records with ratio outside [0.45, 1): ${rWeird.length}`);
  for (const r of rWeird.slice(0, 15)) {
    console.log(`    ${r.listing_id.padEnd(12)} ${String(r.website).padEnd(11)} carpet=${String(r.carpet_area).padStart(7)} super=${String(r.super_builtup_area).padStart(7)} price=${r.price}`);
  }

  sub('listings: price per carpet sq ft, by website');
  for (const [site, rows] of groupBy(listings, (r) => r.website)) {
    const pps = rows.filter((r) => r.price > 0 && r.carpet_area > 0).map((r) => r.price / r.carpet_area);
    console.log(`  ${String(site).padEnd(11)} n=${String(rows.length).padStart(4)}  p1=${String(round(quantile(pps, 0.01))).padStart(10)}  p50=${String(round(median(pps))).padStart(10)}  p99=${String(round(quantile(pps, 0.99))).padStart(10)}  max=${String(round(Math.max(...pps))).padStart(12)}`);
  }

  sub('listings: price per carpet sq ft, by locality');
  for (const [loc, rows] of [...groupBy(listings, (r) => r.locality)].sort()) {
    const pps = rows.filter((r) => r.price > 0 && r.carpet_area > 0).map((r) => r.price / r.carpet_area);
    console.log(`  ${String(loc).padEnd(13)} n=${String(rows.length).padStart(4)}  p5=${String(round(quantile(pps, 0.05))).padStart(8)}  p50=${String(round(median(pps))).padStart(8)}  p95=${String(round(quantile(pps, 0.95))).padStart(8)}`);
  }

  sub('listings: raw price distribution (is anything in lakhs?)');
  const prices = listings.map((r) => r.price).filter(Number.isFinite);
  console.log(`  min=${Math.min(...prices)}  p1=${quantile(prices, 0.01)}  p50=${median(prices)}  p99=${quantile(prices, 0.99)}  max=${Math.max(...prices)}`);
  console.log(`  price < 100000 : ${prices.filter((p) => p < 100000).length}`);
  console.log(`  price < 1000   : ${prices.filter((p) => p < 1000).length}`);
  console.log(`  non-integer    : ${prices.filter((p) => !Number.isInteger(p)).length}`);

  sub('rentals: raw price / deposit / maintenance distribution');
  for (const f of ['price', 'deposit', 'maintenance']) {
    const xs = rentals.map((r) => r[f]).filter(Number.isFinite);
    console.log(`  ${f.padEnd(12)} min=${String(Math.min(...xs)).padStart(9)} p5=${String(quantile(xs, 0.05)).padStart(9)} p50=${String(median(xs)).padStart(9)} p95=${String(quantile(xs, 0.95)).padStart(9)} max=${String(Math.max(...xs)).padStart(10)}  non-int=${xs.filter((v) => !Number.isInteger(v)).length}`);
  }
  sub('rentals: deposit / price ratio');
  const dep = rentals.filter((r) => r.price > 0 && Number.isFinite(r.deposit)).map((r) => r.deposit / r.price);
  console.log(`  p1=${round(quantile(dep, 0.01), 2)} p50=${round(median(dep), 2)} p99=${round(quantile(dep, 0.99), 2)} max=${round(Math.max(...dep), 2)}`);
  sub('rentals: monthly rent per sq ft');
  const rps = rentals.filter((r) => r.price > 0 && r.carpet_area > 0).map((r) => r.price / r.carpet_area);
  console.log(`  p1=${round(quantile(rps, 0.01), 2)} p50=${round(median(rps), 2)} p99=${round(quantile(rps, 0.99), 2)} max=${round(Math.max(...rps), 2)}`);
  console.log(histogram(rps, { bins: 20 }));

  sub('projects: price_min / price_max as served');
  const pmin = projects.map((r) => r.price_min).filter(Number.isFinite);
  const pmax = projects.map((r) => r.price_max).filter(Number.isFinite);
  console.log(`  price_min  min=${Math.min(...pmin)}  p50=${median(pmin)}  max=${Math.max(...pmin)}  non-int=${pmin.filter((v) => !Number.isInteger(v)).length}`);
  console.log(`  price_max  min=${Math.min(...pmax)}  p50=${median(pmax)}  max=${Math.max(...pmax)}  non-int=${pmax.filter((v) => !Number.isInteger(v)).length}`);
  console.log(`  records where price_min > price_max as served: ${projects.filter((r) => r.price_min > r.price_max).length} of ${projects.length}`);
  console.log(`\n  under the reading price_min=lakhs, price_max=crores:`);
  const bad = projects.filter((r) => r.price_min * 1e5 > r.price_max * 1e7);
  console.log(`    price_min(lakh) > price_max(crore) violations: ${bad.length}`);
  for (const r of bad.slice(0, 10)) console.log(`      ${r.project_id} min=${r.price_min} max=${r.price_max}`);
  const asInrMin = projects.map((r) => r.price_min * 1e5);
  const asInrMax = projects.map((r) => r.price_max * 1e7);
  console.log(`    converted min: p50=${median(asInrMin).toLocaleString('en-IN')}  converted max: p50=${median(asInrMax).toLocaleString('en-IN')}`);
  console.log(`  projects: min_area_sqft / max_area_sqft`);
  const amin = projects.map((r) => r.min_area_sqft).filter(Number.isFinite);
  const amax = projects.map((r) => r.max_area_sqft).filter(Number.isFinite);
  console.log(`    min_area  min=${Math.min(...amin)} p50=${median(amin)} max=${Math.max(...amin)}`);
  console.log(`    max_area  min=${Math.min(...amax)} p50=${median(amax)} max=${Math.max(...amax)}`);
  console.log(`    min_area > max_area: ${projects.filter((r) => r.min_area_sqft > r.max_area_sqft).length}`);

  out.units = {
    listing_ratio: { p1: round(quantile(ratios, 0.01), 4), p50: round(median(ratios), 4), p99: round(quantile(ratios, 0.99), 4) },
    listing_ratio_outliers: weird.map((r) => r.listing_id),
    rental_ratio_outliers: rWeird.map((r) => r.listing_id),
    project_price_min_gt_max_as_served: projects.filter((r) => r.price_min > r.price_max).length,
    project_lakh_crore_violations: bad.map((r) => r.project_id),
  };
}

// ===========================================================================
hr('E. Impossibility checks (question 4 candidates)');
// ===========================================================================
// "Describes something that cannot exist" - internal contradiction, not mere
// implausibility. Each rule is reported separately so the residuals stay visible
// rather than being swallowed by a single count.
{
  const RULES = {
    'floor > total_floors': (r) => Number.isFinite(r.floor) && Number.isFinite(r.total_floors) && r.floor > r.total_floors,
    'carpet_area >= super_built_up_area': (r) => r.carpet_area > 0 && r.super_built_up_area > 0 && r.carpet_area >= r.super_built_up_area,
    'price <= 0': (r) => !(r.price > 0),
    'carpet_area <= 0': (r) => !(r.carpet_area > 0),
    'super_built_up_area <= 0': (r) => !(r.super_built_up_area > 0),
    'bedroom <= 0': (r) => !(r.bedroom > 0),
    'bathroom <= 0': (r) => !(r.bathroom > 0),
    'total_floors <= 0': (r) => !(r.total_floors > 0),
    'balcony < 0': (r) => Number.isFinite(r.balcony) && r.balcony < 0,
    'covered_parking < 0': (r) => Number.isFinite(r.covered_parking) && r.covered_parking < 0,
    'latitude outside Pune (18.30-18.75)': (r) => !(r.latitude > 18.3 && r.latitude < 18.75),
    'longitude outside Pune (73.55-74.15)': (r) => !(r.longitude > 73.55 && r.longitude < 74.15),
    'lat/lng transposed (lat>70 and lng<20)': (r) => r.latitude > 70 && r.longitude < 20,
    'posted_at unparseable': (r) => !Number.isFinite(toEpochMs(r.posted_at, 'ist')),
    'posted_at after REFERENCE': (r) => toEpochMs(r.posted_at, 'ist') >= REFERENCE_MS,
  };
  const hits = {};
  for (const [name, fn] of Object.entries(RULES)) {
    const rows = listings.filter(fn);
    hits[name] = rows.map((r) => r.listing_id);
    console.log(`  ${name.padEnd(40)} ${String(rows.length).padStart(5)}`);
    for (const r of rows.slice(0, 6)) {
      console.log(`      ${r.listing_id.padEnd(13)} bhk=${r.bedroom} bath=${r.bathroom} floor=${r.floor}/${r.total_floors} carpet=${r.carpet_area} super=${r.super_built_up_area} price=${r.price} lat=${r.latitude} lng=${r.longitude} live=${r.is_live}`);
    }
  }
  const union = new Set(Object.values(hits).flat());
  console.log(`\n  union of all impossibility rules: ${union.size} listing records`);
  out.impossible = hits;
  out.impossible_union = [...union].sort();

  sub('same rules on rentals');
  const rRules = {
    'floor > total_floors': (r) => Number.isFinite(r.floor) && Number.isFinite(r.total_floors) && r.floor > r.total_floors,
    'carpet >= super_builtup': (r) => r.carpet_area > 0 && r.super_builtup_area > 0 && r.carpet_area >= r.super_builtup_area,
    'price <= 0': (r) => !(r.price > 0),
    'bedroom <= 0': (r) => !(r.bedroom > 0),
    'lat/lng transposed': (r) => r.latitude > 70 && r.longitude < 20,
  };
  for (const [name, fn] of Object.entries(rRules)) {
    console.log(`  ${name.padEnd(40)} ${String(rentals.filter(fn).length).padStart(5)}`);
  }

  sub('projects: internal contradictions');
  console.log(`  possession_date before launch_date: ${projects.filter((r) => r.possession_date < r.launch_date).length}`);
  console.log(`  total_units <= 0                  : ${projects.filter((r) => !(r.total_units > 0)).length}`);
  console.log(`  total_towers <= 0                 : ${projects.filter((r) => !(r.total_towers > 0)).length}`);
}

// ===========================================================================
hr('F. Duplicate structure (question 2)');
// ===========================================================================
// Docs: "Every listing_id is globally unique, and each listing corresponds to
// exactly one physical property." The first half is true in this snapshot. The
// second is what question 2 is about. Try several keys and look at what each
// one groups together, rather than trusting the first that yields a plausible
// number.
{
  const KEYS = {
    'lat+lng': (r) => `${r.latitude},${r.longitude}`,
    'lat+lng+bhk': (r) => `${r.latitude},${r.longitude}|${r.bedroom}`,
    'name+loc+bhk+carpet': (r) => `${r.apartment_name}|${r.locality}|${r.bedroom}|${r.carpet_area}`,
    'name+loc+bhk+carpet+floor': (r) => `${r.apartment_name}|${r.locality}|${r.bedroom}|${r.carpet_area}|${r.floor}`,
    'name+bhk+carpet+super+floor': (r) => `${r.apartment_name}|${r.bedroom}|${r.carpet_area}|${r.super_built_up_area}|${r.floor}`,
    'project+bhk+carpet+floor': (r) => `${r.project_id}|${r.bedroom}|${r.carpet_area}|${r.floor}`,
    'description': (r) => r.description,
  };
  for (const [name, fn] of Object.entries(KEYS)) {
    const g = groupBy(listings, fn);
    const sizes = tally([...g.values()].map((v) => ({ n: v.length })), (r) => r.n);
    console.log(`  ${name.padEnd(30)} groups=${String(g.size).padStart(5)}  group-size histogram: ${JSON.stringify(sizes.sort((a, b) => a[0] - b[0]))}`);
  }

  sub('what does a lat+lng collision actually look like?');
  const byCoord = groupBy(listings, (r) => `${r.latitude},${r.longitude}`);
  const collided = [...byCoord.entries()].filter(([, v]) => v.length > 1);
  console.log(`  ${collided.length} coordinates carry more than one record`);
  for (const [k, rows] of collided.slice(0, 4)) {
    console.log(`\n  coord ${k}  (${rows.length} records)`);
    for (const r of rows) {
      console.log(`    ${r.listing_id.padEnd(13)} ${String(r.website).padEnd(11)} ${String(r.apartment_name).slice(0, 26).padEnd(27)} bhk=${r.bedroom} carpet=${String(r.carpet_area).padStart(5)} super=${String(r.super_built_up_area).padStart(5)} fl=${String(r.floor).padStart(2)}/${String(r.total_floors).padStart(2)} price=${String(r.price).padStart(9)} ${String(r.posted_by_contact)} ${r.posted_at}`);
    }
  }
  out.dup_keys = Object.fromEntries(
    Object.entries(KEYS).map(([name, fn]) => [name, groupBy(listings, fn).size]),
  );
}

// ===========================================================================
hr('G. Contact numbers (question 9 groundwork)');
// ===========================================================================
// The submission format names phone numbers as valid `evidence`, which says
// contact clustering matters. 3800 listings share only 642 distinct numbers.
{
  const byPhone = groupBy(listings, (r) => r.posted_by_contact);
  const sizes = [...byPhone.entries()].map(([p, rows]) => ({ phone: p, n: rows.length, rows })).sort((a, b) => b.n - a.n);
  console.log(`  distinct contacts: ${byPhone.size} across ${listings.length} listings`);
  console.log(`  group size distribution: ${JSON.stringify(tally(sizes, (s) => s.n).sort((a, b) => a[0] - b[0]))}`);
  console.log(`\n  top 15 contacts by listing count:`);
  for (const s of sizes.slice(0, 15)) {
    const names = new Set(s.rows.map((r) => r.posted_by_name));
    const roles = new Set(s.rows.map((r) => r.posted_by));
    const locs = new Set(s.rows.map((r) => r.locality));
    console.log(`    ${String(s.phone).padEnd(15)} n=${String(s.n).padStart(3)}  distinct names=${String(names.size).padStart(3)}  roles=${[...roles].join('/')}  localities=${locs.size}`);
  }
  sub('phone number shapes');
  console.log(`  ${JSON.stringify(tally(listings, (r) => String(r.posted_by_contact).replace(/\d/g, 'N')).slice(0, 10))}`);
  console.log(`  posted_by values: ${inlineTally(listings, (r) => r.posted_by)}`);
  console.log(`  is_verified     : ${inlineTally(listings, (r) => r.is_verified)}`);
  out.phones = { distinct: byPhone.size, top: sizes.slice(0, 25).map((s) => ({ phone: s.phone, n: s.n, names: new Set(s.rows.map((r) => r.posted_by_name)).size })) };
}

// ===========================================================================
hr('H. Cross-endpoint: project.total_listings vs reality (question 10)');
// ===========================================================================
{
  const byProject = groupBy(listings.filter((r) => r.project_id), (r) => r.project_id);
  const rows = projects.map((p) => {
    const all = byProject.get(p.project_id) ?? [];
    const live = all.filter((r) => r.is_live === true);
    return { project_id: p.project_id, reported: p.total_listings, actual_all: all.length, actual_live: live.length };
  });
  const wrongAll = rows.filter((r) => r.reported !== r.actual_all);
  const wrongLive = rows.filter((r) => r.reported !== r.actual_live);
  console.log(`  projects: ${projects.length}`);
  console.log(`  reported != count of ALL listings with that project_id : ${wrongAll.length}`);
  console.log(`  reported != count of LIVE listings with that project_id: ${wrongLive.length}`);
  console.log(`\n  listings with project_id: ${listings.filter((r) => r.project_id).length}, null: ${listings.filter((r) => !r.project_id).length}`);
  console.log(`  distinct project_ids referenced by listings: ${byProject.size}`);
  const orphan = [...byProject.keys()].filter((id) => !projects.some((p) => p.project_id === id));
  console.log(`  project_ids referenced by listings but absent from /v1/projects: ${orphan.length} ${JSON.stringify(orphan.slice(0, 10))}`);
  console.log(`\n  first 15 rows:`);
  for (const r of rows.slice(0, 15)) {
    console.log(`    ${r.project_id}  reported=${String(r.reported).padStart(3)}  all=${String(r.actual_all).padStart(3)}  live=${String(r.actual_live).padStart(3)}  ${r.reported === r.actual_all ? '' : '<- differs from all'}`);
  }
  out.q10 = { wrong_vs_all: wrongAll.length, wrong_vs_live: wrongLive.length, orphan_project_ids: orphan };
}

// ===========================================================================
hr('I. Assigned locality: Magarpatta (question 5 groundwork)');
// ===========================================================================
{
  const mag = rentals.filter((r) => r.locality === 'magarpatta');
  console.log(`  rentals with locality exactly 'magarpatta': ${mag.length}`);
  console.log(`  sum of price as served: ${sum(mag.map((r) => r.price)).toLocaleString('en-IN')}`);
  console.log(`  price min=${Math.min(...mag.map((r) => r.price))} p50=${median(mag.map((r) => r.price))} max=${Math.max(...mag.map((r) => r.price))}`);
  console.log(`  distinct locality spellings anywhere in rentals: ${JSON.stringify([...new Set(rentals.map((r) => r.locality))])}`);
  console.log(`  any rental whose title/description mentions magarpatta but locality does not: ${
    rentals.filter((r) => r.locality !== 'magarpatta' && /magarpatta/i.test(`${r.title} ${r.description} ${r.apartment_name}`)).length}`);
  out.q5_raw = { n: mag.length, sum_as_served: sum(mag.map((r) => r.price)) };
}

const outPath = path.join(ROOT, 'notes', '02-profile.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
