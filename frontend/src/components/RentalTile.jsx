import { Link } from 'react-router-dom'
import { MapPin, BedDouble, Bath, Maximize2, Phone, ExternalLink } from 'lucide-react'
import { formatRupees, formatArea, formatStamp } from '../utils'
import { Tag } from './primitives'
import { FAKE_CONTACTS } from '../data/findings'

export function RentalTile({ rental }) {
  const suspect = FAKE_CONTACTS.includes(rental.posted_by_contact)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-border-strong hover:shadow-[0_0_20px_rgba(245,158,11,0.06)] transition-all group">
      <div className="h-[1.5px] bg-gradient-to-r from-emerald-600 to-teal-500" />

      <div className="p-4">
        <h3 className="font-medium text-ink text-sm mb-1 line-clamp-1">
          <Link to={`/rentals/${rental.listing_id}`} className="hover:text-accent-text transition-colors">
            {rental.apartment_name || rental.title || 'Rental property'}
          </Link>
        </h3>
        {rental.title && rental.apartment_name && (
          <p className="text-xs text-ink-3 mb-2">{rental.title}</p>
        )}

        <div className="flex items-center gap-1 text-ink-3 text-xs mb-3">
          <MapPin className="w-3 h-3" />
          <span className="capitalize">{rental.locality}</span>
        </div>

        <div className="flex items-center gap-3 text-xs font-data text-ink-2 mb-3">
          {rental.bedroom != null && (
            <span className="flex items-center gap-1">
              <BedDouble className="w-3.5 h-3.5 text-ink-3" />
              {rental.bedroom}
            </span>
          )}
          {rental.bathroom != null && (
            <span className="flex items-center gap-1">
              <Bath className="w-3.5 h-3.5 text-ink-3" />
              {rental.bathroom}
            </span>
          )}
          {rental.carpet_area > 0 && (
            <span className="flex items-center gap-1">
              <Maximize2 className="w-3.5 h-3.5 text-ink-3" />
              {formatArea(rental.carpet_area)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {rental.property_type && <Tag>{rental.property_type}</Tag>}
          {rental.furnishing && <Tag tone="blue">{rental.furnishing}</Tag>}
          {!rental.is_live && <Tag tone="amber">Inactive</Tag>}
          {rental.posted_at && <Tag tone="neutral">{formatStamp(rental.posted_at)}</Tag>}
        </div>

        <div className="pt-3 border-t border-border flex justify-between items-start">
          <div>
            <p className="font-data text-base font-medium text-accent-text">
              {formatRupees(rental.price)}<span className="text-xs font-normal text-ink-3">/mo</span>
            </p>
            {rental.deposit > 0 && <p className="text-xs text-ink-3 font-data">Deposit: {formatRupees(rental.deposit)}</p>}
            {rental.maintenance > 0 && <p className="text-xs text-ink-3 font-data">+ ₹{rental.maintenance.toLocaleString('en-IN')}/mo</p>}
          </div>
          <div className="text-right">
            {rental.posted_by_contact && (
              <a
                href={`tel:${rental.posted_by_contact}`}
                className={`flex items-center gap-1 text-xs hover:underline ${suspect ? 'text-danger' : 'text-ink-2 hover:text-accent-text'}`}
              >
                <Phone className="w-3 h-3" />
                Contact
              </a>
            )}
            {rental.listing_url && (
              <a
                href={rental.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2 mt-1"
              >
                <ExternalLink className="w-3 h-3" />
                View
              </a>
            )}
            {rental.latitude && rental.longitude && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${rental.latitude},${rental.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Google Maps"
                className="flex items-center gap-1 text-xs text-ink-3 hover:text-accent-text mt-1"
              >
                <MapPin className="w-3 h-3" />
                Map
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}