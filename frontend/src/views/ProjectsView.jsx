import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { useProjects } from '../hooks/useData'
import { ProjectTile } from '../components/ProjectTile'
import { PageTitle, Spinner, InlineError, Empty, Pager } from '../components/primitives'

const LIMIT = 20
const STATUSES = ['new launch', 'under construction', 'ready to move']

const fieldClass =
  'px-3 py-2 bg-surface border border-border text-ink rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:ring-offset-surface focus:border-accent'

export default function ProjectsView() {
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState({ status: '', sort: '' })
  const [active, setActive] = useState({})

  const params = { limit: LIMIT, offset }
  if (active.status) params.project_status = active.status
  if (active.sort) params.sort_by = active.sort

  const { data, isLoading, isError, error, refetch } = useProjects(params)

  function apply() {
    setActive({ ...draft })
    setOffset(0)
  }

  function reset() {
    setDraft({ status: '', sort: '' })
    setActive({})
    setOffset(0)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageTitle
        title="Builder Projects"
        subtitle={data ? `${data.total.toLocaleString()} projects in Pune` : 'New & under-construction projects'}
      />

      <div className="border-l-2 border-accent pl-4 py-1 mb-5">
        <p className="text-xs text-ink-2 leading-relaxed">
          <strong className="text-ink">Note:</strong> Project prices are decoded for display. The API returns Indian
          display units (below ₹1 crore as lakhs, at or above as crores) while the documentation claims plain rupees —
          a price_max of 99.9 means ₹99.9 lakh, not ₹99.9 crore.
        </p>
      </div>

      <div className="bg-raised border border-border rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Status</label>
          <select
            value={draft.status}
            onChange={(e) => setDraft((f) => ({ ...f, status: e.target.value }))}
            className={`${fieldClass} capitalize`}
          >
            <option value="" className="bg-card">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s} className="bg-card">{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Sort by</label>
          <select
            value={draft.sort}
            onChange={(e) => setDraft((f) => ({ ...f, sort: e.target.value }))}
            className={fieldClass}
          >
            <option value="" className="bg-card">Default</option>
            <option value="price_max" className="bg-card">Price (max)</option>
            <option value="price_min" className="bg-card">Price (min)</option>
            <option value="total_units" className="bg-card">Total units</option>
            <option value="launch_date" className="bg-card">Launch date</option>
          </select>
        </div>
        <button
          onClick={apply}
          className="px-4 py-2 bg-accent text-surface rounded-lg text-sm font-semibold hover:bg-[#D97706] transition-colors"
        >
          Apply
        </button>
        <button
          onClick={reset}
          className="px-4 py-2 text-ink-2 bg-surface border border-border rounded-lg text-sm hover:border-border-strong hover:text-ink transition-colors"
        >
          Clear
        </button>
      </div>

      {isLoading && <Spinner message="Loading projects..." />}
      {isError && <InlineError message={error?.response?.data?.detail || error.message} retry={refetch} />}

      {data && (
        <>
          {data.results.length === 0 ? (
            <Empty title="No projects found" hint="Try different filters." icon={Building2} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.results.map((project) => <ProjectTile key={project.project_id} project={project} />)}
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