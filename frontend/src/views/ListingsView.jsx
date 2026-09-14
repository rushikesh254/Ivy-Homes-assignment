import { useState } from 'react'
import { Search, SlidersHorizontal, X, Home } from 'lucide-react'
import { useListings } from '../hooks/useData'
import { useSavedIds, useToggleSaved } from '../hooks/useSaved'
import { ListingTile } from '../components/ListingTile'
import { PageTitle, Spinner, InlineError, Empty, Pager } from '../components/primitives'

const LIMIT = 20
const LOCALITIES = [
  'wakad', 'hinjewadi', 'baner', 'kothrud', 'viman nagar', 'kharadi',
  'punawale', 'pimple saudagar', 'aundh', 'hadapsar', 'magarpatta',
]
const FURNISHING = ['unfurnished', 'semi-furnished', 'fully-furnished']
const EMPTY_FILTERS = { locality: '', bhk: '', minPrice: '', maxPrice: '', furnishing: '' }

const fieldClass =
  'w-full px-3 py-2 bg-surface border border-border text-ink rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:ring-offset-surface focus:border-accent'

export default function ListingsView() {
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState(EMPTY_FILTERS)
  const [active, setActive] = useState(EMPTY_FILTERS)
  const [showPanel, setShowPanel] = useState(false)

  const params = { limit: LIMIT, offset }
  if (active.locality) params.locality = active.locality
  if (active.bhk) params.bhk = Number(active.bhk)
  if (active.minPrice) params.min_price = Number(active.minPrice)
  if (active.maxPrice) params.max_price = Number(active.maxPrice)
  if (active.furnishing) params.furnishing = active.furnishing

  const { data, isLoading, isError, error, refetch } = useListings(params)
  const savedIds = useSavedIds()
  const toggle = useToggleSaved()

  const hasActive = Object.values(active).some(Boolean)

  function apply() {
    setActive({ ...draft })
    setOffset(0)
    setShowPanel(false)
  }

  function reset() {
    setDraft(EMPTY_FILTERS)
    setActive(EMPTY_FILTERS)
    setOffset(0)
  }

  const setField = (key) => (e) => setDraft((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageTitle
        title="Property Listings"
        subtitle={data ? `${data.total.toLocaleString()} properties in Pune` : 'Browse properties for sale'}
      >
        <button
          onClick={() => setShowPanel((v) => !v)}
          className={`relative flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
            showPanel || hasActive
              ? 'bg-raised border-accent text-accent-text'
              : 'bg-surface border-border text-ink-2 hover:border-border-strong hover:text-ink'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {hasActive && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full" />
          )}
        </button>
      </PageTitle>

      {showPanel && (
        <div className="bg-raised border border-border rounded-xl p-5 mb-6 shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition-all duration-200">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Locality</label>
              <select value={draft.locality} onChange={setField('locality')} className={`${fieldClass} capitalize`}>
                <option value="" className="bg-card">All localities</option>
                {LOCALITIES.map((l) => <option key={l} value={l} className="bg-card capitalize">{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Bedrooms</label>
              <select value={draft.bhk} onChange={setField('bhk')} className={fieldClass}>
                <option value="" className="bg-card">Any</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n} className="bg-card">{n} BHK</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Min price (₹)</label>
              <input type="number" placeholder="e.g. 5000000" value={draft.minPrice} onChange={setField('minPrice')} className={fieldClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Max price (₹)</label>
              <input type="number" placeholder="e.g. 20000000" value={draft.maxPrice} onChange={setField('maxPrice')} className={fieldClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Furnishing</label>
              <select value={draft.furnishing} onChange={setField('furnishing')} className={`${fieldClass} capitalize`}>
                <option value="" className="bg-card">Any</option>
                {FURNISHING.map((f) => <option key={f} value={f} className="bg-card capitalize">{f}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={apply}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-surface rounded-lg text-sm font-semibold hover:bg-[#D97706] transition-colors"
            >
              <Search className="w-4 h-4" />
              Apply filters
            </button>
            {hasActive && (
              <button
                onClick={reset}
                className="flex items-center gap-2 px-4 py-2 text-ink-2 border border-border bg-surface rounded-lg text-sm hover:border-border-strong hover:text-ink transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading && <Spinner message="Loading listings..." />}
      {isError && <InlineError message={error?.response?.data?.detail || error.message} retry={refetch} />}

      {data && (
        <>
          {data.results.length === 0 ? (
            <Empty title="No listings found" hint="Try adjusting your filters to see more results." icon={Home} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {data.results.map((listing) => (
                <ListingTile
                  key={listing.listing_id}
                  listing={listing}
                  saved={savedIds.has(String(listing.listing_id))}
                  busy={toggle.isPending}
                  onToggle={(l) => toggle.mutate(l)}
                />
              ))}
            </div>
          )}
          {data.total > LIMIT && (
            <Pager offset={offset} limit={LIMIT} total={data.total} hasMore={data.has_more} onJump={setOffset} />
          )}
        </>
      )}
    </div>
  )
}