import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, MapPin, Building2, Calendar, Layers,
  ExternalLink, Home, CheckCircle,
} from 'lucide-react'
import { useProject } from '../hooks/useData'
import { formatRupees, decodeDisplayPrice, displayUnitOf, parseStamp } from '../utils'
import { Spinner, InlineError, Tag } from '../components/primitives'

const STATUS_TONE = {
  'new launch': 'blue',
  'under construction': 'amber',
  'ready to move': 'green',
}

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

export default function ProjectDetailView() {
  const { id } = useParams()
  const { data, isLoading, isError, error, refetch } = useProject(id)

  if (isLoading) return <div className="max-w-5xl mx-auto px-4 py-8"><Spinner message="Loading project details..." /></div>
  if (isError) return <div className="max-w-5xl mx-auto px-4 py-8"><InlineError message={error?.response?.data?.detail || error.message} retry={refetch} /></div>
  if (!data) return null

  const p = data
  const start = decodeDisplayPrice(p.price_min)
  const end = decodeDisplayPrice(p.price_max)
  const anyLakh = [p.price_min, p.price_max].some((v) => displayUnitOf(v) === 'lakh')
  const launched = p.launch_date ? parseStamp(p.launch_date) : null
  const possession = p.possession_date ? parseStamp(p.possession_date) : null

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-[#A78BFA] mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to projects
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-[1.5px] bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] mb-4 rounded-full" />
            <h1 className="text-xl font-semibold text-ink leading-tight mb-1">
              {p.apartment_name}
            </h1>
            {p.developer_name && (
              <p className="text-ink-3 text-xs font-data uppercase tracking-wider mb-4">{p.developer_name}</p>
            )}

            {p.latitude && p.longitude ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-raised border border-border text-ink-2 hover:border-[#8B5CF6] hover:text-[#C4B5FD] rounded-lg text-sm font-medium transition-colors mb-5 w-fit"
                title="View on Google Maps"
              >
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="capitalize">{p.locality}, Pune</span>
                <ExternalLink className="w-3.5 h-3.5 ml-0.5 text-ink-3" />
              </a>
            ) : (
              <div className="flex items-center gap-1.5 text-ink-3 text-sm mb-5">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="capitalize">{p.locality}, Pune</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                <Building2 className="w-5 h-5 text-[#A78BFA] mb-1" />
                <p className="font-bold text-ink font-data">{p.total_units}</p>
                <p className="text-xs text-ink-3">Units</p>
              </div>
              <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                <Layers className="w-5 h-5 text-[#A78BFA] mb-1" />
                <p className="font-bold text-ink font-data">{p.total_towers}</p>
                <p className="text-xs text-ink-3">Towers</p>
              </div>
              <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                <Home className="w-5 h-5 text-[#A78BFA] mb-1" />
                <p className="font-bold text-ink font-data">{p.total_floors}</p>
                <p className="text-xs text-ink-3">Floors</p>
              </div>
              <div className="flex flex-col items-center p-3 bg-raised rounded-lg">
                <CheckCircle className="w-5 h-5 text-[#A78BFA] mb-1" />
                <p className="font-bold text-ink font-data">{p.total_listings}</p>
                <p className="text-xs text-ink-3">Listings</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Tag tone={STATUS_TONE[p.project_status] || 'neutral'}>{p.project_status}</Tag>
              {p.is_verified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-[#0F2820] text-[#34D399] border border-[#1A4A35]">
                  <CheckCircle className="w-3 h-3" />
                  Verified
                </span>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold text-ink mb-2">Project details</h2>
            <FactRow icon={Building2} label="Project ID" value={p.project_id} />
            <FactRow icon={MapPin} label="Locality" value={`${p.locality}, ${p.area} `} />
            <FactRow icon={Calendar} label="Launch date" value={launched ? launched.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null} />
            <FactRow icon={Calendar} label="Possession" value={possession ? possession.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : null} />
            <FactRow icon={Building2} label="Source" value={p.website} />
          </div>

          {p.amenities?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="font-semibold text-ink mb-3">Amenities</h2>
              <div className="flex flex-wrap gap-1.5">
                {p.amenities.map((a) => (
                  <span key={a} className="px-2.5 py-1 bg-raised text-ink-3 rounded border border-border text-xs capitalize">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 sticky top-20">
            <p className="text-xs text-ink-3 mb-1">Price range (decoded)</p>
            <p className="font-data text-2xl font-medium text-accent-text mb-1">
              {formatRupees(start)} – {formatRupees(end)}
            </p>
            {anyLakh && (
              <p className="text-xs text-ink-3 mb-4">values served as lakh/crore display units</p>
            )}

            {p.min_area_sqft && p.max_area_sqft && (
              <div className="mb-4 p-3 bg-raised rounded-lg">
                <p className="text-xs text-ink-3 mb-1">Area range</p>
                <p className="text-sm font-medium text-ink font-data">
                  {p.min_area_sqft.toLocaleString()} – {p.max_area_sqft.toLocaleString()} sq.ft
                </p>
              </div>
            )}

            {p.min_price_per_sqft > 0 && p.max_price_per_sqft > 0 && (
              <div className="mb-4 p-3 bg-raised rounded-lg">
                <p className="text-xs text-ink-3 mb-1">₹/sq.ft (raw)</p>
                <p className="text-sm font-medium text-ink font-data">
                  ₹{p.min_price_per_sqft.toLocaleString('en-IN')} – ₹{p.max_price_per_sqft.toLocaleString('en-IN')}
                </p>
              </div>
            )}

            {p.project_url && (
              <a
                href={p.project_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 border border-[#8B5CF6] text-[#A78BFA] rounded-lg text-sm font-medium hover:bg-[#8B5CF6] hover:text-surface transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View project page
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}