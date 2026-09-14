import { useState } from 'react'
import { BedDouble } from 'lucide-react'
import { useRentals } from '../hooks/useData'
import { RentalTile } from '../components/RentalTile'
import { PageTitle, Spinner, InlineError, Empty, Pager } from '../components/primitives'

const LIMIT = 20
const FURNISHING = ['unfurnished', 'semi-furnished', 'fully-furnished']

const fieldClass =
  'px-3 py-2 bg-surface border border-border text-ink rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:ring-offset-surface focus:border-accent'

export default function RentalsView() {
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState({ locality: '', bhk: '', furnishing: '' })
  const [active, setActive] = useState({})

  const params = { limit: LIMIT, offset }
  if (active.locality) params.locality = active.locality
  if (active.bhk) params.bhk = Number(active.bhk)
  if (active.furnishing) params.furnishing = active.furnishing

  const { data, isLoading, isError, error, refetch } = useRentals(params)
  const hasFilters = Boolean(active.locality || active.bhk || active.furnishing)

  function apply() {
    setActive({ ...draft })
    setOffset(0)
  }

  function reset() {
    setDraft({ locality: '', bhk: '', furnishing: '' })
    setActive({})
    setOffset(0)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageTitle
        title="Rental Listings"
        subtitle={data ? `${data.total.toLocaleString()} rentals available in Pune` : 'Find your next home'}
      />

      <div className="border-l-2 border-info ml-0 pl-4 py-1 mb-5">
        <p className="text-xs text-ink-2 leading-relaxed">
          Rental <code className="text-ink">posted_at</code> values carry a <code className="text-ink">Z</code> suffix and are real UTC —
          unlike the sale listings, which are naive IST wall-clock times without an offset.
        </p>
      </div>

      <div className="bg-raised border border-border rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Locality</label>
          <input
            value={draft.locality}
            onChange={(e) => setDraft((f) => ({ ...f, locality: e.target.value }))}
            placeholder="e.g. hinjewadi"
            className={`${fieldClass} w-36`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Bedrooms</label>
          <select
            value={draft.bhk}
            onChange={(e) => setDraft((f) => ({ ...f, bhk: e.target.value }))}
            className={fieldClass}
          >
            <option value="" className="bg-card">Any</option>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n} className="bg-card">{n} BHK</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Furnishing</label>
          <select
            value={draft.furnishing}
            onChange={(e) => setDraft((f) => ({ ...f, furnishing: e.target.value }))}
            className={`${fieldClass} capitalize`}
          >
            <option value="" className="bg-card">Any</option>
            {FURNISHING.map((f) => <option key={f} value={f} className="bg-card">{f}</option>)}
          </select>
        </div>
        <button
          onClick={apply}
          className="px-4 py-2 bg-accent text-surface rounded-lg text-sm font-semibold hover:bg-[#D97706] transition-colors"
        >
          Search
        </button>
        {hasFilters && (
          <button
            onClick={reset}
            className="px-4 py-2 text-ink-2 bg-surface border border-border rounded-lg text-sm hover:border-border-strong hover:text-ink transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && <Spinner message="Loading rentals..." />}
      {isError && <InlineError message={error?.response?.data?.detail || error.message} retry={refetch} />}

      {data && (
        <>
          {data.results.length === 0 ? (
            <Empty title="No rentals found" hint="Try different filters." icon={BedDouble} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {data.results.map((rental) => <RentalTile key={rental.listing_id} rental={rental} />)}
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