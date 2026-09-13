/**
 * Step 5 - how many distinct properties do the 3800 listing records describe?
 * Question 2. Offline.
 *
 * API_REFERENCE.md: "Every `listing_id` is globally unique, and each listing
 * corresponds to exactly one physical property." The first half is true in this
 * snapshot. The second is what this script tests.
 *
 * What did NOT work, and why (kept because the failures narrow the search):
 *
 *   - exact match on (apartment_name, locality, bedroom, carpet_area, floor)
 *     -> 3800 groups. No duplicate is an exact copy.
 *   - lat/lng as a property key -> 247 coordinates carry several records, but
 *     they are different flats in one building: a 1 BHK on floor 21 and a 4 BHK
 *     on floor 14 share coordinates because coordinates are building-level.
 *   - (lat, lng, bedroom, floor) -> 3800 groups, no collisions at all. So
 *     duplicates do not share coordinates; each feed geocodes independently.
 *
 * What did work: a pairwise scan inside blocks of records agreeing on every
 * structural field. The field-agreement histogram over pairs sharing
 * (apartment_name, bedroom) is bimodal with a gap - 12 pairs agree on 7 of 13
 * fields, 3 agree on 8, then 65 jump to 9 - and inspecting the 9s shows the
 * mechanism: same flat, re-listed, with the name lightly perturbed, the area
 * jittered by under 1%, the coordinates moved a few tens of metres, and the
 * price re-quoted.
 *
 * Run: node scripts/05-dupes.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import { loadAll, tally, groupBy, median, round, quantile } from './lib/data.js';
import { buildAreaReference, normalizeListing } from './lib/normalize.js';

const { listings: raw, rentals } = loadAll();
const ref = buildAreaReference(raw);
const L = raw.map((r) => normalizeListing(r, ref));

const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

// ===========================================================================
hr('A. How is apartment_name perturbed between duplicate records?');
// ===========================================================================
// Areas are normalised first: a duplicate pair can straddle the square-metre
// problem, with one feed serving sq m and the other sq ft for the same flat.
// Deliberately conservative. An earlier version also stripped trailing
// "residency", "heights", "towers" and "homes", which collapsed genuinely
// different buildings - "Century Residency" and "Century Heights" both became
// "century". Only the perturbations actually observed between duplicate pairs are
// undone here: case, doubled spaces, hyphens standing in for spaces, a leading
// "The", a trailing "Phase N", and a trailing "Apartment(s)".
const canonName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/, '')
    .replace(/\s+phase\s+\d+$/, '')
    .replace(/\s+apartments?$/, '')
    .replace(/\s+/g, ' ')
    .trim();

{
  const names = [...new Set(L.map((r) => r.apartment_name))];
  const stages = {
    'as served': (s) => s,
    'lowercase': (s) => s.toLowerCase(),
    '+ collapse spaces': (s) => s.toLowerCase().replace(/\s+/g, ' ').trim(),
    '+ strip leading "the"': (s) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^the\s+/, ''),
    '+ strip "phase N"': (s) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^the\s+/, '').replace(/\s+phase\s+\d+$/, ''),
    'full canonical': canonName,
  };
  for (const [label, fn] of Object.entries(stages)) {
    console.log(`  ${label.padEnd(24)} distinct: ${new Set(names.map(fn)).size}`);
  }

  sub('the collapsing groups (first 20)');
  const byCanon = groupBy(names.map((n) => ({ n })), (r) => canonName(r.n));
  const variants = [...byCanon.entries()].filter(([, v]) => v.length > 1);
  console.log(`  ${variants.length} canonical names have more than one served spelling`);
  for (const [k, v] of variants.slice(0, 20)) {
    console.log(`    ${k.padEnd(30)} <- ${JSON.stringify(v.map((x) => x.n))}`);
  }
  out.name_canonicalisation = {
    served_distinct: names.length,
    canonical_distinct: byCanon.size,
    groups_with_variants: variants.length,
  };
}

// ===========================================================================
hr('B. Candidate pairs');
// ===========================================================================
// Blocking key: every structural field that a re-listing of the same flat has no
// reason to change. apartment_name is deliberately NOT in the key, because it is
// one of the perturbed fields.
const STRUCTURAL = ['locality', 'bedroom', 'bathroom', 'balcony', 'covered_parking', 'floor', 'total_floors', 'furnishing', 'facing_direction', 'property_type'];
const blockKey = (r) => STRUCTURAL.map((f) => r[f]).join('|');

const metres = (a, b) => {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

let pairs;
{
  const blocks = groupBy(L, blockKey);
  pairs = [];
  for (const rows of blocks.values()) {
    if (rows.length < 2) continue;
    for (let i = 0; i < rows.length; i++) {
      for (let k = i + 1; k < rows.length; k++) {
        const a = rows[i];
        const b = rows[k];
        // The transposed-coordinate records would give nonsense distances, so
        // treat their distance as unknown and lean on the other signals.
        const swapped = a.latitude > 70 || b.latitude > 70;
        pairs.push({
          a, b,
          carpetRatio: Math.min(a.carpet_area_sqft, b.carpet_area_sqft) / Math.max(a.carpet_area_sqft, b.carpet_area_sqft),
          priceRatio: Math.min(a.price, b.price) / Math.max(a.price, b.price),
          dist: swapped ? null : metres(a, b),
          sameCanonName: canonName(a.apartment_name) === canonName(b.apartment_name),
          sameWebsite: a.website === b.website,
        });
      }
    }
  }
  console.log(`  blocks: ${blocks.size}   candidate pairs: ${pairs.length}`);
  console.log(`  carpet ratio bands : ${JSON.stringify(tally(pairs, (p) => (p.carpetRatio >= 0.98 ? '>=0.98' : p.carpetRatio >= 0.9 ? '0.90-0.98' : '<0.90')))}`);
  console.log(`  distance bands     : ${JSON.stringify(tally(pairs, (p) => (p.dist === null ? 'unknown' : p.dist < 100 ? '<100m' : p.dist < 500 ? '100-500m' : p.dist < 2000 ? '0.5-2km' : '>2km')))}`);

  sub('are the three signals independent, or do they agree?');
  const tight = pairs.filter((p) => p.carpetRatio >= 0.98);
  console.log(`  carpet within 2%                          : ${tight.length}`);
  console.log(`  ... and within 100m                       : ${tight.filter((p) => p.dist !== null && p.dist < 100).length}`);
  console.log(`  ... and same canonical apartment name     : ${tight.filter((p) => p.dist !== null && p.dist < 100 && p.sameCanonName).length}`);
  console.log(`  loose pairs (carpet <0.98) within 100m    : ${pairs.filter((p) => p.carpetRatio < 0.98 && p.dist !== null && p.dist < 100).length}`);
  console.log(`  loose pairs (carpet <0.98) beyond 100m    : ${pairs.filter((p) => p.carpetRatio < 0.98 && (p.dist === null || p.dist >= 100)).length}`);
}

// ===========================================================================
hr('C. Where is the natural cut? Sensitivity of the answer to the threshold');
// ===========================================================================
// If the rule is picking up a real planted structure, the count of distinct
// properties should be flat across a range of thresholds rather than sliding
// smoothly. A sliding count would mean the threshold is inventing the answer.
function componentsUnder(minCarpetRatio, maxMetres, requireName) {
  const parent = new Map(L.map((r) => [r.listing_id, r.listing_id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  let used = 0;
  for (const p of pairs) {
    if (p.carpetRatio < minCarpetRatio) continue;
    if (maxMetres !== null && !(p.dist !== null && p.dist <= maxMetres)) continue;
    if (requireName && !p.sameCanonName) continue;
    union(p.a.listing_id, p.b.listing_id);
    used++;
  }
  const roots = new Set([...parent.keys()].map(find));
  const sizes = new Map();
  for (const id of parent.keys()) {
    const r = find(id);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  return {
    pairs_used: used,
    properties: roots.size,
    duplicate_records: L.length - roots.size,
    group_sizes: tally([...sizes.values()].map((n) => ({ n })), (r) => r.n).sort((a, b) => a[0] - b[0]),
  };
}

{
  sub('varying the carpet-area tolerance, distance fixed at 100m, names not required');
  for (const cr of [0.999, 0.998, 0.995, 0.99, 0.985, 0.98, 0.97, 0.95, 0.9, 0.8]) {
    const c = componentsUnder(cr, 100, false);
    console.log(`  carpet ratio >= ${String(cr).padEnd(6)} -> pairs ${String(c.pairs_used).padStart(4)}  properties ${String(c.properties).padStart(5)}  duplicate records ${String(c.duplicate_records).padStart(4)}`);
  }
  sub('varying the distance tolerance, carpet fixed at 0.98');
  for (const m of [25, 50, 100, 200, 500, 1000, 5000, null]) {
    const c = componentsUnder(0.98, m, false);
    console.log(`  within ${String(m ?? 'any').padStart(5)}m -> pairs ${String(c.pairs_used).padStart(4)}  properties ${String(c.properties).padStart(5)}  duplicate records ${String(c.duplicate_records).padStart(4)}`);
  }
  sub('requiring the canonical apartment name to match as well');
  for (const cr of [0.99, 0.98, 0.95]) {
    const c = componentsUnder(cr, 100, true);
    console.log(`  carpet >= ${cr}, <=100m, same canonical name -> properties ${String(c.properties).padStart(5)}  duplicate records ${String(c.duplicate_records).padStart(4)}`);
  }
}

// ===========================================================================
hr('D. The chosen rule, and what it groups');
// ===========================================================================
// 200m rather than 100m: the four pairs between 100m and 200m sit at 100, 101,
// 102 and 106 metres, all with carpet within 0.7% and names that differ only by
// a suffix ("Godrej Residency" / "Godrej Residency Apartments", "Shriram
// Terraces Apartment" / "Shriram-Terraces"). The next candidate after those is
// at 1724m with a different building name, so the gap between 106m and 1724m is
// where the boundary belongs.
const CHOSEN = { carpet: 0.98, metres: 200, requireName: false };
{
  const c = componentsUnder(CHOSEN.carpet, CHOSEN.metres, CHOSEN.requireName);
  console.log(`  rule: identical on ${STRUCTURAL.length} structural fields, carpet area within 2% after`);
  console.log(`        unit correction, and within 100m`);
  console.log(`\n  distinct properties      : ${c.properties}`);
  console.log(`  duplicate records        : ${c.duplicate_records}`);
  console.log(`  group size distribution  : ${JSON.stringify(c.group_sizes)}`);
  out.chosen = { ...CHOSEN, ...c };

  sub('the pairs the rule rejects, sorted by how close they came');
  const rejected = pairs
    .filter((p) => !(p.carpetRatio >= CHOSEN.carpet && p.dist !== null && p.dist <= CHOSEN.metres))
    .sort((a, b) => b.carpetRatio - a.carpetRatio);
  console.log(`  ${rejected.length} rejected. The nearest misses:`);
  for (const p of rejected.slice(0, 12)) {
    console.log(`    carpetRatio=${p.carpetRatio.toFixed(4)} dist=${p.dist === null ? 'unknown (transposed coords)' : Math.round(p.dist) + 'm'}`);
    for (const r of [p.a, p.b]) {
      console.log(`      ${r.listing_id.padEnd(13)} ${String(r.website).padEnd(11)} ${String(r.apartment_name).slice(0, 26).padEnd(27)} carpet=${String(Math.round(r.carpet_area_sqft)).padStart(5)} price=${String(r.price).padStart(10)}`);
    }
  }

  sub('largest groups the rule builds');
  const parent = new Map(L.map((r) => [r.listing_id, r.listing_id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const p of pairs) {
    if (p.carpetRatio < CHOSEN.carpet) continue;
    if (!(p.dist !== null && p.dist <= CHOSEN.metres)) continue;
    const rx = find(p.a.listing_id); const ry = find(p.b.listing_id);
    if (rx !== ry) parent.set(rx, ry);
  }
  const groups = groupBy(L, (r) => find(r.listing_id));
  const big = [...groups.values()].filter((g) => g.length >= 3).sort((a, b) => b.length - a.length);
  console.log(`  groups of 3 or more: ${big.length}`);
  for (const g of big.slice(0, 5)) {
    console.log(`\n    group of ${g.length}:`);
    for (const r of g) {
      console.log(`      ${r.listing_id.padEnd(13)} ${String(r.website).padEnd(11)} ${String(r.apartment_name).slice(0, 28).padEnd(29)} bhk=${r.bedroom} fl=${r.floor}/${r.total_floors} carpet=${String(Math.round(r.carpet_area_sqft)).padStart(5)} price=${String(r.price).padStart(10)} ${r.posted_by_contact}`);
    }
  }

  // Persist the mapping so later scripts agree with this one.
  const propertyOf = {};
  for (const r of L) propertyOf[r.listing_id] = find(r.listing_id);
  fs.writeFileSync(path.join(ROOT, 'data', 'derived', 'property-groups.json'), j(propertyOf), 'utf8');
  out.duplicate_record_ids = L.filter((r) => find(r.listing_id) !== r.listing_id).map((r) => r.listing_id).sort();
}

// ===========================================================================
hr('E. Does the merge rule ever merge two genuinely different flats?');
// ===========================================================================
// The argument that it does not, stated as a test rather than an assertion.
//
// Distinct flats in the same building share EXACT coordinates - that is how the
// 247 multi-record coordinates arise, and it is why lat/lng failed as a property
// key. Duplicate records, by contrast, are independently geocoded and land tens
// of metres apart. So the two populations are separable: exact coordinate match
// means different flats in one building, near-but-unequal means one flat twice.
//
// Two things must hold for that to be sound:
//   1. no pair the rule merges shares exact coordinates;
//   2. no two records at the same exact coordinate share bedroom AND floor,
//      because that combination would be the same flat and would break the
//      claim that shared coordinates imply distinct flats.
{
  const accepted = pairs.filter((p) => p.carpetRatio >= CHOSEN.carpet && p.dist !== null && p.dist <= CHOSEN.metres);
  const exactCoord = accepted.filter((p) => p.a.latitude === p.b.latitude && p.a.longitude === p.b.longitude);
  console.log(`  pairs the rule merges                        : ${accepted.length}`);
  console.log(`  ... of which share EXACT coordinates         : ${exactCoord.length}   (want 0)`);
  const dists = accepted.map((p) => p.dist);
  console.log(`  merged-pair distance quantiles (m)           : p1=${Math.round(quantile(dists, 0.01))} p25=${Math.round(quantile(dists, 0.25))} p50=${Math.round(median(dists))} p75=${Math.round(quantile(dists, 0.75))} max=${Math.round(Math.max(...dists))}`);
  console.log(`  smallest carpet ratio among merged pairs     : ${round(Math.min(...accepted.map((p) => p.carpetRatio)), 4)}`);

  const byCoord = groupBy(L, (r) => `${r.latitude},${r.longitude}`);
  let multi = 0;
  let clash = 0;
  for (const rows of byCoord.values()) {
    if (rows.length < 2) continue;
    multi++;
    const seen = new Set();
    for (const r of rows) {
      const k = `${r.bedroom}|${r.floor}`;
      if (seen.has(k)) clash++;
      seen.add(k);
    }
  }
  console.log(`  coordinates carrying more than one record    : ${multi}`);
  console.log(`  ... records there sharing bedroom AND floor  : ${clash}   (want 0)`);

  sub('pairs whose canonical apartment_name still differs after canonicalisation');
  const diffName = accepted.filter((p) => canonName(p.a.apartment_name) !== canonName(p.b.apartment_name));
  console.log(`  ${diffName.length} of ${accepted.length}`);
  for (const p of diffName.slice(0, 15)) {
    console.log(`    ${String(Math.round(p.dist)).padStart(3)}m carpet=${p.carpetRatio.toFixed(4)}  [${p.a.apartment_name}] | [${p.b.apartment_name}]`);
  }
  out.merge_validation = {
    merged_pairs: accepted.length,
    merged_pairs_sharing_exact_coords: exactCoord.length,
    coords_with_multiple_records: multi,
    records_at_same_coord_sharing_bedroom_and_floor: clash,
    merged_pairs_with_differing_canonical_name: diffName.length,
  };
}

// ===========================================================================
hr('F. Same test on rentals, for the findings list');
// ===========================================================================
{
  const rRef = buildAreaReference(rentals.map((r) => ({ ...r, carpet_area: r.carpet_area })));
  const blocks = groupBy(rentals, (r) => ['locality', 'bedroom', 'bathroom', 'floor', 'total_floors', 'furnishing', 'facing_direction', 'property_type'].map((f) => r[f]).join('|'));
  let n = 0;
  let tight = 0;
  for (const rows of blocks.values()) {
    if (rows.length < 2) continue;
    for (let i = 0; i < rows.length; i++) {
      for (let k = i + 1; k < rows.length; k++) {
        n++;
        const a = rows[i]; const b = rows[k];
        const cr = Math.min(a.carpet_area, b.carpet_area) / Math.max(a.carpet_area, b.carpet_area);
        if (cr >= 0.98 && metres(a, b) < 100) tight++;
      }
    }
  }
  console.log(`  rental candidate pairs: ${n}, passing the same duplicate rule: ${tight}`);
  out.rental_duplicate_pairs = tight;
}

const outPath = path.join(ROOT, 'notes', '05-dupes.json');
fs.mkdirSync(path.join(ROOT, 'data', 'derived'), { recursive: true });
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
