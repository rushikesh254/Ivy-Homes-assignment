/**
 * The correction layer. The single place a correction is decided, so every
 * script that uses it computes the same number.
 *
 * Everything here is derived from a measurement recorded in
 * notes/findings-log.md. Nothing is a hardcoded list of ids, because a hardcoded
 * list would stop being true the moment the data changed and would prove nothing
 * about why those records are the ones affected.
 */

export const SQFT_PER_SQM = 10.7639104;

// ---------------------------------------------------------------------------
// Project prices - UNITS-1
//
// API_REFERENCE.md: "price_min and price_max are in rupees." They are not. They
// are in Indian display units: lakhs below one crore, crores at or above it.
//
// Evidence for the per-value rule rather than a per-field one, over all 440
// projects in the snapshot:
//
//   price_min occupies [1, 1.53] union [30, 99.9]      - empty in between
//   price_max occupies [1.01, 4.47] union [62.7, 99.9] - empty in between
//
//   price_min < 10 and price_max < 10  ->  97 projects  (both crores)
//   price_min >= 10 and price_max < 10 -> 321 projects  (lakhs, then crores)
//   price_min >= 10 and price_max >= 10 -> 22 projects  (both lakhs)
//   price_min < 10 and price_max >= 10 ->   0 projects  (impossible: a minimum
//                                            of >= 1 crore with a maximum of
//                                            < 1 crore)
//
// That fourth cell being exactly empty is the proof. If the unit were chosen per
// field at random we would expect roughly 24 projects in it.
//
// Cross-check: dividing by max_area_sqft, the chosen reading puts every project
// between about 5,300 and 11,000 rupees per sq ft, against a listing median of
// 10,334. The rejected reading puts 22 projects between 530,000 and 870,000.
//
// The threshold sits at 10, comfortably inside both empty gaps.
// ---------------------------------------------------------------------------

export const INDIAN_UNIT_THRESHOLD = 10;

/** Decode one project price field to rupees. */
export function decodeIndianDisplayPrice(x) {
  if (!Number.isFinite(x)) return null;
  return x >= INDIAN_UNIT_THRESHOLD ? Math.round(x * 1e5) : Math.round(x * 1e7);
}

/** Which unit a given served value is expressed in. For explaining, not deciding. */
export const displayUnitOf = (x) =>
  !Number.isFinite(x) ? null : x >= INDIAN_UNIT_THRESHOLD ? 'lakh' : 'crore';

export function normalizeProject(p) {
  return {
    ...p,
    price_min_inr: decodeIndianDisplayPrice(p.price_min),
    price_max_inr: decodeIndianDisplayPrice(p.price_max),
    price_min_unit_as_served: displayUnitOf(p.price_min),
    price_max_unit_as_served: displayUnitOf(p.price_max),
  };
}

// ---------------------------------------------------------------------------
// Listing areas - UNITS-2
//
// 306 of 3800 listings carry carpet_area and super_built_up_area in square
// metres. All 306 come from the `magichomes` feed, but only 306 of that feed's
// 760 records are affected, so "which website" is not the rule - it is a
// property of the record.
//
// Detection deliberately avoids an absolute threshold, because an absolute
// threshold cannot separate "wrong unit" from "genuinely small home". Instead
// each record is scored against the median carpet area of records sharing its
// property_type and bedroom count:
//
//     score = carpet_area / median carpet_area for the same type and bedrooms
//
// A record in square feet scores near 1. A record in square metres scores near
// 1/10.7639 = 0.0929. Measured over the snapshot the scores are sharply bimodal:
// 295 records in [0.08, 0.11), nothing at all below 0.06, and the next
// populated band does not start until 0.3. Median score of the low mode is
// 0.0933 against a predicted 0.0929.
//
// The median reference is robust to the contamination it is measuring - 306 of
// 3800 is 8%, far below the 50% a median tolerates.
//
// Note the ratio carpet/super is NOT usable here. It is unit-invariant, and both
// area fields are converted together, so it stays at a healthy 0.746 on exactly
// the records that are wrong. That is why this needed a different probe, and why
// a submission that only ran the ratio test would miss all 306.
// ---------------------------------------------------------------------------

/** Score below which a record is taken to be in square metres. Sits in the empty gap. */
export const SQM_SCORE_CUTOFF = 0.3;

const areaRefKey = (r) => `${r.property_type}|${r.bedroom}`;

/**
 * Median carpet area per (property_type, bedroom), for use as the unit reference.
 * @param {object[]} listings
 * @returns {Map<string, number>}
 */
export function buildAreaReference(listings) {
  const buckets = new Map();
  for (const r of listings) {
    if (!(r.carpet_area > 0)) continue;
    const k = areaRefKey(r);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r.carpet_area);
  }
  const ref = new Map();
  for (const [k, xs] of buckets) {
    xs.sort((a, b) => a - b);
    const mid = xs.length >> 1;
    ref.set(k, xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
  }
  return ref;
}

/** The unit score for one record. null when there is no reference to compare to. */
export function areaScore(r, ref) {
  const base = ref.get(areaRefKey(r));
  if (!base || !(r.carpet_area > 0)) return null;
  return r.carpet_area / base;
}

export function isSqmRecord(r, ref) {
  const s = areaScore(r, ref);
  return s !== null && s < SQM_SCORE_CUTOFF;
}

/**
 * Add square-foot area fields to a listing, converting when needed.
 * Original values are left untouched so the raw record stays inspectable.
 */
export function normalizeListing(r, ref) {
  const sqm = isSqmRecord(r, ref);
  const factor = sqm ? SQFT_PER_SQM : 1;
  return {
    ...r,
    carpet_area_sqft: r.carpet_area > 0 ? r.carpet_area * factor : null,
    super_built_up_area_sqft: r.super_built_up_area > 0 ? r.super_built_up_area * factor : null,
    area_unit_as_served: sqm ? 'sqm' : 'sqft',
    area_unit_corrected: sqm,
    area_score: areaScore(r, ref),
  };
}

export function normalizeListings(listings) {
  const ref = buildAreaReference(listings);
  return listings.map((r) => normalizeListing(r, ref));
}

// ---------------------------------------------------------------------------
// Timestamps - TIME-1
//
// API_REFERENCE.md: "Timestamps - ISO 8601, UTC, `Z` suffix, everywhere in the
// API." Listing posted_at carries no offset at all; rental posted_at carries a Z.
// The reading of the naive stamps is settled in scripts/04-time.js; this is the
// single place the decision is applied.
// ---------------------------------------------------------------------------

export const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const NAIVE_STAMPS_ARE = 'ist';

export function parsePostedAt(s, assumeNaive = NAIVE_STAMPS_ARE) {
  if (typeof s !== 'string') return NaN;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) return Date.parse(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return NaN;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return assumeNaive === 'ist' ? asUtc - IST_OFFSET_MS : asUtc;
}
