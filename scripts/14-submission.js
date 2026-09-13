/**
 * Step 14 - assemble submission.json.
 *
 * The answers block is copied from data/derived/answers.json rather than retyped,
 * so the graded file cannot drift from the arithmetic that produced it.
 *
 * Evidence id lists are computed here from the snapshot for the same reason. Every
 * id in every finding is selected by re-running the predicate the finding is about,
 * so an id can never be stale or invented. Capped at the 20 the brief allows,
 * chosen deterministically (sorted, first 20) so the file is reproducible.
 *
 * The rule for what ships: only findings recorded as CONFIRMED in
 * notes/findings-log.md, meaning there is a request and response in
 * logs/requests.ndjson that demonstrates it. Under F1 an unreproduced claim costs
 * exactly as much as a missed one, so the SUSPECTED bucket in the notebook never
 * reaches this file. Two things I could see but not reproduce cleanly were left
 * out on that basis, and they are listed in the README.
 *
 * Run: node scripts/14-submission.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j, API_KEY } from './lib/http.js';
import { loadAll, groupBy, REFERENCE_MS } from './lib/data.js';
import { buildAreaReference, normalizeListing, parsePostedAt, INDIAN_UNIT_THRESHOLD } from './lib/normalize.js';

const { listings: raw, rentals, projects } = loadAll();
const ref = buildAreaReference(raw);
const L = raw.map((r) => normalizeListing(r, ref));

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const answers = read('data/derived/answers.json');
const propertyOf = read('data/derived/property-groups.json');
const corruptRules = read('notes/07-corrupt.json').rules;
const fraud = read('data/derived/fraud-candidates.json');

/** Deterministic, capped at the 20 the brief allows. */
const ev = (ids) => [...new Set(ids)].sort().slice(0, 20);

// ---------------------------------------------------------------------------
// Evidence, recomputed from the snapshot
// ---------------------------------------------------------------------------

// Records that lie beyond the advertised `total`, i.e. records the endpoint says
// do not exist. The pull order is the server's order, so anything at index >=
// 3466 is unreachable to a client that trusts `total`.
const beyondAdvertisedTotal = ev(raw.slice(3466).map((r) => r.listing_id));

const sqmIds = ev(L.filter((r) => r.area_unit_corrected).map((r) => r.listing_id));

// Projects whose price_max is quoted in lakhs - the 22 the simple per-field
// reading gets wrong, and the ones that decide question 7.
const lakhQuotedProjects = ev(projects.filter((p) => p.price_max >= INDIAN_UNIT_THRESHOLD).map((p) => p.project_id));

const notLiveListings = ev(L.filter((r) => r.is_live === false).map((r) => r.listing_id));
const notLiveRentals = ev(rentals.filter((r) => r.is_live === false).map((r) => r.listing_id));

// Duplicate pairs, presented as pairs so a reader can see the relationship rather
// than a flat list of ids.
const duplicatePairs = (() => {
  const byGroup = groupBy(L, (r) => propertyOf[r.listing_id]);
  const out = [];
  for (const rows of byGroup.values()) {
    if (rows.length < 2) continue;
    out.push(...rows.map((r) => r.listing_id).sort());
    if (out.length >= 20) break;
  }
  return out.slice(0, 20);
})();

// Listings whose window membership flips on the timezone reading. Concrete
// demonstration that the naive stamps are not UTC.
const timezoneBoundary = ev(
  L.filter((r) => {
    const ist = parsePostedAt(r.posted_at, 'ist');
    const utc = parsePostedAt(r.posted_at, 'utc');
    const from = REFERENCE_MS - 7 * 86400e3;
    const inIst = ist >= from && ist < REFERENCE_MS;
    const inUtc = utc >= from && utc < REFERENCE_MS;
    return inIst !== inUtc;
  }).map((r) => r.listing_id),
);

// Projects whose reported total_listings disagrees with the live listings that
// actually carry their project_id.
const wrongCountProjects = (() => {
  const byProject = groupBy(L.filter((r) => r.project_id), (r) => r.project_id);
  return ev(
    projects
      .filter((p) => (byProject.get(p.project_id) ?? []).filter((r) => r.is_live === true).length !== p.total_listings)
      .map((p) => p.project_id),
  );
})();

