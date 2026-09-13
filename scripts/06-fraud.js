/**
 * Step 6 - which listings are not genuine? Question 9. Offline.
 *
 * "Some of these listings are not real. They exist to generate enquiries."
 *
 * The submission format names phone numbers as acceptable `evidence`, which says
 * contact clustering is part of the answer. Volume alone cannot be the rule
 * though: 3800 listings share 642 contacts and a busy agency legitimately has
 * thirty.
 *
 * HYPOTHESIS 1, REJECTED. From the profile's top-15-by-volume table I thought
 * the signal was "one phone, one person's name, but posting as owner AND builder
 * AND agent across nine localities", on the reasoning that one individual cannot
 * be the owner of scattered properties in nine localities and also their builder.
 * Tested across all 642 contacts: 557 of them look exactly like that, covering
 * 3258 of 3800 listings. It is the norm, not an anomaly - the generator ties a
 * name to a number and picks the role per listing. Looking only at the top of a
 * table sorted by volume is how you get fooled by this.
 *
 * HYPOTHESIS 2, ACCEPTED. The joint distribution of (distinct names, distinct
 * roles) per contact has exactly two populations, and the anomaly is the reverse
 * of what I guessed: a small set of numbers carrying MANY names but only ever ONE
 * role. Twelve numbers, 3 to 5 fabricated identities each, always "agent",
 * spread over 8 to 10 localities. No contact anywhere has exactly 2 names, and
 * that gap is what makes this a planted set rather than a tail.
 *
 * Confirmed against a second, unrelated signal - price relative to the record's
 * own peer group - because question 9 is scored on how much of the real list was
 * found versus how much was invented.
 *
 * Run: node scripts/06-fraud.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j } from './lib/http.js';
import { loadAll, tally, groupBy, median, quantile, round, histogram } from './lib/data.js';
import { buildAreaReference, normalizeListing } from './lib/normalize.js';

const { listings: raw, rentals } = loadAll();
const ref = buildAreaReference(raw);
const L = raw.map((r) => normalizeListing(r, ref));

const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

const byPhone = groupBy(L, (r) => r.posted_by_contact);
const phoneStats = [...byPhone.entries()].map(([phone, rows]) => ({
  phone,
  n: rows.length,
  names: new Set(rows.map((r) => r.posted_by_name)),
  roles: new Set(rows.map((r) => r.posted_by)),
  localities: new Set(rows.map((r) => r.locality)),
  rows,
}));

// ===========================================================================
hr('A. The shape of the contact-number population');
// ===========================================================================
{
  console.log(`  ${byPhone.size} distinct contacts across ${L.length} listings`);
  sub('joint distribution of (distinct names, distinct roles) per contact');
  const grid = new Map();
  for (const s of phoneStats) {
    const k = `names=${s.names.size},roles=${s.roles.size}`;
    if (!grid.has(k)) grid.set(k, { contacts: 0, listings: 0 });
    grid.get(k).contacts++;
    grid.get(k).listings += s.n;
  }
  for (const [k, v] of [...grid.entries()].sort()) {
    console.log(`    ${k.padEnd(22)} contacts=${String(v.contacts).padStart(4)}  listings=${String(v.listings).padStart(4)}`);
  }
  console.log(`\n  distinct-name counts observed: ${JSON.stringify([...new Set(phoneStats.map((s) => s.names.size))].sort((a, b) => a - b))}`);
  console.log(`  -> no contact has exactly 2 names. Two separated populations, not a tail.`);

  sub('HYPOTHESIS 1, REJECTED: one name, several roles');
  const h1 = phoneStats.filter((s) => s.names.size === 1 && s.roles.size >= 2);
  console.log(`  contacts matching: ${h1.length} of ${phoneStats.length}   listings: ${h1.reduce((a, s) => a + s.n, 0)} of ${L.length}`);
  console.log(`  ${round((100 * h1.length) / phoneStats.length, 1)}% of all contacts. This describes the dataset, not a fraud ring.`);
  out.hypothesis1_rejected = { contacts: h1.length, listings: h1.reduce((a, s) => a + s.n, 0) };

  sub('HYPOTHESIS 2: several names, exactly one role');
  const h2 = phoneStats.filter((s) => s.names.size >= 3);
  console.log(`  contacts matching: ${h2.length}   listings: ${h2.reduce((a, s) => a + s.n, 0)}`);
  for (const s of h2.sort((a, b) => b.n - a.n)) {
    console.log(
      `    ${s.phone}  n=${String(s.n).padStart(3)}  names=${s.names.size}  roles=${[...s.roles].join('/')}  ` +
      `localities=${String(s.localities.size).padStart(2)}  [${[...s.names].join(', ')}]`,
    );
  }
  out.hypothesis2 = h2.map((s) => ({ phone: s.phone, n: s.n, names: [...s.names], roles: [...s.roles], localities: s.localities.size }));
}

const FARM = phoneStats.filter((s) => s.names.size >= 3);
const farmIds = new Set(FARM.flatMap((s) => s.rows.map((r) => r.listing_id)));

// ===========================================================================
hr('B. A second, independent signal: is the price plausible?');
// ===========================================================================
// A listing that exists to harvest enquiries is priced to attract them. Measured
// against the record's own peer group - same locality, same bedroom count, areas
// already unit-corrected - so this is relative, not a hand-picked threshold. It
// shares no input with the contact-name rule above.
const peerKey = (r) => `${r.locality}|${r.bedroom}`;
const peerMedian = new Map();
{
  for (const [k, rows] of groupBy(L, peerKey)) {
    const pps = rows.filter((r) => r.price > 0 && r.carpet_area_sqft > 0).map((r) => r.price / r.carpet_area_sqft);
    peerMedian.set(k, median(pps));
  }
  const rel = (r) => (r.price > 0 && r.carpet_area_sqft > 0 ? (r.price / r.carpet_area_sqft) / peerMedian.get(peerKey(r)) : null);

  const inF = L.filter((r) => farmIds.has(r.listing_id)).map(rel).filter((v) => v !== null);
  const outF = L.filter((r) => !farmIds.has(r.listing_id)).map(rel).filter((v) => v !== null);
  const q = (a) => [0.05, 0.25, 0.5, 0.75, 0.95].map((x) => round(quantile(a, x), 3)).join(' / ');

  console.log(`  relative price per sq ft, p5 / p25 / p50 / p75 / p95`);
  console.log(`    multi-name contacts (${inF.length} records) : ${q(inF)}`);
  console.log(`    everything else     (${outF.length} records): ${q(outF)}`);
  console.log(`\n  share below 0.6x their peer median:`);
  const a = inF.filter((v) => v < 0.6).length / inF.length;
  const b = outF.filter((v) => v < 0.6).length / outF.length;
  console.log(`    multi-name contacts : ${round(100 * a, 1)}%`);
  console.log(`    everything else     : ${round(100 * b, 1)}%`);
  console.log(`    enrichment          : ${round(a / b, 1)}x`);
  console.log(`\n  distribution of the relative price for the multi-name group:`);
  console.log(histogram(inF, { bins: 16 }));

  out.price_signal = {
    farm_quantiles: q(inF),
    rest_quantiles: q(outF),
    farm_below_0_6: round(a, 4),
    rest_below_0_6: round(b, 4),
    enrichment: round(a / b, 1),
  };
}

// ===========================================================================
hr('C. Other properties of the flagged set');
// ===========================================================================
{
  const F = L.filter((r) => farmIds.has(r.listing_id));
  console.log(`  flagged: ${F.length} listings on ${FARM.length} contacts`);
  console.log(`  is_verified  flagged ${JSON.stringify(tally(F, (r) => r.is_verified))}  all ${JSON.stringify(tally(L, (r) => r.is_verified))}`);
  console.log(`  is_live      flagged ${JSON.stringify(tally(F, (r) => r.is_live))}  all ${JSON.stringify(tally(L, (r) => r.is_live))}`);
  console.log(`  posted_by    flagged ${JSON.stringify(tally(F, (r) => r.posted_by))}`);
  console.log(`  website      flagged ${JSON.stringify(tally(F, (r) => r.website))}`);
  console.log(`  locality     flagged ${JSON.stringify(tally(F, (r) => r.locality))}`);
  console.log(`  price        min ${Math.min(...F.map((r) => r.price)).toLocaleString('en-IN')}  median ${median(F.map((r) => r.price)).toLocaleString('en-IN')}  max ${Math.max(...F.map((r) => r.price)).toLocaleString('en-IN')}`);
  console.log(`\n  85% is_verified against 62% overall, and 91% live against 79%, which is what`);
  console.log(`  a listing built to attract enquiries would look like.`);

  sub('the same 12 numbers in the rentals collection?');
  const rentalPhones = new Set(rentals.map((r) => r.posted_by_contact));
  console.log(`  flagged contacts appearing in /v1/rentals: ${FARM.filter((s) => rentalPhones.has(s.phone)).length}`);
  console.log(`  rentals have ${new Set(rentals.map((r) => r.posted_by_contact)).size} distinct contacts for ${rentals.length} records - one each, so no clustering is possible there.`);

  out.flagged_profile = {
    listings: F.length,
    contacts: FARM.length,
    is_verified: tally(F, (r) => r.is_verified),
    is_live: tally(F, (r) => r.is_live),
    posted_by: tally(F, (r) => r.posted_by),
  };
}

// ===========================================================================
hr('D. Signals tested and NOT used');
// ===========================================================================
{
  sub('repeated description text');
  const repeated = [...groupBy(L, (r) => r.description).entries()].filter(([, v]) => v.length > 1);
  console.log(`  descriptions used by more than one listing: ${repeated.length}`);
  for (const [d, rows] of repeated) {
    console.log(`    x${rows.length}: ${String(d).slice(0, 80)}`);
    for (const r of rows) console.log(`         ${r.listing_id} ${r.posted_by_contact} ${r.locality} flagged=${farmIds.has(r.listing_id)}`);
  }
  console.log(`  too few to be a rule.`);

  sub('description contradicting the structured fields');
  const bhkInText = (r) => {
    const m = /(\d+)\s*BHK/i.exec(r.description ?? '');
    return m ? Number(m[1]) : null;
  };
  const withBhk = L.filter((r) => bhkInText(r) !== null);
  const mismatch = withBhk.filter((r) => bhkInText(r) !== r.bedroom);
  console.log(`  descriptions stating a BHK: ${withBhk.length}, disagreeing with the bedroom field: ${mismatch.length}`);
  const LOCS = ['wakad', 'hinjewadi', 'kharadi', 'kothrud', 'aundh', 'magarpatta', 'hadapsar', 'balewadi', 'baner', 'viman nagar'];
  const locMismatch = L.filter((r) => {
    const d = String(r.description).toLowerCase();
    return !d.includes(r.locality) && LOCS.some((x) => x !== r.locality && d.includes(x));
  });
  console.log(`  descriptions naming a different locality than the locality field: ${locMismatch.length}`);
  console.log(`  the seller-written text agrees with the structured fields, so "a seller can`);
  console.log(`  write anything" does not cash out as a fraud signal on this data.`);
  out.not_used = { repeated_descriptions: repeated.length, desc_bhk_mismatch: mismatch.length, desc_locality_mismatch: locMismatch.length };

  sub('listing volume per contact on its own');
  const sizes = tally(phoneStats, (s) => s.n).sort((a, b) => a[0] - b[0]);
  console.log(`  listings-per-contact distribution: ${JSON.stringify(sizes)}`);
  console.log(`  the flagged 12 hold 18-31 each, but 15 unflagged contacts hold 10-13, so a`);
  console.log(`  volume threshold alone would either miss the set or drag in real agencies.`);
}

// ===========================================================================
hr('E. The answer to question 9');
// ===========================================================================
{
  const ids = [...farmIds].sort();
  console.log(`  fake_listing_ids: ${ids.length} records across ${FARM.length} phone numbers`);
  console.log(`  contacts: ${FARM.map((s) => s.phone).sort().join(', ')}`);

  sub('sensitivity');
  for (const minNames of [2, 3, 4, 5, 6]) {
    const sel = phoneStats.filter((s) => s.names.size >= minNames);
    console.log(`    names >= ${minNames} -> contacts ${String(sel.length).padStart(3)}  listings ${String(sel.reduce((a, s) => a + s.n, 0)).padStart(4)}`);
  }
  console.log(`    the answer is identical for a threshold of 2 or 3, because no contact has`);
  console.log(`    exactly 2 names. The choice of cutoff cannot change the result.`);

  sub('a sample of the flagged listings');
  for (const s of FARM.sort((a, b) => b.n - a.n).slice(0, 2)) {
    console.log(`\n  ${s.phone}  names=[${[...s.names].join(', ')}]  role=${[...s.roles].join('/')}`);
    for (const r of s.rows.slice(0, 8)) {
      const rl = r.price > 0 && r.carpet_area_sqft > 0 ? (r.price / r.carpet_area_sqft) / peerMedian.get(peerKey(r)) : null;
      console.log(
        `    ${r.listing_id.padEnd(13)} ${String(r.website).padEnd(11)} ${String(r.locality).padEnd(12)} ${String(r.posted_by_name).padEnd(17)} ` +
        `bhk=${r.bedroom} carpet=${String(Math.round(r.carpet_area_sqft)).padStart(5)} price=${String(r.price).padStart(10)} rel=${rl === null ? ' n/a' : rl.toFixed(2)}`,
      );
    }
  }

  out.flagged_contacts = FARM.map((s) => s.phone).sort();
  out.flagged_listing_ids = ids;
  fs.mkdirSync(path.join(ROOT, 'data', 'derived'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'data', 'derived', 'fraud-candidates.json'),
    j({
      rule: 'posted_by_contact carrying 3 or more distinct posted_by_name values',
      contacts: out.flagged_contacts,
      listing_ids: ids,
    }),
    'utf8',
  );
}

const outPath = path.join(ROOT, 'notes', '06-fraud.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
