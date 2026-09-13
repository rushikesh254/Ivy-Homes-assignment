/**
 * Step 4 - settle what the naive listing timestamps mean. Offline.
 *
 * API_REFERENCE.md claims "ISO 8601, UTC, `Z` suffix, everywhere". Listings carry
 * no offset; rentals carry a Z. The claim is false either way, but question 8
 * counts listings in a seven-day IST window, so the *reading* of the naive stamps
 * changes the answer: 128 under IST, 115 under UTC.
 *
 * Tests already dead:
 *   - hour-of-day clustering. Posting times are uniform across the clock in both
 *     collections (coefficient of variation 0.07 and 0.11), so "humans post in
 *     daylight" has no discriminating power on this data.
 *
 * Tests with power, used here:
 *   1. Where does each collection stop? If the dataset was generated up to
 *      REFERENCE and nothing legitimate lies beyond it, then the correct reading
 *      is the one under which records approach REFERENCE and stop there.
 *   2. Density right at the boundary. A generator sampling uniformly up to a cap
 *      leaves a populated final hour and then nothing. A wrong reading shifts the
 *      cap by 5h30m and leaves either a suspicious gap or an overshoot.
 *   3. The extreme-value estimate. For n samples uniform over a span, the
 *      expected distance from the largest sample to the cap is span/(n+1). That
 *      gives a quantitative prediction to compare both readings against.
 *
 * Run: node scripts/04-time.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import {
  loadAll, tally, median, round, stampShape, istFields, istDate,
  REFERENCE_MS, SEVEN_DAYS_MS, IST_OFFSET_MS, toEpochMs,
} from './lib/data.js';

const { listings, rentals } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

const iso = (ms) => new Date(ms).toISOString();
const istStr = (ms) => {
  const f = istFields(ms);
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')} ${String(f.hour).padStart(2, '0')}:${String(f.minute).padStart(2, '0')} IST`;
};

console.log(`REFERENCE = ${iso(REFERENCE_MS)} = ${istStr(REFERENCE_MS)}`);

// ===========================================================================
hr('A. The raw strings at the top of each collection');
// ===========================================================================
{
  sub('listings: 15 largest posted_at strings, as served');
  const sorted = [...listings].sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1));
  for (const r of sorted.slice(0, 15)) {
    console.log(`  ${r.listing_id.padEnd(13)} ${r.posted_at}   live=${String(r.is_live).padEnd(5)} price=${String(r.price).padStart(10)}`);
  }
  sub('listings: 5 smallest');
  for (const r of sorted.slice(-5)) console.log(`  ${r.listing_id.padEnd(13)} ${r.posted_at}`);

  sub('rentals: 10 largest posted_at strings, as served');
  const rs = [...rentals].sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1));
  for (const r of rs.slice(0, 10)) console.log(`  ${r.listing_id.padEnd(12)} ${r.posted_at}`);
  sub('rentals: 3 smallest');
  for (const r of rs.slice(-3)) console.log(`  ${r.listing_id.padEnd(12)} ${r.posted_at}`);
}

// ===========================================================================
hr('B. Which records sit beyond REFERENCE, and by how far?');
// ===========================================================================
// If a handful land months past REFERENCE they are planted, not a boundary
// artefact. If they cluster a few hours past it, the reading is wrong.
{
  for (const assume of ['ist', 'utc']) {
    sub(`listings, naive read as ${assume.toUpperCase()}`);
    const beyond = listings
      .map((r) => ({ r, ms: toEpochMs(r.posted_at, assume) }))
      .filter((x) => x.ms >= REFERENCE_MS)
      .sort((a, b) => a.ms - b.ms);
    console.log(`  ${beyond.length} records at or after REFERENCE`);
    for (const x of beyond) {
      const days = (x.ms - REFERENCE_MS) / 86400e3;
      console.log(`    ${x.r.listing_id.padEnd(13)} ${x.r.posted_at}  -> ${istStr(x.ms)}  (+${days.toFixed(2)} days past REFERENCE)`);
    }
    out[`beyond_${assume}`] = beyond.map((x) => ({ id: x.r.listing_id, posted_at: x.r.posted_at, days_past: round((x.ms - REFERENCE_MS) / 86400e3, 3) }));
  }
}

// ===========================================================================
hr('C. Density in the final hours before REFERENCE');
// ===========================================================================
// A generator sampling uniformly up to a cap fills the last bucket and then
// stops dead. Under the wrong reading the cap moves by 5h30m, which shows up
// either as an unexplained empty stretch or as records past the cap.
{
  const buckets = (rows, get, label) => {
    sub(label);
    const rowsMs = rows.map(get).filter(Number.isFinite);
    // 3-hour buckets across the last 48 hours before REFERENCE, then beyond.
    for (let h = 48; h > 0; h -= 3) {
      const lo = REFERENCE_MS - h * 3600e3;
      const hi = REFERENCE_MS - (h - 3) * 3600e3;
      const n = rowsMs.filter((t) => t >= lo && t < hi).length;
      console.log(`    ${String(h).padStart(2)}h to ${String(h - 3).padStart(2)}h before REFERENCE : ${String(n).padStart(3)} ${'#'.repeat(n)}`);
    }
    const after = rowsMs.filter((t) => t >= REFERENCE_MS).length;
    console.log(`    at or after REFERENCE                : ${String(after).padStart(3)} ${'#'.repeat(Math.min(after, 60))}`);
  };

  buckets(listings, (r) => toEpochMs(r.posted_at, 'ist'), 'listings, naive read as IST');
  buckets(listings, (r) => toEpochMs(r.posted_at, 'utc'), 'listings, naive read as UTC');
  buckets(rentals, (r) => Date.parse(r.posted_at), 'rentals, explicit Z taken at face value');
}

// ===========================================================================
hr('D. Extreme-value check: where should the largest sample fall?');
// ===========================================================================
// For n samples drawn uniformly over a span ending at a cap, the expected gap
// between the largest sample and the cap is span/(n+1). Comparing the observed
// gap under each reading against that prediction is a quantitative test rather
// than a judgement call.
{
  const analyse = (rows, get, label, exclude = new Set()) => {
    const ms = rows.filter((r) => !exclude.has(r.listing_id)).map(get).filter(Number.isFinite);
    const lo = Math.min(...ms);
    const hi = Math.max(...ms);
    const spanDays = (REFERENCE_MS - lo) / 86400e3;
    const n = ms.length;
    const predictedGapH = (spanDays * 24) / (n + 1);
    const observedGapH = (REFERENCE_MS - hi) / 3600e3;
    console.log(
      `  ${label.padEnd(34)} n=${String(n).padStart(4)}  span=${spanDays.toFixed(1)}d  ` +
      `predicted gap to REFERENCE=${predictedGapH.toFixed(2)}h  observed=${observedGapH.toFixed(2)}h  ` +
      `ratio=${(observedGapH / predictedGapH).toFixed(2)}`,
    );
    return { n, spanDays: round(spanDays, 2), predictedGapH: round(predictedGapH, 3), observedGapH: round(observedGapH, 3) };
  };

  // Exclude the records that sit beyond REFERENCE under BOTH readings - those are
  // planted, and including them would make the extreme-value test meaningless.
  const beyondBoth = new Set(
    listings.filter((r) => toEpochMs(r.posted_at, 'ist') >= REFERENCE_MS).map((r) => r.listing_id),
  );
  console.log(`  excluding ${beyondBoth.size} listings that are beyond REFERENCE under the IST reading`);
  out.evt = {
    listings_ist: analyse(listings, (r) => toEpochMs(r.posted_at, 'ist'), 'listings, naive as IST', beyondBoth),
    listings_utc: analyse(listings, (r) => toEpochMs(r.posted_at, 'utc'), 'listings, naive as UTC', beyondBoth),
    rentals_z: analyse(rentals, (r) => Date.parse(r.posted_at), 'rentals, Z at face value'),
    rentals_z_as_ist: analyse(rentals, (r) => Date.parse(r.posted_at) - IST_OFFSET_MS, 'rentals, Z relabelled as IST'),
  };
}

// ===========================================================================
hr('E. Question 8 under each reading');
// ===========================================================================
{
  const from = REFERENCE_MS - SEVEN_DAYS_MS;
  console.log(`  window = [${istStr(from)}, ${istStr(REFERENCE_MS)})`);
  console.log(`         = [${iso(from)}, ${iso(REFERENCE_MS)})`);
  const counts = {};
  for (const assume of ['ist', 'utc']) {
    const hits = listings.filter((r) => {
      const t = toEpochMs(r.posted_at, assume);
      return t >= from && t < REFERENCE_MS;
    });
    counts[assume] = hits.length;
    console.log(`\n  naive read as ${assume.toUpperCase()} -> ${hits.length} records`);
    const byDay = tally(hits, (r) => istDate(toEpochMs(r.posted_at, assume))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (const [d, c] of byDay) console.log(`      ${d}  ${String(c).padStart(3)} ${'#'.repeat(c)}`);
  }
  out.q8 = counts;

  sub('the records the two readings disagree about');
  const inIst = new Set(listings.filter((r) => { const t = toEpochMs(r.posted_at, 'ist'); return t >= from && t < REFERENCE_MS; }).map((r) => r.listing_id));
  const inUtc = new Set(listings.filter((r) => { const t = toEpochMs(r.posted_at, 'utc'); return t >= from && t < REFERENCE_MS; }).map((r) => r.listing_id));
  const onlyIst = [...inIst].filter((id) => !inUtc.has(id));
  const onlyUtc = [...inUtc].filter((id) => !inIst.has(id));
  console.log(`  in the window only under IST: ${onlyIst.length}`);
  for (const id of onlyIst.slice(0, 30)) console.log(`    ${id.padEnd(13)} ${listings.find((r) => r.listing_id === id).posted_at}`);
  console.log(`  in the window only under UTC: ${onlyUtc.length}`);
  for (const id of onlyUtc.slice(0, 30)) console.log(`    ${id.padEnd(13)} ${listings.find((r) => r.listing_id === id).posted_at}`);
}

// ===========================================================================
hr('F. Do the project dates line up with the listing dates?');
// ===========================================================================
{
  const { projects } = loadAll();
  console.log(`  launch_date shapes    : ${JSON.stringify(tally(projects, (r) => stampShape(r.launch_date)))}`);
  console.log(`  possession_date shapes: ${JSON.stringify(tally(projects, (r) => stampShape(r.possession_date)))}`);
  const launches = projects.map((p) => p.launch_date).sort();
  const poss = projects.map((p) => p.possession_date).sort();
  console.log(`  launch_date     range : ${launches[0]} .. ${launches.at(-1)}`);
  console.log(`  possession_date range : ${poss[0]} .. ${poss.at(-1)}`);
  console.log(`  launches after REFERENCE date 2026-09-10: ${projects.filter((p) => p.launch_date >= '2026-09-10').length}`);
}

const outPath = path.join(ROOT, 'notes', '04-time.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