// Rentals whose title names a different locality than the locality field.
const titleMismatchRentals = ev(
  rentals
    .filter((r) => {
      const m = /for rent in (.+)$/.exec(r.title ?? '');
      return m && m[1].toLowerCase() !== r.locality;
    })
    .map((r) => r.listing_id),
);

// Records returned for project_id=P30001 that do not belong to P30001. Taken from
// the logged probe, not invented: the filter returned the unfiltered set, so the
// first records of the unfiltered order are the violating ones.
const projectIdFilterViolations = ev(
  raw.slice(0, 20).filter((r) => r.project_id !== 'P30001').map((r) => r.listing_id),
);

const rule = (name) => ev(corruptRules[name] ?? []);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const findings = [
  // ----- auth -----
  {
    endpoint: '*',
    category: 'auth',
    documented: 'the API key is appended as a query parameter, as in GET /v1/listings?api_key=IVY26-XXXXXXXXXXXX',
    actual: 'the key must be sent as an X-API-Key request header. A request carrying it as ?api_key= is rejected with 401 and the message "send your key in the X-API-Key request header, not as a query parameter"',
    how_found: 'first request of the project, written exactly as the reference shows it, then read the error body',
    impact: 'total - no authenticated request can be made by a client written to the documentation',
    evidence: [],
  },
  {
    endpoint: '/auth/login',
    category: 'auth',
    documented: 'the response carries the token in a field named "token"',
    actual: 'the field is named "access_token". Full response keys: access_token, refresh_token, token_type, expires_in, refresh_url, user',
    how_found: 'logged in and compared the response keys against the documented example',
    impact: 'high - a client reading response.token gets undefined and sends "Bearer undefined" on every subsequent request',
    evidence: [],
  },
  {
    endpoint: '/auth/login',
    category: 'auth',
    documented: 'expires_in is 86400, and "Tokens are valid for 24 hours, so a single login is enough for one working session"',
    actual: 'expires_in is 900. Confirmed independently by decoding the token, whose own exp - iat claim is also 900 seconds',
    how_found: 'read expires_in, then decoded the token payload to check it against the claim rather than trusting one source',
    impact: 'high - an app built on the documented lifetime stops working fifteen minutes after login, which a short manual test would never reveal',
    evidence: [],
  },
  {
    endpoint: '/auth/login',
    category: 'auth',
    documented: '"There is no refresh flow."',
    actual: 'the login response contains a refresh_token, valid for 604800 seconds by its own exp claim, and a refresh_url of "/auth/refresh"',
    how_found: 'inspected the full login response after finding the real token lifetime was 900 seconds',
    impact: 'high - the only workable way to keep a session alive is the flow the documentation denies exists',
    evidence: [],
  },
  {
    endpoint: '/auth/login',
    category: 'auth',
    documented: 'the user object is {"email": "demo1@ivy.homes", "name": "Demo User"}',
    actual: 'the user object contains only email; there is no name field',
    how_found: 'compared the login response against the documented example field by field',
    impact: 'low - a UI that greets the user by name renders undefined',
    evidence: [],
  },
  {
    endpoint: '/auth/logout',
    category: 'auth',
    documented: '"Invalidates the current token server side."',
    actual: 'returns 200 with {"ok": true, "note": "tokens are stateless; discard them client side"} and the token continues to work afterwards - a subsequent GET /v1/listings with the same token returns 200',
    how_found: 'logged out with demo3, then reused the same bearer token on a collection endpoint',
    impact: 'medium - a shared machine stays authenticated after a user signs out unless the client discards the token itself',
    evidence: [],
  },

  // ----- pagination -----
  {
    endpoint: '*',
    category: 'pagination',
    documented: 'every collection endpoint takes page (1-indexed) and limit, and "To fetch every record, read total, divide by your limit, and request that many pages"',
    actual: 'the window is controlled by offset, not page. page is accepted, returns 200, and is silently ignored: limit=1 and limit=1&page=2 return the identical record with offset echoed as 0, while limit=1&offset=1 returns the next record',
    how_found: 'requested limit=1, then limit=1&page=2, then limit=1&offset=1 and compared the returned listing_id and the echoed offset',
    impact: 'critical - the documented paging recipe re-reads the first page indefinitely while reporting no error, so a client believes it has read the whole dataset when it has seen twenty records',
    evidence: [],
  },
  {
    endpoint: '*',
    category: 'pagination',
    documented: 'collection responses are shaped {total, page, page_size, results}',
    actual: 'they are shaped {limit, offset, count, total, has_more, results}. page and page_size do not exist; count and has_more are undocumented, and has_more is the only reliable way to know whether more records remain',
    how_found: 'printed the top-level keys of the first collection response before writing any pager',
    impact: 'high - a client reading page_size to advance reads undefined, and the field that actually terminates a crawl is not mentioned',
    evidence: [],
  },
  {
    endpoint: '*',
    category: 'pagination',
    documented: 'limit has a maximum of 200',
    actual: 'the ceiling is 50. limit=200, 201, 500 and 99999 all return 200 OK with exactly 50 records and an echoed limit of 50 - the value is silently clamped rather than rejected. limit=0 and limit=-1 return 422',
    how_found: 'requested a range of limit values and compared the echoed limit and record count against what was asked for',
    impact: 'medium - combined with the page parameter being ignored, the documented recipe under-reads by a factor of four even for a client that pages correctly',
    evidence: [],
  },
  {
    endpoint: '*',
    category: 'pagination',
    documented: '"total is the exact number of records matching your filters"',
    actual: 'total understates the true count by a constant factor. It equals round(true count x p) for a single p in [0.912069, 0.912237], with zero exceptions across 26 tests spanning all three collections and filters on locality, bedroom, property_type and furnishing. /v1/listings serves 3800 records while reporting 3466, /v1/rentals 1450 while reporting 1323, /v1/projects 440 while reporting 401. The evidence ids below are listings that exist beyond the advertised total',
    how_found: 'paged each collection to has_more=false and compared the count against total, then repeated under 23 different filters and solved for the constant that reproduces every reported total',
    impact: 'critical - question 1 is unanswerable from total, and any client that trusts it silently discards 8.8% of every result set',
    evidence: beyondAdvertisedTotal,
  },

  // ----- units -----
  {
    endpoint: '/v1/projects',
    category: 'units',
    documented: '"price_min and price_max are in rupees", and money is "Indian rupees, integer, everywhere in the API"',
    actual: 'both fields are Indian display units, and the unit follows the value rather than the field: lakhs when the amount is below one crore, crores when it is at or above. They are also not integers - 409 of 440 price_min values and 435 of 440 price_max values are fractional. Splitting both fields at a served value of 10 gives 97 projects with both in crores, 321 with a minimum in lakhs and a maximum in crores, 22 with both in lakhs, and exactly 0 in the impossible combination of a minimum in crores with a maximum in lakhs - which is what proves the rule is per value, not per field. The evidence ids are the 22 projects whose price_max is in lakhs',
    how_found: 'noticed price_min 80 with price_max 3.22 on the first project, which only makes sense as 80 lakh to 3.22 crore. Read as one unit, 321 of 440 projects have a minimum above their maximum; decoded, 0 do. Confirmed against area - the decoded values put every project between about 5,300 and 11,000 rupees per sq ft against a listing median of 10,334, while the documented reading puts 22 projects between 530,000 and 870,000. Confirmed again by the API itself: sort_by=price_max&order=asc returns all 22 lakh-quoted projects first in ascending lakh order and only then the crore-quoted ones, so the server sorts on the true rupee value while serving a display unit',
    impact: 'critical - drives question 7. Taking price_max at face value makes P30394 the costliest project at an apparent 99.9 crore, when its real maximum is 99.9 lakh and the costliest project is P30288 at 4.47 crore',
    evidence: lakhQuotedProjects,
  },
  {
    endpoint: '/v1/listings',
    category: 'units',
    documented: 'area is "Square feet, integer, everywhere in the API"',
    actual: '306 of 3800 listings serve carpet_area and super_built_up_area in square metres. Both area fields on an affected record are converted together, so the carpet-to-super ratio stays at a healthy 0.746 and cannot detect it. All 306 come from the magichomes feed, but only 306 of that feed\'s 760 records are affected, so the source is not the rule',
    how_found: 'the four other feeds cap at about 16,000 rupees per carpet sq ft while magichomes reaches 168,469. Scored every record against the median carpet area for its own property_type and bedroom count, which avoids an absolute threshold that cannot separate a wrong unit from a genuinely small home. The scores are bimodal with an empty gap - 295 records in [0.08, 0.11), nothing below 0.06, next band at 0.3 - and the low mode\'s median score is 0.0933 against 1/10.7639 = 0.0929. Multiplying the 306 by 10.7639 moves their price per sq ft from a median of 111,008 to 10,313, against 10,338 for the clean feeds. Clinched within a single building: in Rohan Grand, magichomes lists a 2 BHK at carpet_area 73 while three other feeds list 921, 776 and 786 for the same building, and 73 x 10.7639 = 786',
    impact: 'critical - drives question 6. Without the correction the mean price per sq ft for live 2 BHK listings comes out at 19042.07 instead of 10844.99, 76% too high, and the affected records display as 49 sq ft flats',
    evidence: sqmIds,
  },

  // ----- filters -----
  {
    endpoint: '/v1/listings',
    category: 'filters',
    documented: 'the reference states that total_listings "always agrees with what GET /v1/listings?project_id=... returns", presenting project_id as a working filter',
    actual: 'project_id is accepted, returns 200, and is silently ignored. GET /v1/listings?project_id=P30001&limit=50 returns 50 records of which 50 carry a different project_id, and reports total 3466 - the unfiltered count - against the 4 listings that actually belong to P30001',
    how_found: 'sent each documented and referenced filter, then checked that every returned record satisfied it rather than trusting the 200',
    impact: 'medium - the cross-check the documentation itself proposes cannot be performed against the API, and a project page built on it shows the entire city',
    evidence: projectIdFilterViolations,
  },

  // ----- sorting -----
  {
    endpoint: '*',
    category: 'sorting',
    documented: 'order takes asc (default) or desc',
    actual: 'order is accepted and ignored; results are always ascending. On /v1/listings, sort_by=price with order=asc and order=desc both return the same page beginning at -15890000 and ending at 3370000. On /v1/projects, sort_by=price_max&order=desc likewise returns ascending values',
    how_found: 'requested each documented sort field with both order values and tested the returned sequence for monotonicity in each direction',
    impact: 'medium - no client can ask the server for the most expensive anything; descending order has to be done client side after retrieving everything',
    evidence: [],
  },
  {
    endpoint: '/v1/listings',
    category: 'sorting',
    documented: 'sort_by accepts posted_at, alongside price, carpet_area and bedroom',
    actual: 'sort_by=posted_at orders by calendar date only and ignores the time of day. The first page is monotone on the date and not on the timestamp: fourteen consecutive records all dated 2026-01-13 arrive with times 20:12, 20:10, 20:23, 03:22, 22:33, 11:18, 23:32, 20:45, 14:33, 08:36, 23:23, 06:22, 08:15, 16:59. Note also that the earliest record in the collection is 2026-01-13T00:31:00, which is not the record this sort returns first',
    how_found: 'sorted by posted_at and tested the returned sequence for monotonicity on the full timestamp and on the date substring separately',
    impact: 'medium - a newest-first feed built on this is wrong within any given day, and pagination over a date-only sort is not stable',
    evidence: [],
  },

  // ----- timestamps -----
  {
    endpoint: '/v1/listings',
    category: 'timestamps',
    documented: 'timestamps are "ISO 8601, UTC, Z suffix, everywhere in the API"',
    actual: 'posted_at carries no timezone information at all on all 3800 records, e.g. "2026-04-30T14:57:00". The values are IST wall-clock times, not UTC. /v1/rentals does carry a Z on all 1450 of its records, so the two endpoints disagree with each other as well as with the documentation. The evidence ids are listings whose membership of the seven days before the reference moment depends on which reading is used',
    how_found: 'hour-of-day clustering has no power here - posting times are uniform across the clock in both collections. What settles it is where each collection stops. Listings stop at 2026-09-09T23:54:00, six minutes before midnight, and then nothing for thirty days; the reference moment is 2026-09-10T00:00:00+05:30. Rentals, which carry an honest Z, stop 1.45 hours short of that same instant against an extreme-value prediction of 1.98 hours. Read the naive stamps as UTC and the listings run 5.4 hours past the cap the rentals respect, with 18 records piling into exactly that gap; read them as IST and both collections sit under one cap',
    impact: 'high - drives question 8. The two readings give 128 and 115 records for the seven days before the reference moment, and any UI displaying a posting time is off by five and a half hours',
    evidence: timezoneBoundary,
  },

  // ----- duplicates -----
  {
    endpoint: '/v1/listings',
    category: 'duplicates',
    documented: '"Every listing_id is globally unique, and each listing corresponds to exactly one physical property."',
    actual: 'the first half holds - all 3800 ids are distinct - but the second does not. 570 records are re-listings of a property already in the set, leaving 3230 distinct properties. A duplicate is generated by perturbing the record rather than copying it: the apartment name is case-folded, hyphenated, given a "The" prefix or a "Phase 1" or "Apartments" suffix, the area is jittered by under 1%, the coordinates are moved a median of 49 metres, and the price, contact and description are all replaced. The evidence ids are complete duplicate groups, so each pair or triple describes one property',
    how_found: 'exact-match keys all return 3800 groups, and lat/lng is not a property key - 247 coordinates carry several records, but those are different flats in one building, since coordinates are building-level. The useful consequence is that (lat, lng, bedroom, floor) has zero collisions across all 3800: distinct flats in one building share exact coordinates, while duplicates are geocoded independently and land tens of metres apart, so the two populations separate cleanly. Matching on all ten structural fields with carpet area within 2% after unit correction and within 200 metres gives 621 pairs. The count plateaus rather than sliding - carpet tolerance from 0.98 down to 0.80 gives the same 617 pairs, distance from 200m to 1000m the same 621, and the next rejected candidate is at 1724 metres. No merged pair shares exact coordinates, and an independent name-based rule returns the identical 3230',
    impact: 'high - drives question 2. Any per-property count, median or price index is inflated by 15% if duplicates are counted as distinct properties',
    evidence: duplicatePairs,
  },

  // ----- completeness -----
  {
    endpoint: '/v1/listings',
    category: 'completeness',
    documented: '"Returns active sale listings in your city. Inactive, expired and withdrawn listings are excluded server side, so anything this endpoint returns is safe to show to a user."',
    actual: 'nothing is excluded. 802 of the 3800 records carry is_live: false, a field which is itself absent from the documented listing object',
    how_found: 'counted is_live across the fully paged collection after noticing the field on the first record and finding it nowhere in the reference',
    impact: 'high - a frontend that trusts this sentence presents 802 withdrawn listings as available, and question 3 is about a field the documentation does not mention',
    evidence: notLiveListings,
  },
  {
    endpoint: '/v1/rentals',
    category: 'completeness',
    documented: 'the rental object is listed field by field, and is_live is not among them',
    actual: 'every rental record carries an is_live field, and 204 of 1450 are false',
    how_found: 'compared the served rental object keys against the documented example',
    impact: 'medium - rentals that are no longer available are indistinguishable from live ones unless the client knows to look for an undocumented field',
    evidence: notLiveRentals,
  },

  // ----- data_quality -----
  {
    endpoint: '/v1/listings',
    category: 'data_quality',
    documented: 'the listing object gives latitude and longitude as decimal degrees for a property in the key\'s city',
    actual: 'seven records have the two values transposed - latitude holds a Pune longitude around 73.8 and longitude holds a Pune latitude around 18.5, placing the property in the Barents Sea',
    how_found: 'the latitude range across the collection ran to 73.92, which is not a possible latitude for anything in Pune',
    impact: 'medium - any map view puts these seven properties in the Arctic Ocean, and a bounding-box search silently drops them',
    evidence: rule('coords_transposed'),
  },
  {
    endpoint: '/v1/listings',
    category: 'data_quality',
    documented: 'money is "Indian rupees, integer, everywhere in the API" and price is the asking price',
    actual: 'seven listings have a negative price, from -7140000 down to -15890000',
    how_found: 'took the minimum of price across the fully paged collection',
    impact: 'medium - these sort to the top of any ascending price list and drag down any mean; sort_by=price&order=asc returns -15890000 as the first record',
    evidence: rule('negative_price'),
  },
  {
    endpoint: '/v1/listings',
    category: 'data_quality',
    documented: 'floor and total_floors describe which floor the property is on and how many the building has',
    actual: 'seven records place the property on a floor the building does not have, including floor 43 of 29, floor 41 of 31, floor 41 of 32 and floor 34 of 20',
    how_found: 'compared floor against total_floors across the collection',
    impact: 'medium - the record cannot describe a real property, and a floor filter behaves unpredictably on it',
    evidence: rule('floor_above_building'),
  },
  {
    endpoint: '/v1/listings',
    category: 'data_quality',
    documented: 'carpet_area and super_built_up_area are both areas of the same property, carpet being the usable subset',
    actual: 'seven records have carpet_area strictly greater than super_built_up_area, up to 2398 against 1600, which inverts the containment. Note this is separate from the 136 plots where the two are equal - that is correct for land and is not reported here',
    how_found: 'the carpet-to-super ratio distribution has a small tail above 1. Restricting to strictly greater, and excluding plots, isolates seven records',
    impact: 'medium - price per carpet sq ft is understated for these records, and a carpet-area filter returns a property whose usable area exceeds its built-up area',
    evidence: rule('carpet_exceeds_super'),
  },
  {
    endpoint: '/v1/listings',
    category: 'data_quality',
    documented: 'posted_at is when the listing was posted',
    actual: 'seven listings are dated after the reference moment of 2026-09-10T00:00:00+05:30, by between 29 and 235 days, the latest being 2027-05-03. There is a thirty-day gap between the last legitimate record and the first of these, so they are not a boundary artefact',
    how_found: 'sorted posted_at descending across the fully paged collection and compared the top records against the reference moment and the server clock from /health',
    impact: 'medium - these appear first in any newest-first ordering, and they are counted by any "posted in the last N days" window that does not bound the future',
    evidence: rule('posted_after_reference'),
  },
  {
    endpoint: '/v1/listings',
    category: 'data_quality',
    documented: 'bedroom and bathroom are counts for the property, and property_type distinguishes a plot from a dwelling',
    actual: 'seven records that are not plots have bedroom 0 and bathroom 0 while sitting on floors 4 to 29 of real buildings - six apartments and one builder floor. These are distinct from the 136 genuine plots, all of which correctly have no bedrooms, no bathrooms and no floors',
    how_found: 'bedroom <= 0 fires on 143 records. 136 are plots, where it is correct. Conditioning the rule on property_type leaves seven apartments and builder floors, which the naive rule had buried among the plots',
    impact: 'medium - a bedroom filter cannot return them and a bedroom facet miscounts; they are also invisible to anyone who dismisses the whole 143 as plots',
    evidence: rule('non_plot_no_bedroom'),
  },

  // ----- fraud -----
  {
    endpoint: '/v1/listings',
    category: 'fraud',
    documented: '"posted_by_contact is the seller\'s verified contact number", and is_verified means "our operations team has checked the listing"',
    actual: '320 listings are posted from just 12 contact numbers, each of which appears under three to five different posted_by_name values while always presenting as an agent, never as the owner or builder it sometimes claims elsewhere. 85% of them carry is_verified true, against 62% across the collection. The evidence is the twelve numbers themselves',
    how_found: 'volume alone is not the signal - 3800 listings share 642 contacts and a real agency has thirty. The joint distribution of (distinct names, distinct roles) per contact has two separated populations: 630 contacts carry exactly one name, and 12 carry between three and five. Not one contact carries exactly two, so the cutoff cannot be argued with - thresholds of 2 and 3 both return the same 320 records. Confirmed from an unrelated direction: 41.3% of these listings are priced below 0.6x the median price per carpet sq ft for their own locality and bedroom count, against 0.7% of every other listing, a 57-fold enrichment. My first hypothesis was the reverse of this and wrong - one contact posting under one name but as owner, builder and agent at once describes 557 of the 642 contacts and is simply how the data is generated',
    impact: 'high - drives question 9. These listings are priced to attract enquiries and are over-represented among apparent bargains, so any "best value" ranking surfaces them first',
    evidence: fraud.contacts,
  },

  // ----- consistency -----
  {
    endpoint: '/v1/projects',
    category: 'consistency',
    documented: 'total_listings "is the number of listings currently available in the project. It is recomputed whenever a listing is added or withdrawn, so it always agrees with what GET /v1/listings?project_id=... returns."',
    actual: 'it disagrees for 95 of the 440 projects, by between -10 and +14. 43 projects report 0 listings while only one project actually has none. The comparison is against the live listings carrying each project_id, the reading that matches the documented wording and that agrees exactly on 345 projects; counting all records regardless of is_live agrees on only 123',
    how_found: 'grouped the fully paged listings by project_id and compared against each project\'s reported total_listings under four readings of "how many listings it has", then chose the one the field is evidently built from',
    impact: 'medium - a project page shows a listing count that does not match the listings on it, and the cross-check the documentation proposes cannot be run at all because the project_id filter is ignored',
    evidence: wrongCountProjects,
  },
  {
    endpoint: '/v1/rentals',
    category: 'consistency',
    documented: 'the rental object carries both a title, exemplified as "2 BHK for rent in Koramangala", and a locality field, with strings "Lowercase for locality"',
    actual: 'the locality named in the title never matches the locality field - 0 of 1450 records agree, where random assignment across ten localities would give about 145. The bedroom count in the title is correct in all 1450, and the description agrees with the locality field in all 1450, so the title\'s locality is the single field at fault',
    how_found: 'parsed the locality out of every title and compared it against the locality field, then did the same for the description and the bedroom count to establish which field was wrong rather than assuming',
    impact: 'high - a rental card built from the title advertises the wrong part of the city on every single record. It also decides question 5: no rental mentions Magarpatta in its title, so a title-based search of the assigned locality returns nothing at all',
    evidence: titleMismatchRentals,
  },

  // ----- missing endpoints -----
  {
    endpoint: '/v1/listing/{id}',
    category: 'missing_endpoint',
    documented: 'GET /v1/listing/{listing_id} returns a single listing',
    actual: '404 {"detail":"Not Found"}. The working path is the plural /v1/listings/{listing_id}',
    how_found: 'requested the documented path for a listing id taken from the collection, then tried the plural form',
    impact: 'high - the detail page of any app written to the documentation 404s on every listing',
    evidence: [],
  },
  {
    endpoint: '/v1/listings/{id}/similar',
    category: 'missing_endpoint',
    documented: 'returns up to ten comparable listings - same locality, same bedroom count, price within 15% - "useful for a you may also like strip on the detail page"',
    actual: '404 {"detail":"Not Found"}. Also absent at the documented singular prefix, /v1/listing/{id}/similar',
    how_found: 'requested it for several listing ids under both the plural and singular prefixes',
    impact: 'medium - a documented feature with a fully specified contract does not exist and has to be rebuilt from a filtered collection query',
    evidence: [],
  },
  {
    endpoint: '/v1/analytics/summary',
    category: 'missing_endpoint',
    documented: 'returns pre-computed aggregates for the city - total_listings, median_price, median_price_per_sqft, by_locality and by_bhk - with a full response schema',
    actual: '404 {"detail":"Not Found"}. Nothing exists at /v1/analytics either',
    how_found: 'requested it directly, then tried the parent path',
    impact: 'medium - every aggregate has to be computed client side from the full dataset, which also means computing it on data whose units and duplicates are wrong',
    evidence: [],
  },
  {
    endpoint: '/v1/favourites',
    category: 'missing_endpoint',
    documented: 'GET returns {count, results} of saved listings and POST with body {"id": "..."} saves one',
    actual: '404 on both verbs. Also absent at /v1/favorites, /v1/favourite, /v1/saved-listings, /v1/bookmarks, /v1/shortlist, /v1/wishlist, /v1/users/me/favourites, /v1/me/favourites, /v1/user/favourites and /favourites. The working endpoint is /v1/saved',
    how_found: 'requested the documented path, then swept eleven plausible alternatives before concluding the path was simply different',
    impact: 'high - saved listings, a required feature, cannot be implemented from the documentation at all',
    evidence: [],
  },
  {
    endpoint: '/v1/favourites/{id}',
    category: 'missing_endpoint',
    documented: 'DELETE /v1/favourites/{id} removes a saved listing',
    actual: '404 {"detail":"Not Found"}. Removal works at DELETE /v1/saved/{listing_id}',
    how_found: 'saved a listing through the working endpoint, then attempted removal at the documented path',
    impact: 'medium - a user can save but not unsave if the client follows the documentation',
    evidence: [],
  },

  // ----- undocumented endpoints -----
  {
    endpoint: '/v1/listings/{id}',
    category: 'undocumented_endpoint',
    documented: 'not documented; the reference gives the singular /v1/listing/{listing_id} instead',
    actual: 'exists and returns the full listing object, including the undocumented is_live field. An unknown id returns 404 with the message "no such listing in your city"',
    how_found: 'tried the plural form after the documented singular path returned 404',
    impact: 'none once known - this is the endpoint a detail page needs',
    evidence: [],
  },
  {
    endpoint: '/v1/saved',
    category: 'undocumented_endpoint',
    documented: 'not documented anywhere; the reference describes this feature at /v1/favourites',
    actual: 'the real saved-listings store. GET returns {count, results} where results are full listing objects - the exact shape the documentation gives for /v1/favourites. POST creates an entry and returns 201 {"ok": true, "listing_id": ..., "saved_count": n}, but its body field is listing_id, not the documented id: posting {"id": ...} returns 422 naming listing_id as the missing field. DELETE /v1/saved/{listing_id} removes an entry and returns 404 {"detail":"not in your saved list"} for one that was never saved. The store is per user and survives a fresh login',
    how_found: 'swept twelve candidate paths for the missing favourites feature, then mapped this one verb by verb - which body field it accepts, what it returns, whether demo1 and demo2 see each other\'s entries, and whether the list survives a re-login',
    impact: 'none once known - this is what a working saved-listings feature has to be built on',
    evidence: [],
  },
  {
    endpoint: '/auth/refresh',
    category: 'undocumented_endpoint',
    documented: 'not documented; the reference states "There is no refresh flow"',
    actual: 'POST with {"refresh_token": "..."} returns a fresh token pair. The path is advertised by the login response itself, in a refresh_url field that is also undocumented. A malformed refresh token returns 401 {"detail":"malformed or tampered token"}',
    how_found: 'the login response contained a refresh_token and a refresh_url, so I called it',
    impact: 'none once known - it is the only way to keep a session alive past fifteen minutes, which the assignment requires',
    evidence: [],
  },
];

