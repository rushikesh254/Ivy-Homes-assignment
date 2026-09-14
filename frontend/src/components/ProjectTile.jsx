import { Link } from 'react-router-dom'
import { MapPin, Building2, Calendar, Layers, ExternalLink } from 'lucide-react'
import { formatRupees, decodeDisplayPrice, displayUnitOf } from '../utils'
import { Tag } from './primitives'

const STATUS_TONE = {
  'new launch': 'blue',
  'under construction': 'amber',
  'ready to move': 'green',
}

export function ProjectTile({ project }) {
  const start = decodeDisplayPrice(project.price_min)
  const end = decodeDisplayPrice(project.price_max)
  const anyLakh = [project.price_min, project.price_max].some((v) => displayUnitOf(v) === 'lakh')

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-border-strong hover:shadow-[0_0_20px_rgba(139,92,246,0.08)] transition-all group">
      <div className="h-[1.5px] bg-gradient-to-r from-[#8B5CF6] to-[#6366F1]" />

      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <Link
            to={`/projects/${project.project_id}`}
            className="font-medium text-ink text-sm leading-snug hover:text-[#A78BFA] transition-colors line-clamp-2 group-hover:text-[#A78BFA]"
          >
            {project.apartment_name}
          </Link>
          <Tag tone={STATUS_TONE[project.project_status] || 'neutral'}>{project.project_status}</Tag>
        </div>

        <p className="text-ink-3 text-xs font-data uppercase tracking-wider mb-1">
          {project.developer_name}
        </p>

        <div className="flex items-center gap-1 text-ink-3 text-xs mb-4">
          <MapPin className="w-3 h-3" />
          <span className="capitalize">{project.locality}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4 text-xs font-data text-ink-2">
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-ink-3" />
            {project.total_units} units
          </div>
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-ink-3" />
            {project.total_towers} towers · {project.total_floors}F
          </div>
          {project.possession_date && (
            <div className="flex items-center gap-1.5 col-span-2">
              <Calendar className="w-3.5 h-3.5 text-ink-3" />
              Possession: {new Date(project.possession_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>

        {project.min_area_sqft && project.max_area_sqft && (
          <p className="text-xs text-ink-3 font-data mb-3">
            {project.min_area_sqft.toLocaleString()}–{project.max_area_sqft.toLocaleString()} sq.ft
          </p>
        )}

        {project.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {project.amenities.slice(0, 4).map((a) => (
              <span key={a} className="px-1.5 py-0.5 bg-raised text-ink-3 rounded border border-border text-[11px] capitalize">{a}</span>
            ))}
            {project.amenities.length > 4 && (
              <span className="px-1.5 py-0.5 bg-raised text-ink-3 rounded border border-border text-[11px]">+{project.amenities.length - 4}</span>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-border flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-3 mb-0.5">Price range (decoded)</p>
            <p className="font-data text-base font-medium text-accent-text">
              {formatRupees(start)} – {formatRupees(end)}
            </p>
            {anyLakh && (
              <p className="text-[11px] text-ink-3">values served as lakh/crore display units</p>
            )}
          </div>
          <div className="text-right">
            <p className="font-data text-xs text-ink-3">{project.total_listings} listing{project.total_listings !== 1 ? 's' : ''}</p>
            {project.project_url && (
              <a href={project.project_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#A78BFA] hover:text-[#C4B5FD] mt-0.5">
                <ExternalLink className="w-3 h-3" /> Details
              </a>
            )}
            {project.latitude && project.longitude && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${project.latitude},${project.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Google Maps"
                className="inline-flex items-center gap-1 text-xs text-[#A78BFA] hover:text-[#C4B5FD] mt-0.5"
              >
                <MapPin className="w-3 h-3" /> Map
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}