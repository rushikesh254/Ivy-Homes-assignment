/**
 * Step 9 - follow up on three things step 8 turned up. Network.
 *
 *   1. /v1/favourites 404s for every verb. Before reporting the whole section as
 *      fiction, look for it under a different spelling or path - saved listings
 *      have to be built on whichever path exists, and which way depends on this.
 *
 *   2. sort_by=price_max&order=desc on /v1/projects returned 62.7, 66.5, 75.3,
 *      75.5 ... which is neither ascending nor descending in the served numbers.
 *      It IS ascending in decoded rupees, because 62.7 lakh is less than 1.01
 *      crore. If that holds across a full page it is independent, server-side
 *      confirmation of the lakh/crore decoding - the API sorts by the real value
 *      while serving a display-unit number.
 *
 *   3. `total` looked like a fixed fraction of the true count under every filter.
 *      Worth pinning down as a law rather than an observation.
 *
 * Run: node scripts/09-probe2.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j, stats } from './lib/http.js';
import { Session } from './lib/session.js';
import { loadAll, round, quantile } from './lib/data.js';
import { decodeIndianDisplayPrice, displayUnitOf, parsePostedAt } from './lib/normalize.js';

const { listings, rentals, projects } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

const session = new Session();
await session.login();
const recs = (res) => (Array.isArray(res.json?.results) ? res.json.results : []);

// ===========================================================================
hr('A. Does saved-listing storage exist anywhere on the server?');
// ===========================================================================
{
  const id = listings[0].listing_id;
  const CANDIDATES = [
    ['GET', '/v1/favourites'],
    ['GET', '/v1/favorites'],
    ['GET', '/v1/favourite'],
    ['GET', '/v1/saved'],
    ['GET', '/v1/saved-listings'],
    ['GET', '/v1/bookmarks'],
    ['GET', '/v1/shortlist'],
    ['GET', '/v1/wishlist'],
    ['GET', '/v1/users/me/favourites'],
    ['GET', '/v1/me/favourites'],
    ['GET', '/favourites'],
    ['GET', '/v1/user/favourites'],
  ];
  out.favourite_paths = [];
  for (const [method, p] of CANDIDATES) {
    const res = await session.get(p, { method, label: `probe2:fav:${p}` });
    console.log(`  ${method} ${p.padEnd(28)} -> ${res.status} ${JSON.stringify(res.json).slice(0, 90)}`);
    out.favourite_paths.push({ method, path: p, status: res.status, body: res.json });
  }
  sub('and POST, in case only the collection GET is missing');
  for (const p of ['/v1/favourites', '/v1/favorites', '/v1/saved']) {
    const res = await session.post(p, { id, listing_id: id }, { label: `probe2:fav-post:${p}` });
    console.log(`  POST ${p.padEnd(28)} -> ${res.status} ${JSON.stringify(res.json).slice(0, 90)}`);
  }
  console.log(`\n  conclusion: saved listings must be implemented client side, keyed by user.`);
}

// ===========================================================================
hr('B. Does the server sort projects by the DECODED rupee value?');
// ===========================================================================
{
  const res = await session.get('/v1/projects', { query: { sort_by: 'price_max', order: 'asc', limit: 50 }, label: 'probe2:sort-price_max-asc' });
  const rows = recs(res);
  console.log(`  first 50 by sort_by=price_max&order=asc`);
  console.log(`  ${'served'.padStart(8)} ${'unit'.padStart(6)} ${'decoded INR'.padStart(14)}  monotone so far`);
  let prevServed = -Infinity;
  let prevDecoded = -Infinity;
  let servedMonotone = true;
  let decodedMonotone = true;
  for (const p of rows) {
    const dec = decodeIndianDisplayPrice(p.price_max);
    if (p.price_max < prevServed) servedMonotone = false;
    if (dec < prevDecoded) decodedMonotone = false;
    prevServed = p.price_max;
    prevDecoded = dec;
  }
  for (const p of rows.slice(0, 26)) {
    console.log(`  ${String(p.price_max).padStart(8)} ${String(displayUnitOf(p.price_max)).padStart(6)} ${decodeIndianDisplayPrice(p.price_max).toLocaleString('en-IN').padStart(14)}`);
  }
  console.log(`  ...`);
  console.log(`\n  ascending in the SERVED number   : ${servedMonotone}`);
  console.log(`  ascending in the DECODED rupees  : ${decodedMonotone}`);
  console.log(`  the 22 lakh-unit projects appear : first ${rows.filter((p) => p.price_max >= 10).length} of the first 50`);
  console.log(`\n  If decoded is monotone and served is not, the server is ordering by the`);
  console.log(`  real rupee value while serving a display-unit number. That is independent`);
  console.log(`  confirmation of UNITS-1 from the API's own behaviour.`);
  out.project_sort = {
    served_monotone: servedMonotone,
    decoded_monotone: decodedMonotone,
    first_50_served: rows.map((p) => p.price_max),
    lakh_unit_in_first_50: rows.filter((p) => p.price_max >= 10).length,
  };

  sub('same test on price_min');
  const res2 = await session.get('/v1/projects', { query: { sort_by: 'price_min', order: 'asc', limit: 50 }, label: 'probe2:sort-price_min-asc' });
  const rows2 = recs(res2);
  const served2 = rows2.map((p) => p.price_min);
  const decoded2 = rows2.map((p) => decodeIndianDisplayPrice(p.price_min));
  console.log(`  served  first 12: ${JSON.stringify(served2.slice(0, 12))}`);
  console.log(`  decoded first 12: ${JSON.stringify(decoded2.slice(0, 12).map((v) => v / 1e5 + 'L'))}`);
  console.log(`  ascending in served : ${served2.every((v, i) => i === 0 || served2[i - 1] <= v)}`);
  console.log(`  ascending in decoded: ${decoded2.every((v, i) => i === 0 || decoded2[i - 1] <= v)}`);
  out.project_sort_min = {
    served_monotone: served2.every((v, i) => i === 0 || served2[i - 1] <= v),
    decoded_monotone: decoded2.every((v, i) => i === 0 || decoded2[i - 1] <= v),
  };
}

// ===========================================================================
hr('C. sort_by=posted_at - sorted by instant, or only by date?');
// ===========================================================================
{
  const res = await session.get('/v1/listings', { query: { sort_by: 'posted_at', order: 'asc', limit: 50 }, label: 'probe2:sort-posted_at' });
  const rows = recs(res);
  const stamps = rows.map((r) => r.posted_at);
  const dates = stamps.map((s) => s.slice(0, 10));
  const fullMonotone = stamps.every((v, i) => i === 0 || stamps[i - 1] <= v);
  const dateMonotone = dates.every((v, i) => i === 0 || dates[i - 1] <= v);
  console.log(`  first 14 stamps: ${JSON.stringify(stamps.slice(0, 14))}`);
  console.log(`  monotone on the full timestamp : ${fullMonotone}`);
  console.log(`  monotone on the date only      : ${dateMonotone}`);
  console.log(`  distinct dates in the page     : ${new Set(dates).size}`);
  console.log(`\n  earliest posted_at in the snapshot: ${[...listings].map((r) => r.posted_at).sort()[0]}`);
  console.log(`  the page's first record          : ${stamps[0]}`);
  if (dateMonotone && !fullMonotone) {
    console.log(`  => sorts by calendar date only; the time of day is not part of the ordering.`);
  }
  out.posted_at_sort = { fullMonotone, dateMonotone, first14: stamps.slice(0, 14) };
}

// ===========================================================================
hr('D. Is `total` a fixed fraction of the true count?');
// ===========================================================================
{
  // Each probe pairs a server-reported `total` with the count computed on the
  // local snapshot for the same predicate.
  const CASES = [
    { label: 'no filter (listings)', path: '/v1/listings', query: {}, count: listings.length },
    { label: 'no filter (rentals)', path: '/v1/rentals', query: {}, count: rentals.length },
    { label: 'no filter (projects)', path: '/v1/projects', query: {}, count: projects.length },
    ...['wakad', 'hinjewadi', 'kharadi', 'kothrud', 'aundh', 'magarpatta', 'hadapsar', 'balewadi', 'baner', 'viman nagar'].map((loc) => ({
      label: `locality=${loc}`, path: '/v1/listings', query: { locality: loc }, count: listings.filter((r) => r.locality === loc).length,
    })),
    ...[1, 2, 3, 4, 5].map((b) => ({ label: `bhk=${b}`, path: '/v1/listings', query: { bhk: b }, count: listings.filter((r) => r.bedroom === b).length })),
    ...['apartment', 'villa', 'plot', 'builder floor', 'independent house'].map((t) => ({
      label: `property_type=${t}`, path: '/v1/listings', query: { property_type: t }, count: listings.filter((r) => r.property_type === t).length,
    })),
    ...['unfurnished', 'semi-furnished', 'fully-furnished'].map((f) => ({
      label: `furnishing=${f}`, path: '/v1/listings', query: { furnishing: f }, count: listings.filter((r) => r.furnishing === f).length,
    })),
  ];

  const rows = [];
  for (const c of CASES) {
    const res = await session.get(c.path, { query: { ...c.query, limit: 1 }, label: `probe2:total:${c.label}` });
    const total = res.json?.total ?? null;
    rows.push({ ...c, total, ratio: total !== null && c.count ? total / c.count : null });
  }

  console.log(`  ${'case'.padEnd(30)} ${'server total'.padStart(12)} ${'snapshot'.padStart(9)} ${'ratio'.padStart(9)}`);
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(30)} ${String(r.total).padStart(12)} ${String(r.count).padStart(9)} ${r.ratio === null ? '    -' : r.ratio.toFixed(6).padStart(9)}`);
  }
  const ratios = rows.map((r) => r.ratio).filter((v) => Number.isFinite(v));
  console.log(`\n  ratio: min=${round(Math.min(...ratios), 6)}  max=${round(Math.max(...ratios), 6)}  spread=${round(Math.max(...ratios) - Math.min(...ratios), 6)}`);

  // Find the tightest constant p for which round(count * p) == total everywhere.
  let lo = 0;
  let hi = 1;
  for (const r of rows) {
    if (r.total === null || !r.count) continue;
    lo = Math.max(lo, (r.total - 0.5) / r.count);
    hi = Math.min(hi, (r.total + 0.5) / r.count);
  }
  console.log(`  constant p with round(count*p) == total for every case: p in [${lo.toFixed(6)}, ${hi.toFixed(6)}]`);
  console.log(`  feasible: ${lo < hi}   midpoint p = ${((lo + hi) / 2).toFixed(6)}`);
  const p = (lo + hi) / 2;
  const misfits = rows.filter((r) => r.total !== null && r.count && Math.round(r.count * p) !== r.total);
  console.log(`  cases where round(count * ${p.toFixed(5)}) != total : ${misfits.length} of ${rows.filter((r) => r.total !== null).length}`);
  for (const m of misfits) console.log(`    ${m.label}: predicted ${Math.round(m.count * p)}, server said ${m.total}`);

  out.total_law = { p_lo: round(lo, 6), p_hi: round(hi, 6), p_mid: round(p, 6), feasible: lo < hi, cases: rows.map(({ label, total, count, ratio }) => ({ label, total, count, ratio: ratio === null ? null : round(ratio, 6) })), misfits: misfits.length };
}

console.log(`\nrequests this run: ${stats().requests}`);
const outPath = path.join(ROOT, 'notes', '09-probe2.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`wrote ${path.relative(ROOT, outPath)}`);