// ---------------------------------------------------------------------------
// Candidate details. Kept in .env so they are not hardcoded into a script.
// ---------------------------------------------------------------------------
const candidate = {
  name: process.env.IVY_CANDIDATE_NAME ?? '',
  email: process.env.IVY_CANDIDATE_EMAIL ?? '',
  repo_url: process.env.IVY_REPO_URL ?? '',
  demo_url: process.env.IVY_DEMO_URL ?? '',
};

const submission = { api_key: API_KEY, candidate, answers, findings };

fs.writeFileSync(path.join(ROOT, 'submission.json'), j(submission) + '\n', 'utf8');

const byCat = {};
for (const f of findings) byCat[f.category] = (byCat[f.category] ?? 0) + 1;

console.log(`wrote submission.json`);
console.log(`  findings: ${findings.length}`);
for (const [k, v] of Object.entries(byCat).sort()) console.log(`    ${k.padEnd(24)} ${v}`);
console.log(`  findings carrying evidence: ${findings.filter((f) => f.evidence.length > 0).length}`);
console.log(`  evidence ids in total     : ${findings.reduce((a, f) => a + f.evidence.length, 0)}`);
const blank = Object.entries(candidate).filter(([, v]) => !v).map(([k]) => k);
if (blank.length) {
  console.log(`\n  candidate fields still blank: ${blank.join(', ')}`);
  console.log(`  set IVY_CANDIDATE_NAME, IVY_CANDIDATE_EMAIL, IVY_REPO_URL, IVY_DEMO_URL in .env`);
}
