import { AREA_GROUPS } from '../data/findings'

// 306 of the 3800 listings carry areas in square metres while the API documents
// square feet. A sqm record's carpet area sits near (median / 10.7639), i.e. a
// ratio to its (property_type, bedroom) median of ~0.093; a true sqft record
// sits around 1.0. The 0.3 gap is the discriminator — safer than any absolute
// area threshold, which would miscount a small studio.
export const SQFT_PER_SQM = 10.7639
export const METRE_RATIO_CUTOFF = 0.3

function groupOf(listing) {
  return `${listing.property_type}|${listing.bedroom}`
}

export function isMetreListing(listing) {
  const median = AREA_GROUPS[groupOf(listing)]
  if (!(median > 0) || !(listing.carpet_area > 0)) return false
  return listing.carpet_area / median < METRE_RATIO_CUTOFF
}

/** Return a widened copy of a listing with normalised areas and per-sq-ft rate. */
export function normaliseListing(listing) {
  const inMetres = isMetreListing(listing)
  const factor = inMetres ? SQFT_PER_SQM : 1
  const carpet = listing.carpet_area > 0 ? listing.carpet_area * factor : null
  const built = listing.super_built_up_area > 0 ? listing.super_built_up_area * factor : null
  return {
    ...listing,
    areaUnit: inMetres ? 'sqm' : 'sqft',
    carpetSqft: carpet,
    builtSqft: built,
    perSqft: carpet ? Math.round(listing.price / carpet) : null,
  }
}

export function formatArea(sqft) {
  if (!(sqft > 0)) return '—'
  return `${Math.round(sqft).toLocaleString('en-IN')} sq.ft`
}