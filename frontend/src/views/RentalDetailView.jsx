import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, MapPin, BedDouble, Bath, Maximize2,
  Phone, Building2, Calendar, Layers, Wind, ExternalLink, TriangleAlert,
} from 'lucide-react'
import { useRental } from '../hooks/useData'
import { formatRupees, formatArea, formatStamp } from '../utils'
import { Spinner, InlineError, Tag } from '../components/primitives'
import { FAKE_CONTACTS } from '../data/findings'

function FactRow({ icon: Icon, label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className="p-1.5 bg-raised rounded-lg shrink-0">
        <Icon className="w-3.5 h-3.5 text-ink-2" />
      </div>
      <div>
        <p className="text-xs text-ink-3">{label}</p>
        <p className="text-sm font-medium text-ink capitalize">{value}</p>
      </div>
    </div>
  )
}

export default function RentalDetailView() {
  const { id } = useParams()
  const { data, isLoading, isError, error, refetch } = useRental(id)
  const suspect = data && FAKE_CONTACTS.includes(data.posted_by_contact)

  if (isLoading) return <div className="max-w-5xl mx-auto px-4 py-8"><Spinner message="Loading rental details..." /></div>
  if (isError) return <div className="max-w-5xl mx-auto px-4 py-8"><InlineError message={error?.response?.data?.detail || error.message} retry={refetch} /></div>
  if (!data) return null

  const r = data

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link
        to="/rentals"
        className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-accent-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to rentals
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-[#5A1A1A] bg-[#2A0F0F] p-4">
            <p className="flex items-center gap-1.5 font-semibold text-danger text-sm mb-1">
              <TriangleAlert className="w-4 h-4" />
              Data findings
            </p>
            <ul className="text-xs text-ink-2 space-y-1 list-inside list-disc">
              {suspect && <li>Shared contact {r.posted_by_contact} spans multiple names across rentals — caution advised.</li>}
              <li>Rental <code className="text-ink">posted_at</code> is real UTC (trailing <code className="text-ink">Z</code>) — displaying it as-is, unlike sale listings which use naive IST.</li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-[1.5px] bg-gradient-to-r from-emerald-600 to-teal-500 mb-4 rounded-full" />
            <h1 className="text-xl font-semibold text-ink leading-tight mb-2">
              {r.apartment_name || r.title || 'Rental property'}
            </h1>
            {r.title && r.apartment_name && (
              <p className="text-sm text-ink-3 mb-3">{r.title}</p>
            )}

            {r.latitude && r.longitude ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-raised border border-border text-ink-2 hover:border-accent hover:text-accent-text rounded-lg text-sm font-medium transition-colors mb-4 w-fit"
                title="View on Google Maps"
              >
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="capitalize">{r.locality}, Pune</span>
                <ExternalLink className="w-3.5 h-3.5 ml-0.5 text-ink-3" />
              </a>
            ) : (
              <div className="flex items-center gap-1.5 text-ink-3 text-sm mb-4">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="capitalize">{r.locality}, Pune</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-4">
              {r.bedroom != null && (
                <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                  <BedDouble className="w-5 h-5 text-accent mb-1" />
                  <p className="font-bold text-ink font-data">{r.bedroom}</p>
                  <p className="text-xs text-ink-3">Bedrooms</p>
                </div>
              )}
              {r.bathroom != null && (
                <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                  <Bath className="w-5 h-5 text-accent mb-1" />
                  <p className="font-bold text-ink font-data">{r.bathroom}</p>
                  <p className="text-xs text-ink-3">Bathrooms</p>
                </div>
              )}
              {r.carpet_area > 0 && (
                <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                  <Maximize2 className="w-5 h-5 text-accent mb-1" />
                  <p className="font-bold text-ink font-data">{formatArea(r.carpet_area)}</p>
                  <p className="text-xs text-ink-3">Carpet</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {r.property_type && <Tag>{r.property_type}</Tag>}
              {r.furnishing && <Tag tone="blue">{r.furnishing}</Tag>}
              {!r.is_live && <Tag tone="amber">Inactive</Tag>}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold text-ink mb-2">Rental details</h2>
            <FactRow icon={Building2} label="Property type" value={r.property_type} />
            <FactRow icon={Layers} label="Floor" value={r.floor != null ? `${r.floor} of ${r.total_floors}` : null} />
            <FactRow icon={Wind} label="Facing" value={r.facing_direction} />
            <FactRow icon={Maximize2} label="Super built-up area" value={r.built_up_area ? formatArea(r.built_up_area) : null} />
            <FactRow icon={Calendar} label="Listed on" value={formatStamp(r.posted_at)} />
            <FactRow icon={Building2} label="Source" value={r.website} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 sticky top-20">
            <p className="text-xs text-ink-3 mb-1">Monthly rent</p>
            <p className="font-data text-2xl font-medium text-accent-text mb-4">{formatRupees(r.price)}</p>
            {r.deposit > 0 && (
              <p className="text-sm text-ink-2 font-data mb-1">Deposit: {formatRupees(r.deposit)}</p>
            )}
            {r.maintenance > 0 && (
              <p className="text-sm text-ink-2 font-data mb-4">Maintenance: + ₹{r.maintenance.toLocaleString('en-IN')}/mo</p>
            )}

            {r.posted_by_name && (
              <div className="mb-4 p-3 bg-raised rounded-lg">
                <p className="text-xs text-ink-3 mb-1 capitalize">{r.posted_by}</p>
                <p className="text-sm font-medium text-ink">{r.posted_by_name}</p>
                {r.posted_by_contact && (
                  <a
                    href={`tel:${r.posted_by_contact}`}
                    className={`flex items-center gap-1.5 text-sm mt-1 font-data hover:text-accent-text ${suspect ? 'text-danger' : 'text-ink-2'}`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    {r.posted_by_contact}
                  </a>
                )}
              </div>
            )}

            {r.listing_url && (
              <a
                href={r.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 border border-accent text-accent-text rounded-lg text-sm font-medium hover:bg-accent hover:text-surface transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View original listing
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}