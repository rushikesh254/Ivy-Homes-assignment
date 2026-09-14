import { Link } from 'react-router-dom'
import { Heart, MapPin, BedDouble, Bath, Maximize2, CheckCircle } from 'lucide-react'
import { formatRupees, formatArea, normaliseListing } from '../utils'
import { Tag } from './primitives'
import { FindingTags } from './FindingTags'

export function ListingTile({ listing, saved, busy = false, onToggle }) {
  const l = normaliseListing(listing)

  return (
    <div
      className="bg-card border border-border rounded-xl overflow-hidden hover:border-border-strong hover:shadow-[0_0_20px_rgba(245,158,11,0.06)] transition-all group"
    >
      <div className="h-[1.5px] bg-accent" />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <Link
            to={`/listings/${l.listing_id}`}
            className="font-medium text-ink text-sm leading-snug hover:text-accent-text transition-colors line-clamp-2 group-hover:text-accent-text"
          >
            {l.apartment_name || 'Unnamed property'}
          </Link>
          {onToggle && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onToggle(l)}
              aria-label={saved ? 'Remove from saved' : 'Save listing'}
              className={`shrink-0 p-1.5 rounded-lg transition-transform active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed ${
                saved ? 'text-danger bg-[#2A0F0F]' : 'text-ink-3 hover:text-accent hover:bg-accent-dim'
              }`}
            >
              <Heart className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 text-ink-3 text-xs mb-3 capitalize">
          <MapPin className="w-3 h-3" />
          {l.locality}
        </div>

        <div className="flex items-center gap-3 text-xs font-data text-ink-2 mb-3">
          {l.bedroom != null && (
            <span className="flex items-center gap-1">
              <BedDouble className="w-3.5 h-3.5 text-ink-3" />
              {l.bedroom} BHK
            </span>
          )}
          {l.bathroom != null && (
            <span className="flex items-center gap-1">
              <Bath className="w-3.5 h-3.5 text-ink-3" />
              {l.bathroom}
            </span>
          )}
          {l.carpetSqft > 0 && (
            <span className="flex items-center gap-1">
              <Maximize2 className="w-3.5 h-3.5 text-ink-3" />
              {formatArea(l.carpetSqft)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {l.property_type && <Tag>{l.property_type}</Tag>}
          {l.furnishing && <Tag tone="blue">{l.furnishing}</Tag>}
          {!l.is_live && <Tag tone="amber">Inactive</Tag>}
          <FindingTags listing={l} />
        </div>

        <div className="flex items-end justify-between pt-3 border-t border-border">
          <div>
            <p className="font-data text-base font-medium text-accent-text">{formatRupees(l.price)}</p>
            {l.perSqft && (
              <p className="font-data text-[11px] text-ink-3">₹{l.perSqft.toLocaleString('en-IN')}/sq.ft</p>
            )}
          </div>
          {l.is_verified && (
            <div className="flex items-center gap-1 text-[10px] text-success font-medium">
              <CheckCircle className="w-3 h-3" />
              Verified
            </div>
          )}
        </div>
      </div>
    </div>
  )
}