import { Heart } from 'lucide-react'
import { useSavedRows, useRemoveSaved } from '../hooks/useSaved'
import { ListingTile } from '../components/ListingTile'
import { PageTitle, Spinner, InlineError, Empty } from '../components/primitives'

export default function SavedView() {
  const { data, isLoading, isError, error, refetch } = useSavedRows()
  const removeMutation = useRemoveSaved()
  const rows = data?.rows || []
  const savedIds = new Set(rows.map((r) => String(r.listing_id)))

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageTitle
        title="Saved Listings"
        subtitle={data ? `${rows.length} saved propert${rows.length === 1 ? 'y' : 'ies'}` : 'Your saved properties'}
      />

      {isLoading && <Spinner message="Loading saved listings..." />}
      {isError && <InlineError message={error?.message || 'Could not load saved listings'} retry={refetch} />}

      {data && (
        rows.length === 0 ? (
          <Empty
            title="No saved listings yet"
            hint="Browse listings and tap the heart icon to save properties you like."
            icon={Heart}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rows.map((listing) => (
              <ListingTile
                key={listing.listing_id}
                listing={listing}
                saved={savedIds.has(String(listing.listing_id))}
                busy={removeMutation.isPending}
                onToggle={(l) => removeMutation.mutate(l.listing_id)}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}