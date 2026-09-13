/**
 * Step 7 - which listing records describe something that cannot exist?
 * Question 4. Offline.
 *
 * "Cannot exist" is read strictly: an internal contradiction, not an
 * implausibility. A cheap flat is not corrupt; a flat on the 41st floor of a
 * 31-storey building is.
 *
 * The trap here, already recorded in notes/findings-log.md, is that the obvious
 * rules fire on plots. 143 records have carpet_area >= super_built_up_area and
 * bedroom = 0 and bathroom = 0, and reporting them as corrupt would be wrong -
 * land has no bedrooms and its carpet area equals its built-up area. So every
 * rule below is checked against property_type, and the residuals are printed.
 *
 * Run: node scripts/07-corrupt.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import { loadAll, tally, groupBy, REFERENCE_MS } from './lib/data.js';
import { parsePostedAt } from './lib/normalize.js';

const { listings: L, rentals, projects } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

// ===========================================================================
hr('A. Establish what a plot legitimately looks like');
// ===========================================================================
{
  console.log(`  property_type counts: ${JSON.stringify(tally(L, (r) => r.property_type))}`);
  const plots = L.filter((r) => r.property_type === 'plot');
  const nonPlots = L.filter((r) => r.property_type !== 'plot');
  console.log(`\n  plots: ${plots.length}`);
  console.log(`    bedroom values      : ${JSON.stringify(tally(plots, (r) => r.bedroom))}`);
  console.log(`    bathroom values     : ${JSON.stringify(tally(plots, (r) => r.bathroom))}`);
  console.log(`    floor values        : ${JSON.stringify(tally(plots, (r) => r.floor))}`);
  console.log(`    total_floors values : ${JSON.stringify(tally(plots, (r) => r.total_floors))}`);
  console.log(`    carpet == super     : ${plots.filter((r) => r.carpet_area === r.super_built_up_area).length} of ${plots.length}`);
  console.log(`    carpet >  super     : ${plots.filter((r) => r.carpet_area > r.super_built_up_area).length}`);

  console.log(`\n  non-plots: ${nonPlots.length}`);
  console.log(`    bedroom = 0         : ${nonPlots.filter((r) => r.bedroom === 0).length}`);
  console.log(`    bathroom = 0        : ${nonPlots.filter((r) => r.bathroom === 0).length}`);
  console.log(`    total_floors = 0    : ${nonPlots.filter((r) => r.total_floors === 0).length}`);
  console.log(`    carpet == super     : ${nonPlots.filter((r) => r.carpet_area === r.super_built_up_area).length}`);
  console.log(`    carpet >  super     : ${nonPlots.filter((r) => r.carpet_area > r.super_built_up_area).length}`);

  sub('any record with bedroom = 0 that is NOT a plot?');
  const zeroBedNonPlot = nonPlots.filter((r) => r.bedroom === 0);
  console.log(`  ${zeroBedNonPlot.length} records`);
  for (const r of zeroBedNonPlot) {
    console.log(`    ${r.listing_id.padEnd(13)} type=${String(r.property_type).padEnd(18)} bhk=${r.bedroom} bath=${r.bathroom} floor=${r.floor}/${r.total_floors} carpet=${r.carpet_area} super=${r.super_built_up_area} price=${r.price} live=${r.is_live}`);
  }

  sub('any plot on a floor above the ground, or in a building with floors?');
  const plotOnFloor = plots.filter((r) => r.floor > 0 || r.total_floors > 0);
  console.log(`  ${plotOnFloor.length} records`);
  for (const r of plotOnFloor.slice(0, 20)) {
    console.log(`    ${r.listing_id.padEnd(13)} floor=${r.floor}/${r.total_floors} carpet=${r.carpet_area} super=${r.super_built_up_area} price=${r.price} live=${r.is_live}`);
  }
  out.plot_profile = {
    plots: plots.length,
    zero_bedroom_non_plot: zeroBedNonPlot.map((r) => r.listing_id),
    plot_on_a_floor: plotOnFloor.map((r) => r.listing_id),
  };
}

// ===========================================================================
hr('B. Impossibility rules, each reported separately');
// ===========================================================================
const RULES = {
  // Geography. A Pune property at latitude 73.9 and longitude 18.6 is in the
  // Barents Sea. The two fields have been swapped.
  coords_transposed: (r) => r.latitude > 70 && r.longitude < 20,

  // Money. A negative asking price is not a discount.
  negative_price: (r) => r.price < 0,
  zero_price: (r) => r.price === 0,

  // Building geometry. A home cannot be on a floor the building does not have.
  floor_above_building: (r) => Number.isFinite(r.floor) && Number.isFinite(r.total_floors) && r.floor > r.total_floors,

  // Area. Carpet area is a subset of super built-up area, so it cannot exceed
  // it. Equality is legitimate for a plot and is excluded.
  carpet_exceeds_super: (r) => r.carpet_area > 0 && r.super_built_up_area > 0 && r.carpet_area > r.super_built_up_area,

  // Equality on something that is not land.
  carpet_equals_super_non_plot: (r) => r.property_type !== 'plot' && r.carpet_area > 0 && r.carpet_area === r.super_built_up_area,

  // Time. A listing cannot have been posted after the moment we are evaluating.
  posted_after_reference: (r) => parsePostedAt(r.posted_at) >= REFERENCE_MS,

  // Non-plot dwellings with no bedroom or no bathroom.
  non_plot_no_bedroom: (r) => r.property_type !== 'plot' && !(r.bedroom > 0),
  non_plot_no_bathroom: (r) => r.property_type !== 'plot' && !(r.bathroom > 0),
  non_plot_no_floors: (r) => r.property_type !== 'plot' && !(r.total_floors > 0),
};

const hits = {};
{
  for (const [name, fn] of Object.entries(RULES)) {
    const rows = L.filter(fn);
    hits[name] = rows.map((r) => r.listing_id).sort();
    console.log(`  ${name.padEnd(30)} ${String(rows.length).padStart(4)}`);
    for (const r of rows.slice(0, 8)) {
      console.log(`      ${r.listing_id.padEnd(13)} ${String(r.property_type).padEnd(18)} bhk=${r.bedroom} bath=${r.bathroom} fl=${r.floor}/${r.total_floors} carpet=${String(r.carpet_area).padStart(5)} super=${String(r.super_built_up_area).padStart(5)} price=${String(r.price).padStart(11)} lat=${r.latitude} live=${r.is_live}`);
    }
    if (rows.length > 8) console.log(`      ... ${rows.length - 8} more`);
  }
  out.rules = hits;
}

// ===========================================================================
hr('C. Overlap between the rules');
// ===========================================================================
{
  const names = Object.keys(hits).filter((k) => hits[k].length > 0);
  const union = new Set(names.flatMap((k) => hits[k]));
  console.log(`  union of all firing rules: ${union.size} records`);
  const counts = new Map();
  for (const k of names) for (const id of hits[k]) counts.set(id, (counts.get(id) ?? 0) + 1);
  console.log(`  records triggering more than one rule: ${[...counts.values()].filter((v) => v > 1).length}`);
  for (const [id, c] of [...counts.entries()].filter(([, v]) => v > 1)) {
    console.log(`    ${id.padEnd(13)} ${names.filter((k) => hits[k].includes(id)).join(', ')}`);
  }
  console.log(`\n  per-rule counts: ${JSON.stringify(Object.fromEntries(names.map((k) => [k, hits[k].length])))}`);
  out.union = [...union].sort();
}

// ===========================================================================
hr('D. Same rules on rentals and projects, for the findings list');
// ===========================================================================
{
  const rRules = {
    coords_transposed: (r) => r.latitude > 70 && r.longitude < 20,
    non_positive_price: (r) => !(r.price > 0),
    floor_above_building: (r) => r.floor > r.total_floors,
    carpet_exceeds_super: (r) => r.carpet_area > r.super_builtup_area,
    posted_after_reference: (r) => parsePostedAt(r.posted_at) >= REFERENCE_MS,
    negative_deposit: (r) => r.deposit < 0,
  };
  console.log('  rentals:');
  for (const [n, fn] of Object.entries(rRules)) console.log(`    ${n.padEnd(24)} ${rentals.filter(fn).length}`);

  const pRules = {
    possession_before_launch: (p) => p.possession_date < p.launch_date,
    non_positive_units: (p) => !(p.total_units > 0),
    min_area_above_max: (p) => p.min_area_sqft > p.max_area_sqft,
    floors_below_one: (p) => !(p.total_floors > 0),
    towers_below_one: (p) => !(p.total_towers > 0),
  };
  console.log('  projects:');
  for (const [n, fn] of Object.entries(pRules)) console.log(`    ${n.padEnd(24)} ${projects.filter(fn).length}`);
}

// ===========================================================================
hr('E. The answer to question 4');
// ===========================================================================
{
  // Rules that describe a genuine impossibility, as opposed to a shape that a
  // plot legitimately has.
  const CORRUPT_RULES = [
    'coords_transposed',
    'negative_price',
    'zero_price',
    'floor_above_building',
    'carpet_exceeds_super',
    'carpet_equals_super_non_plot',
    'posted_after_reference',
    'non_plot_no_bedroom',
    'non_plot_no_bathroom',
    'non_plot_no_floors',
  ];
  const ids = [...new Set(CORRUPT_RULES.flatMap((k) => hits[k]))].sort();
  console.log(`  rules used: ${CORRUPT_RULES.filter((k) => hits[k].length).join(', ')}`);
  console.log(`  corrupt_listing_ids (${ids.length}):`);
  for (const id of ids) {
    const r = L.find((x) => x.listing_id === id);
    const why = CORRUPT_RULES.filter((k) => hits[k].includes(id));
    console.log(`    ${id.padEnd(13)} ${why.join(', ')}`);
  }
  out.corrupt_listing_ids = ids;
  fs.mkdirSync(path.join(ROOT, 'data', 'derived'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'corrupt.json'), j({ rules: CORRUPT_RULES, listing_ids: ids }), 'utf8');
}

const outPath = path.join(ROOT, 'notes', '07-corrupt.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
