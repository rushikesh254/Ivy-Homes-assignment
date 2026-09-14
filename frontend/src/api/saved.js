import { stash } from './client'

// No favourites endpoint exists on this API (docs describe one, both spellings
// 404), so saved listings persist locally, scoped per account.
const PREFIX = 'saved_'

function bucket() {
  const account = stash.account()
  const id = account?.id ?? account?.email ?? 'guest'
  return `${PREFIX}${encodeURIComponent(String(id))}`
}

function readAll() {
  try {
    const rows = JSON.parse(localStorage.getItem(bucket()) || '[]')
    return Array.isArray(rows)
      ? rows.filter((r) => r && typeof r === 'object' && r.listing_id != null)
      : []
  } catch {
    return []
  }
}

function writeAll(rows) {
  localStorage.setItem(bucket(), JSON.stringify(rows))
}

export const savedApi = {
  list: async () => {
    const rows = readAll()
    return { rows, count: rows.length }
  },
  has: (id) => readAll().some((r) => String(r.listing_id) === String(id)),
  add: async (listing) => {
    if (!listing?.listing_id) throw new Error('Need a listing to save it.')
    const rows = readAll()
    if (!rows.some((r) => String(r.listing_id) === String(listing.listing_id))) {
      writeAll([listing, ...rows])
    }
  },
  remove: async (id) => {
    writeAll(readAll().filter((r) => String(r.listing_id) !== String(id)))
  },
}