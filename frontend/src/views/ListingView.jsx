import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, MapPin, BedDouble, Bath, Maximize2, CheckCircle,
  Heart, Phone, Building2, Calendar, Layers, Car, Wind, ExternalLink, TriangleAlert,
} from 'lucide-react'
import { useListing } from '../hooks/useData'
import { useSavedIds, useToggleSaved } from '../hooks/useSaved'
import { normaliseListing, formatRupees, formatArea, formatStamp } from '../utils'
import { Spinner, InlineError, Tag } from '../components/primitives'
import { FindingTags, findingNotes } from '../components/FindingTags'
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

export default function ListingView() {
  const { id } = useParams()
  const { data, isLoading, isError, error, refetch } = useListing(id)
  const savedIds = useSavedIds()
  const toggle = useToggleSaved()

  if (isLoading) return <div className="max-w-5xl mx-auto px-4 py-8"><Spinner message="Loading listing details..." /></div>
  if (isError) return <div className="max-w-5xl mx-auto px-4 py-8"><InlineError message={error?.response?.data?.detail || error.message} retry={refetch} /></div>
  if (!data) return null

  const l = normaliseListing(data)
  const saved = savedIds.has(String(l.listing_id))
  const notes = findingNotes(l)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link
        to="/listings"
        className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-accent-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to listings
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {notes.length > 0 && (
            <div className="rounded-xl border border-[#5A1A1A] bg-[#2A0F0F] p-4">
              <p className="flex items-center gap-1.5 font-semibold text-danger text-sm mb-1">
                <TriangleAlert className="w-4 h-4" />
                Data findings
              </p>
              <ul className="text-xs text-ink-2 space-y-1 list-inside list-disc">
                {notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h1 className="text-xl font-semibold text-ink leading-tight">
                {l.apartment_name || 'Unnamed property'}
              </h1>
              <button
                type="button"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(l)}
                aria-label={saved ? 'Remove from saved' : 'Save listing'}
                className={`shrink-0 p-2 rounded-lg border transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed ${
                  saved ? 'border-[#5A1A1A] text-danger bg-[#2A0F0F]' : 'border-border text-ink-3 hover:border-accent hover:text-accent'
                }`}
              >
                <Heart className={`w-5 h-5 ${saved ? 'fill-current' : ''}`} />
              </button>
            </div>

            {l.latitude && l.longitude ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-raised border border-border text-ink-2 hover:border-accent hover:text-accent-text rounded-lg text-sm font-medium transition-colors mb-4 w-fit"
                title="View on Google Maps"
              >
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="capitalize">{l.locality}, Pune</span>
                <ExternalLink className="w-3.5 h-3.5 ml-0.5 text-ink-3" />
              </a>
            ) : (
              <div className="flex items-center gap-1.5 text-ink-3 text-sm mb-4">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="capitalize">{l.locality}, Pune</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-4">
              {l.bedroom != null && (
                <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                  <BedDouble className="w-5 h-5 text-accent mb-1" />
                  <p className="font-bold text-ink font-data">{l.bedroom}</p>
                  <p className="text-xs text-ink-3">Bedrooms</p>
                </div>
              )}
              {l.bathroom != null && (
                <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                  <Bath className="w-5 h-5 text-accent mb-1" />
                  <p className="font-bold text-ink font-data">{l.bathroom}</p>
                  <p className="text-xs text-ink-3">Bathrooms</p>
                </div>
              )}
              {l.carpetSqft > 0 && (
                <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                  <Maximize2 className="w-5 h-5 text-accent mb-1" />
                  <p className="font-bold text-ink font-data">{formatArea(l.carpetSqft)}</p>
                  <p className="text-xs text-ink-3">Carpet</p>
                </div>
              )}
            </div>

            {l.areaUnit === 'sqm' && (
              <p className="text-xs text-accent-text mb-3">
                Area was served in square metres (documents say sq.ft) — converted at 10.7639 for display.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {l.property_type && <Tag>{l.property_type}</Tag>}
              {l.furnishing && <Tag tone="blue">{l.furnishing}</Tag>}
              {l.is_verified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-[#0F2820] text-[#34D399] border border-[#1A4A35]">
                  <CheckCircle className="w-3 h-3" />
                  Verified
                </span>
              )}
              {!l.is_live && <Tag tone="amber">Inactive</Tag>}
              <FindingTags listing={l} />
            </div>
          </div>

          {l.description && (
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="font-semibold text-ink mb-3">About this property</h2>
              <p className="text-ink-2 text-sm leading-relaxed">{l.description}</p>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold text-ink mb-2">Property details</h2>
            <FactRow icon={Building2} label="Property type" value={l.property_type} />
            <FactRow icon={Layers} label="Floor" value={l.floor != null ? `${l.floor} of ${l.total_floors}` : null} />
            <FactRow icon={Wind} label="Facing" value={l.facing_direction} />
            <FactRow icon={Car} label="Covered parking" value={l.covered_parking > 0 ? `${l.covered_parking} spot(s)` : 'None'} />
            <FactRow icon={Maximize2} label="Super built-up area" value={l.builtSqft ? formatArea(l.builtSqft) : null} />
            <FactRow icon={Calendar} label="Listed on" value={formatStamp(l.posted_at)} />
            <FactRow icon={Building2} label="Source" value={l.website} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 sticky top-20">
            <p className="font-data text-2xl font-medium text-accent-text mb-1">{formatRupees(l.price)}</p>
            {l.perSqft && <p className="text-ink-2 text-sm font-data mb-4">₹{l.perSqft.toLocaleString('en-IN')}/sq.ft</p>}

            {l.posted_by_name && (
              <div className="mb-4 p-3 bg-raised rounded-lg">
                <p className="text-xs text-ink-3 mb-1 capitalize">{l.posted_by}</p>
                <p className="text-sm font-medium text-ink">{l.posted_by_name}</p>
                {l.posted_by_contact && FAKE_CONTACTS.includes(l.posted_by_contact) && (
                  <p className="text-[11px] text-danger mt-1">Shared contact — caution advised</p>
                )}
                {l.posted_by_contact && (
                  <a
                    href={`tel:${l.posted_by_contact}`}
                    className={`flex items-center gap-1.5 text-sm mt-1 font-data hover:text-accent-text ${FAKE_CONTACTS.includes(l.posted_by_contact) ? 'text-danger' : 'text-ink-2'}`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    {l.posted_by_contact}
                  </a>
                )}
              </div>
            )}

            {l.listing_url && (
              <a
                href={l.listing_url}
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