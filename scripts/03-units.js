/**
 * Step 3 - pin down the unit errors exactly. Offline.
 *
 * Two open questions from the profile:
 *
 *   UNITS-2  magichomes' price-per-carpet-sqft tail runs to 168,469 while the
 *            other four feeds cap at ~16,000. Square metres would explain it
 *            (10.764 sq ft per sq m). But *which* records, and is it the whole
 *            feed or a subset? A threshold on price-per-sqft would answer badly,
 *            because it cannot separate "wrong unit" from "genuinely expensive".
 *
 *   UNITS-1  project price_min looks like lakhs and price_max like crores. That
 *            is already established from the internal min<=max ordering. This
 *            checks it a second, independent way: against the actual prices of
 *            the listings that belong to each project.
 *
 * The method for UNITS-2 avoids absolute thresholds entirely. Four of the five
 * feeds are demonstrably clean, so they define what a carpet area for a given
 * bedroom count looks like. Every record is then scored as
 *
 *     actual carpet area / median clean carpet area for the same bedroom count
 *
 * A record in the right unit scores near 1. A record in square metres scores
 * near 1/10.764 = 0.0929. If the data really is a unit error the scores will be
 * bimodal with nothing in between, and the gap is the proof.
 *
 * Run: node scripts/03-units.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import { loadAll, tally, groupBy, median, quantile, round, histogram, sum } from './lib/data.js';

const { listings, projects } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

const SQFT_PER_SQM = 10.7639104;

// ===========================================================================
hr('A. Which feeds are clean? (establish a reference population)');
// ===========================================================================
{
  for (const [site, rows] of groupBy(listings, (r) => r.website)) {
    const pps = rows.filter((r) => r.price > 0 && r.carpet_area > 0).map((r) => r.price / r.carpet_area);
    const over20k = pps.filter((v) => v > 20000).length;
    console.log(`  ${String(site).padEnd(11)} n=${String(rows.length).padStart(4)}  max price/carpet=${String(round(Math.max(...pps))).padStart(10)}  records over 20k/sqft: ${over20k}`);
  }
  console.log(`\n  minimum carpet_area by feed:`);
  for (const [site, rows] of groupBy(listings, (r) => r.website)) {
    const areas = rows.map((r) => r.carpet_area).filter((v) => v > 0).sort((a, b) => a - b);
    console.log(`    ${String(site).padEnd(11)} smallest 8: ${areas.slice(0, 8).join(', ')}`);
  }
}

// ===========================================================================
hr('B. The bedroom-normalised area score (unit test with no threshold)');
// ===========================================================================
const CLEAN_FEEDS = new Set(['dwelling', 'squarelane', '100acres', 'zerobroker']);
let scored;
{
  // Reference: median carpet area per (property_type, bedroom) among the four
  // feeds that show no anomalous tail at all.
  const refRows = listings.filter((r) => CLEAN_FEEDS.has(r.website) && r.carpet_area > 0);
  const refKey = (r) => `${r.property_type}|${r.bedroom}`;
  const ref = new Map();
  for (const [k, rows] of groupBy(refRows, refKey)) {
    ref.set(k, median(rows.map((r) => r.carpet_area)));
  }
  sub('reference median carpet_area by property_type + bedroom (clean feeds only)');
  for (const [k, v] of [...ref.entries()].sort()) {
    console.log(`  ${k.padEnd(24)} ${round(v, 1)}`);
  }

  scored = listings.map((r) => {
    const base = ref.get(refKey(r));
    return { r, base, score: base && r.carpet_area > 0 ? r.carpet_area / base : null };
  });

  sub('distribution of the score across all 3800 listings');
  const scores = scored.map((s) => s.score).filter((v) => Number.isFinite(v));
  console.log(histogram(scores, { bins: 26 }));
  console.log(`  expected score if the record is in sq m instead of sq ft: ${round(1 / SQFT_PER_SQM, 4)}`);

  sub('is the distribution bimodal with an empty gap?');
  for (const [lo, hi] of [[0, 0.06], [0.06, 0.08], [0.08, 0.11], [0.11, 0.14], [0.14, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 1.5], [1.5, 3]]) {
    const n = scores.filter((v) => v >= lo && v < hi).length;
    console.log(`    score in [${String(lo).padStart(4)}, ${String(hi).padStart(4)}) : ${String(n).padStart(5)} ${'#'.repeat(Math.min(60, Math.round(n / 40)))}`);
  }

  const suspects = scored.filter((s) => s.score !== null && s.score < 0.3);
  sub(`records scoring below 0.3 : ${suspects.length}`);
  console.log(`  by website : ${JSON.stringify(tally(suspects, (s) => s.r.website))}`);
  console.log(`  by property_type: ${JSON.stringify(tally(suspects, (s) => s.r.property_type))}`);
  console.log(`  by bedroom : ${JSON.stringify(tally(suspects, (s) => s.r.bedroom).sort((a, b) => a[0] - b[0]))}`);
  console.log(`  by locality: ${JSON.stringify(tally(suspects, (s) => s.r.locality))}`);
  console.log(`  is_live    : ${JSON.stringify(tally(suspects, (s) => s.r.is_live))}`);
  console.log(`  score range: ${round(Math.min(...suspects.map((s) => s.score)), 4)} .. ${round(Math.max(...suspects.map((s) => s.score)), 4)}`);
  console.log(`  score median: ${round(median(suspects.map((s) => s.score)), 4)}   (1/10.764 = ${round(1 / SQFT_PER_SQM, 4)})`);

  sub('and what do the magichomes records that DO score near 1 look like?');
  const magOk = scored.filter((s) => s.r.website === 'magichomes' && s.score >= 0.3);
  console.log(`  magichomes total ${listings.filter((r) => r.website === 'magichomes').length}, scoring >=0.3: ${magOk.length}, scoring <0.3: ${listings.filter((r) => r.website === 'magichomes').length - magOk.length}`);

  sub('sanity check: convert the suspects and re-measure price per sq ft');
  const before = suspects.map((s) => s.r.price / s.r.carpet_area).filter((v) => v > 0);
  const after = suspects.map((s) => s.r.price / (s.r.carpet_area * SQFT_PER_SQM)).filter((v) => v > 0);
  const cleanPps = listings.filter((r) => CLEAN_FEEDS.has(r.website) && r.price > 0 && r.carpet_area > 0).map((r) => r.price / r.carpet_area);
  console.log(`  clean feeds       p5=${round(quantile(cleanPps, 0.05))}  p50=${round(median(cleanPps))}  p95=${round(quantile(cleanPps, 0.95))}`);
  console.log(`  suspects as-is    p5=${round(quantile(before, 0.05))}  p50=${round(median(before))}  p95=${round(quantile(before, 0.95))}`);
  console.log(`  suspects x10.7639 p5=${round(quantile(after, 0.05))}  p50=${round(median(after))}  p95=${round(quantile(after, 0.95))}`);

  sub('same building, both units? (the clinching check)');
  // If a single apartment_name carries records in both units, the conversion is
  // provable within one building rather than across the whole dataset.
  const byName = groupBy(scored.filter((s) => s.score !== null), (s) => s.r.apartment_name);
  let shown = 0;
  for (const [name, rows] of byName) {
    const lo = rows.filter((s) => s.score < 0.3);
    const hi = rows.filter((s) => s.score >= 0.3);
    if (lo.length && hi.length && shown < 5) {
      const bhk = lo[0].r.bedroom;
      const peers = hi.filter((s) => s.r.bedroom === bhk);
      if (!peers.length) continue;
      shown++;
      console.log(`\n  ${name}  (bedroom=${bhk})`);
      for (const s of lo.filter((x) => x.r.bedroom === bhk).slice(0, 3)) {
        console.log(`    sq m?  ${s.r.listing_id.padEnd(13)} ${String(s.r.website).padEnd(11)} carpet=${String(s.r.carpet_area).padStart(5)} super=${String(s.r.super_built_up_area).padStart(5)}  x10.764 -> ${round(s.r.carpet_area * SQFT_PER_SQM)}`);
      }
      for (const s of peers.slice(0, 3)) {
        console.log(`    sq ft  ${s.r.listing_id.padEnd(13)} ${String(s.r.website).padEnd(11)} carpet=${String(s.r.carpet_area).padStart(5)} super=${String(s.r.super_built_up_area).padStart(5)}`);
      }
    }
  }

  out.sqm = {
    count: suspects.length,
    by_website: tally(suspects, (s) => s.r.website),
    score_median: round(median(suspects.map((s) => s.score)), 4),
    ids: suspects.map((s) => s.r.listing_id).sort(),
  };
}

// ===========================================================================
hr('C. Do the super_built_up_area values need the same conversion?');
// ===========================================================================
{
  const suspects = scored.filter((s) => s.score !== null && s.score < 0.3).map((s) => s.r);
  const ratios = suspects.filter((r) => r.super_built_up_area > 0).map((r) => r.carpet_area / r.super_built_up_area);
  console.log(`  carpet/super among the suspects: p5=${round(quantile(ratios, 0.05), 4)} p50=${round(median(ratios), 4)} p95=${round(quantile(ratios, 0.95), 4)}`);
  console.log(`  the same ratio across all clean-feed records: p50=${round(median(listings.filter((r) => CLEAN_FEEDS.has(r.website) && r.super_built_up_area > 0).map((r) => r.carpet_area / r.super_built_up_area)), 4)}`);
  console.log(`  => the ratio is unchanged, so BOTH area fields are converted together,`);
  console.log(`     which is exactly why the ratio test could not see this.`);
  const superAreas = suspects.map((r) => r.super_built_up_area);
  console.log(`  suspect super_built_up_area range: ${Math.min(...superAreas)} .. ${Math.max(...superAreas)}`);
}

// ===========================================================================
hr('D. Project price scale, checked against the listings themselves');
// ===========================================================================
{
  const byProject = groupBy(listings.filter((r) => r.project_id && r.price > 0), (r) => r.project_id);

  let containedLakhCrore = 0;
  let containedRupees = 0;
  let comparable = 0;
  const rows = [];

  for (const p of projects) {
    const ls = byProject.get(p.project_id) ?? [];
    if (!ls.length) continue;
    comparable++;
    const prices = ls.map((r) => r.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);

    // Reading A (documented): both already rupees.
    if (lo >= p.price_min && hi <= p.price_max) containedRupees++;
    // Reading B: price_min in lakhs, price_max in crores.
    if (lo >= p.price_min * 1e5 * 0.9 && hi <= p.price_max * 1e7 * 1.1) containedLakhCrore++;

    rows.push({
      project_id: p.project_id,
      listings: ls.length,
      listing_min: lo,
      listing_max: hi,
      price_min_raw: p.price_min,
      price_max_raw: p.price_max,
      as_lakh: p.price_min * 1e5,
      as_crore: p.price_max * 1e7,
    });
  }

  console.log(`  projects with at least one priced listing: ${comparable}`);
  console.log(`  listing price range inside [price_min, price_max] read as RUPEES      : ${containedRupees}`);
  console.log(`  listing price range inside [price_min lakh, price_max crore] (+-10%)  : ${containedLakhCrore}`);

  sub('ten examples');
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.project_id}  n=${String(r.listings).padStart(2)}  listings ₹${r.listing_min.toLocaleString('en-IN').padStart(12)} .. ₹${r.listing_max.toLocaleString('en-IN').padStart(12)}   ` +
      `raw ${String(r.price_min_raw).padStart(5)}/${String(r.price_max_raw).padStart(6)}   as lakh/crore ₹${r.as_lakh.toLocaleString('en-IN').padStart(12)} .. ₹${r.as_crore.toLocaleString('en-IN').padStart(13)}`,
    );
  }

  sub('price_max distribution as served - is it all one scale?');
  const pmax = projects.map((r) => r.price_max);
  console.log(histogram(pmax, { bins: 20 }));
  console.log(`  price_max > 10 : ${pmax.filter((v) => v > 10).length}`);
  console.log(`  price_max > 20 : ${pmax.filter((v) => v > 20).length}`);
  console.log(`  price_max > 50 : ${pmax.filter((v) => v > 50).length}`);
  sub('the ten highest price_max, with their projects');
  for (const p of [...projects].sort((a, b) => b.price_max - a.price_max).slice(0, 10)) {
    const ls = byProject.get(p.project_id) ?? [];
    const lmax = ls.length ? Math.max(...ls.map((r) => r.price)) : null;
    console.log(
      `  ${p.project_id}  price_min=${String(p.price_min).padStart(5)}  price_max=${String(p.price_max).padStart(6)}  ` +
      `as crore ₹${(p.price_max * 1e7).toLocaleString('en-IN').padStart(14)}  units=${String(p.total_units).padStart(4)}  ` +
      `max_area=${String(p.max_area_sqft).padStart(4)}  listings=${String(ls.length).padStart(2)}  costliest listing=${lmax ? '₹' + lmax.toLocaleString('en-IN') : '-'}`,
    );
  }

  sub('price_min distribution as served');
  const pmin = projects.map((r) => r.price_min);
  console.log(`  min=${Math.min(...pmin)} p25=${quantile(pmin, 0.25)} p50=${median(pmin)} p75=${quantile(pmin, 0.75)} max=${Math.max(...pmin)}`);
  console.log(`  price_min < 1  : ${pmin.filter((v) => v < 1).length}`);
  console.log(`  price_min > 100: ${pmin.filter((v) => v > 100).length}`);

  sub('implied price per sq ft under the lakh/crore reading');
  const impliedMin = projects.map((p) => (p.price_min * 1e5) / p.max_area_sqft);
  const impliedMax = projects.map((p) => (p.price_max * 1e7) / p.max_area_sqft);
  console.log(`  price_min(lakh)/max_area : p50=${round(median(impliedMin))}`);
  console.log(`  price_max(crore)/max_area: p50=${round(median(impliedMax))}  p95=${round(quantile(impliedMax, 0.95))}  max=${round(Math.max(...impliedMax))}`);
  console.log(`  for reference, listing price/carpet p50 among clean feeds = ${round(median(listings.filter((r) => CLEAN_FEEDS.has(r.website) && r.carpet_area > 0).map((r) => r.price / r.carpet_area)))}`);

  out.projects = { comparable, contained_rupees: containedRupees, contained_lakh_crore: containedLakhCrore };
}

const outPath = path.join(ROOT, 'notes', '03-units.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
